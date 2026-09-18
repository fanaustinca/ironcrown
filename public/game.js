/* ==========================================================================
   Ironcrown — a browser kingdom-strategy game
   Vanilla JS + HTML5 Canvas. No build step.

   Sections
     1. Config & data tables
     2. Utilities (RNG, formatting, colors)
     3. State (new game, save/load, offline progress, backend sync)
     4. Economy (rates, costs, construction)
     5. Military (units, training, generals, items, mystery boxes)
     6. World (generation, AI kingdoms, scouting, territory, raids)
     7. Alliances
     8. Battle simulation + renderer
     9. Kingdom & world renderers (canvas)
    10. UI (HUD, panel tabs, modals, toasts, input)
    11. Main loop, boot & test hooks
   ========================================================================== */
(() => {
'use strict';

/* =========================== 1. CONFIG & DATA =========================== */

const VERSION = 1;
const GRID_W = 22, GRID_H = 16;          // kingdom grid (tiles)
const WATER_X = 18;                       // columns >= this are sea
const HALL_X = 12, HALL_Y = 7;            // hall anchor (2x2)
const WORLD_W = 34, WORLD_H = 22;         // world map (tiles)
const MAX_HALL = 6;
const AI_TICK = 20;                       // seconds between AI kingdom turns
const OFFLINE_CAP = 8 * 3600;             // max offline progress (s)

const RES = ['gold', 'iron', 'diamonds', 'lumber', 'food'];
const RES_META = {
  gold:     { name: 'Gold',     icon: '🪙', color: '#f2c14e' },
  iron:     { name: 'Iron',     icon: '⛓️', color: '#9fb3c8' },
  diamonds: { name: 'Diamonds', icon: '💎', color: '#6fe3f2' },
  lumber:   { name: 'Lumber',   icon: '🪵', color: '#c8894a' },
  food:     { name: 'Food',     icon: '🌾', color: '#9bd46a' },
};

// Per-type limit indexed by Main Hall level - 1.
const BUILDINGS = {
  hall:        { name: 'Main Hall',     icon: '🏰', cat: 'core',     size: 2, base: { gold: 450, lumber: 450, iron: 180 }, mult: 2.3, time: 12,
                 desc: 'Heart of your kingdom. Upgrading unlocks new buildings, higher levels, more land and storage.', limit: [1,1,1,1,1,1] },
  goldmine:    { name: 'Gold Mine',     icon: '🪙', cat: 'resource', produces: 'gold', rate: 1.1, base: { lumber: 80, food: 20 }, mult: 1.75, time: 4,
                 desc: 'Digs gold coins out of the hills.', limit: [2,3,4,5,6,6] },
  ironmine:    { name: 'Iron Mine',     icon: '⛏️', cat: 'resource', produces: 'iron', rate: 0.6, base: { gold: 100, lumber: 90 }, mult: 1.75, time: 5,
                 desc: 'Iron for swords, horseshoes and walls.', limit: [1,2,3,4,5,5] },
  diamondmine: { name: 'Diamond Mine',  icon: '💎', cat: 'resource', produces: 'diamonds', rate: 0.04, base: { gold: 700, iron: 250, lumber: 250 }, mult: 1.9, time: 10,
                 desc: 'Rare gems. Spend them on Royal Reliquaries.', limit: [0,0,1,2,3,3] },
  lumbermill:  { name: 'Lumber Mill',   icon: '🪵', cat: 'resource', produces: 'lumber', rate: 1.0, base: { gold: 80 }, mult: 1.75, time: 4,
                 desc: 'Saws timber from the royal forests.', limit: [2,3,4,5,6,6] },
  farm:        { name: 'Farm',          icon: '🌾', cat: 'resource', produces: 'food', rate: 1.3, base: { gold: 60, lumber: 40 }, mult: 1.75, time: 4,
                 desc: 'Feeds your people and your army (troops eat food).', limit: [2,3,4,5,6,6] },
  wall:        { name: 'Wall',          icon: '🧱', cat: 'defense',  def: 10, base: { lumber: 25, iron: 5 }, mult: 1.6, time: 1,
                 desc: 'Stone segments that slow raiders. Walls link up with neighbours.', limit: [12,20,30,40,50,60] },
  tower:       { name: 'Archer Tower',  icon: '🗼', cat: 'defense',  def: 45, base: { gold: 150, lumber: 120 }, mult: 1.8, time: 6,
                 desc: 'Rains arrows on raiders. Solid all-round defense.', limit: [1,2,3,4,5,6] },
  cannon:      { name: 'Cannon',        icon: '💣', cat: 'defense',  def: 95, base: { gold: 400, iron: 250 }, mult: 1.8, time: 8, hall: 3,
                 desc: 'Heavy iron cannon. Devastating against armored foes.', limit: [0,0,1,2,3,4] },
  spire:       { name: 'Arcane Spire',  icon: '🔮', cat: 'defense',  def: 220, base: { gold: 1500, iron: 600, diamonds: 40 }, mult: 1.9, time: 12, hall: 5,
                 desc: 'Crackling crystal spire. The strongest defense in the realm.', limit: [0,0,0,0,1,2] },
  port:        { name: 'Port',          icon: '⚓', cat: 'core',     rate: 0.9, base: { gold: 350, lumber: 350 }, mult: 1.8, time: 8, hall: 2, coastal: true,
                 desc: 'Must touch the sea. Trade ships earn gold, unlock the market and let you claim islands.', limit: [0,1,1,2,2,2] },
  archery:     { name: 'Archery Range', icon: '🏹', cat: 'military', trains: 'archer', base: { gold: 120, lumber: 150 }, mult: 1.8, time: 5,
                 desc: 'Trains Archers — ranged damage dealers.', limit: [1,1,1,1,1,1] },
  barracks:    { name: 'Barracks',      icon: '⚔️', cat: 'military', trains: 'swordsman', base: { gold: 150, lumber: 120, iron: 40 }, mult: 1.8, time: 5,
                 desc: 'Trains Swordsmen — sturdy front-line infantry.', limit: [1,1,1,1,1,1] },
  stable:      { name: 'Stables',       icon: '🐎', cat: 'military', trains: 'horseman', base: { gold: 350, lumber: 250, iron: 120 }, mult: 1.8, time: 7, hall: 2,
                 desc: 'Trains Horsemen — fast, hard-hitting cavalry.', limit: [0,1,1,1,1,1] },
  scoutlodge:  { name: 'Scout Lodge',   icon: '🔭', cat: 'military', trains: 'scout', base: { gold: 100, lumber: 100 }, mult: 1.8, time: 4,
                 desc: 'Trains Scouts that spy on and reveal nearby territories.', limit: [1,1,1,1,1,1] },
};
const BUILD_ORDER = ['goldmine','ironmine','diamondmine','lumbermill','farm','wall','tower','cannon','spire','port','archery','barracks','stable','scoutlodge'];
const CAT_NAMES = { resource: 'Resources', defense: 'Defenses', military: 'Military', core: 'Kingdom' };

const UNITS = {
  archer:    { name: 'Archer',    icon: '🏹', from: 'archery',    atk: 9,  hp: 45,  speed: 1.0, range: 130, cost: { gold: 30, food: 15 },            time: 3, housing: 1 },
  swordsman: { name: 'Swordsman', icon: '🗡️', from: 'barracks',   atk: 12, hp: 100, speed: 0.9, range: 16,  cost: { gold: 35, iron: 15, food: 20 }, time: 4, housing: 1 },
  horseman:  { name: 'Horseman',  icon: '🐎', from: 'stable',     atk: 19, hp: 150, speed: 1.8, range: 18,  cost: { gold: 70, iron: 30, food: 40 }, time: 6, housing: 2 },
  scout:     { name: 'Scout',     icon: '🔭', from: 'scoutlodge', atk: 2,  hp: 25,  speed: 2.4, range: 16,  cost: { gold: 40, food: 10 },            time: 3, housing: 1 },
};
const COMBAT_UNITS = ['archer', 'swordsman', 'horseman'];

const RARITY = {
  common:    { name: 'Common',    color: '#a8b0bd', dupXp: 1 },
  rare:      { name: 'Rare',      color: '#4ea1f2', dupXp: 2 },
  epic:      { name: 'Epic',      color: '#b07cf2', dupXp: 3 },
  legendary: { name: 'Legendary', color: '#f2a33a', dupXp: 5 },
};
const GENERALS = [
  { id: 'aldric',   name: 'Sir Aldric',            icon: '🧔', rarity: 'common',    atk: 28, hp: 34, spd: 24, lore: 'A loyal knight of modest talent. Everyone starts somewhere.' },
  { id: 'bran',     name: 'Bran Ironfoot',         icon: '👨‍🦰', rarity: 'common',    atk: 34, hp: 38, spd: 18, spec: 'swordsman', lore: 'Never retreated. Also never hurried.' },
  { id: 'mira',     name: 'Mira of the Vale',      icon: '👩', rarity: 'common',    atk: 30, hp: 26, spd: 40, spec: 'archer', lore: 'Can split an apple at eighty paces.' },
  { id: 'tomas',    name: 'Old Tomas',             icon: '👴', rarity: 'common',    atk: 24, hp: 48, spd: 20, lore: 'Has survived eleven wars and two marriages.' },
  { id: 'seraph',   name: 'Lady Seraphine',        icon: '👸', rarity: 'rare',      atk: 44, hp: 52, spd: 38, lore: 'A tactician whose banners never fall.' },
  { id: 'kael',     name: 'Kael Stormrider',       icon: '🏇', rarity: 'rare',      atk: 50, hp: 36, spd: 66, spec: 'horseman', lore: 'Rides ahead of the thunder.' },
  { id: 'gorran',   name: 'Gorran the Bold',       icon: '🧌', rarity: 'rare',      atk: 58, hp: 50, spd: 28, spec: 'swordsman', lore: 'Bold is an understatement.' },
  { id: 'valeria',  name: 'Valeria Nightshade',    icon: '🧝‍♀️', rarity: 'epic',      atk: 72, hp: 54, spd: 70, spec: 'archer', lore: 'Her arrows arrive before the sound of the bowstring.' },
  { id: 'thorne',   name: 'Thorne Blackwood',      icon: '🧙', rarity: 'epic',      atk: 66, hp: 74, spd: 46, lore: 'Warlord of the deep forests.' },
  { id: 'ysolde',   name: 'Ysolde the Unbroken',   icon: '🛡️', rarity: 'epic',      atk: 56, hp: 90, spd: 40, spec: 'swordsman', lore: 'Shields of her legion never break.' },
  { id: 'aurelius', name: 'Aurelius Dawnbringer',  icon: '🦁', rarity: 'legendary', atk: 90, hp: 86, spd: 64, lore: 'The sun rises wherever he marches.' },
  { id: 'morrigan', name: 'Queen Morrigan',        icon: '🐦‍⬛', rarity: 'legendary', atk: 94, hp: 70, spd: 82, spec: 'horseman', lore: 'Crows gather before her cavalry charges.' },
  { id: 'ragnar',   name: 'Ragnar Wolfheart',      icon: '🐺', rarity: 'legendary', atk: 98, hp: 92, spd: 56, spec: 'swordsman', lore: 'Howls answer his war cry.' },
];

const ITEMS = {
  warhorn: { name: 'War Horn',       icon: '📯', desc: '+30% army attack in your next battle.' },
  salve:   { name: 'Healing Salve',  icon: '🧪', desc: '+30% army health in your next battle.' },
  hammer:  { name: "Builder's Hammer", icon: '🔨', desc: 'Instantly finishes all constructions in progress.' },
  map:     { name: 'Ancient Map',    icon: '🗺️', desc: 'Reveals a large region of the world map.' },
  shield:  { name: 'Peace Shield',   icon: '🕊️', desc: 'No enemy raids for 15 minutes.' },
};

const BOXES = [
  { id: 'wooden', name: 'Wooden Crate',     icon: '📦', glow: '#c8894a55', cost: { gold: 300 },
    kinds: { res: 62, item: 26, general: 12 }, rarity: { common: 82, rare: 16, epic: 2, legendary: 0 }, resScale: 1 },
  { id: 'silver', name: 'Silver Chest',     icon: '🧰', glow: '#9fb3c866', cost: { gold: 1500 },
    kinds: { res: 38, item: 32, general: 30 }, rarity: { common: 45, rare: 40, epic: 13, legendary: 2 }, resScale: 4 },
  { id: 'royal',  name: 'Royal Reliquary',  icon: '👑', glow: '#f2a33a77', cost: { diamonds: 60 },
    kinds: { res: 15, item: 30, general: 55 }, rarity: { common: 0, rare: 48, epic: 38, legendary: 14 }, resScale: 10 },
];

// World terrain
const T = { WATER: 0, PLAINS: 1, FOREST: 2, HILLS: 3, GOLD: 4, GEMS: 5 };
const TERRAIN = {
  0: { name: 'Sea',       color: '#1f4e79' },
  1: { name: 'Plains',    color: '#6f9a4a', bonus: { food: 0.35 } },
  2: { name: 'Forest',    color: '#3f6e36', bonus: { lumber: 0.35 } },
  3: { name: 'Hills',     color: '#8a7e62', bonus: { iron: 0.25 } },
  4: { name: 'Gold Vein', color: '#b39a3c', bonus: { gold: 0.6 } },
  5: { name: 'Gem Cave',  color: '#7a5aa8', bonus: { diamonds: 0.02 } },
};

const KINGDOM_NAMES = ['Vharn Empire', 'Duchy of Elsmere', 'Karrak Hold', 'Sunspear Dominion', 'The Mistral League', 'Grimhollow', 'Ostara Throne', 'Brightwater Realm'];
const RULERS = ['King Oswin', 'Duchess Ilse', 'Warlord Karrak', 'Sultana Reyna', 'Doge Venn', 'Baron Grim', 'Queen Ostara', 'Prince Aldo'];
const KINGDOM_COLORS = ['#d9534f', '#5bc0de', '#9b59b6', '#f0ad4e', '#1abc9c', '#8d6e63', '#e84393', '#7f8c8d'];
const PERSONALITIES = {
  aggressive:   { name: 'Aggressive',   w: { expand: 2, upgrade: 1, build: 1, train: 4 } },
  expansionist: { name: 'Expansionist', w: { expand: 5, upgrade: 1, build: 1, train: 2 } },
  builder:      { name: 'Builder',      w: { expand: 1, upgrade: 3, build: 4, train: 1 } },
  balanced:     { name: 'Balanced',     w: { expand: 2, upgrade: 2, build: 2, train: 2 } },
};
const ALLIANCE_COLORS = ['#f2c14e', '#e5534b', '#4ea1f2', '#57c26b', '#b07cf2', '#e84393'];
const ALLIANCE_EMBLEMS = ['🦅', '🐉', '🦁', '🐺', '⚜️', '🌙'];

/* =============================== 2. UTILS =============================== */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash2 = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
function weighted(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { if ((r -= w) <= 0) return k; }
  return entries[entries.length - 1][0];
}
function fmt(n) {
  n = Math.floor(n);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k';
  return String(n);
}
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
  return Math.floor(s / 3600) + 'h ' + String(Math.floor(s / 60) % 60).padStart(2, '0') + 'm';
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const costHtml = (cost, have) => '<span class="cost">' + Object.entries(cost).filter(([, v]) => v > 0).map(([k, v]) =>
  `<span class="${have && have[k] < v ? 'short' : ''}">${RES_META[k].icon}${fmt(v)}</span>`).join('') + '</span>';
const nowSec = () => performance.now() / 1000;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ================================ 3. STATE =============================== */

const params = new URLSearchParams(location.search);
const SLOT = (params.get('slot') || 'main').replace(/[^\w-]/g, '');
const SAVE_KEY = 'ironcrown-save-' + SLOT;
const PID_KEY = 'ironcrown-player-id';
let S = null;                 // the whole persistent game state
const UI = {                  // transient UI state (never saved)
  view: 'kingdom', tab: 'info', selected: null, placing: null, worldSel: null,
  hover: null, fx: [], panelDirty: true, lastPanelHtml: '', pointerDown: false,
  raid: null, logUnread: false, attackDraft: null,
};

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function newGame(name) {
  S = {
    version: VERSION, seed: Math.floor(Math.random() * 1e9), name: name || 'Ironcrown', time: 0, savedAt: Date.now(),
    res: { gold: 900, iron: 300, diamonds: 25, lumber: 750, food: 500 },
    buildings: [], nextId: 1,
    army: { archer: 6, swordsman: 4, horseman: 0, scout: 2 },
    generals: [{ id: 'aldric', stars: 1, xp: 0 }], activeGeneral: 'aldric',
    items: { warhorn: 1, salve: 0, hammer: 1, map: 0, shield: 0 },
    boosts: { warhorn: false, salve: false }, shield: 0,
    world: null, kingdoms: [], missions: [], intel: {},
    alliances: [], allianceId: null,
    log: [], stats: { battlesWon: 0, battlesLost: 0, raidsRepelled: 0, raidsLost: 0, boxesOpened: 0, scouted: 0 },
    aiTimer: AI_TICK, raidTimer: 480, started: false,
  };
  addBuilding('hall', HALL_X, HALL_Y, 1);
  addBuilding('goldmine', 10, 6, 1);
  addBuilding('lumbermill', 10, 9, 1);
  addBuilding('farm', 15, 8, 1);
  generateWorld();
  createAlliances();
  log('Your reign begins. Build up your kingdom and scout the lands around you.', 'info');
}

function save() {
  if (!S) return;
  S.savedAt = Date.now();
  const ok = storage.set(SAVE_KEY, JSON.stringify(S));
  API.push();
  return ok;
}

function load() {
  const raw = storage.get(SAVE_KEY);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== VERSION) return false;
    S = data;
    return true;
  } catch { return false; }
}

// Offline progress: simulate the time the tab was closed (capped).
function catchUp() {
  const away = Math.min(OFFLINE_CAP, (Date.now() - S.savedAt) / 1000);
  if (away < 5) return;
  const before = { ...S.res };
  let t = away;
  while (t > 0) { const d = Math.min(5, t); step(d, true); t -= d; }
  const gains = RES.map((k) => [k, S.res[k] - before[k]]).filter(([, v]) => Math.abs(v) >= 1);
  if (gains.length) {
    log(`While you were away (${fmtTime(away)}) your kingdom produced ` + gains.map(([k, v]) => `${RES_META[k].icon}${fmt(v)}`).join(' '), 'good');
    toast(`Welcome back! ${fmtTime(away)} of production collected.`, 'good');
  }
}

// Optional Python backend (server/server.py). On GitHub Pages it is absent and
// the game silently stays in local-only mode.
const API = {
  online: false, lastPush: 0, pid: null,
  async init() {
    this.pid = storage.get(PID_KEY) || uid();
    storage.set(PID_KEY, this.pid);
    if (location.protocol === 'file:') return;
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      this.online = !!(j && j.ok);
    } catch { this.online = false; }
  },
  async pull() {
    if (!this.online) return null;
    try {
      const r = await fetch(`api/save/${this.pid}-${SLOT}`, { cache: 'no-store' });
      return r.ok ? (await r.json()).state : null;
    } catch { return null; }
  },
  push(force) {
    if (!this.online || !S) return;
    const now = Date.now();
    if (!force && now - this.lastPush < 15000) return;
    this.lastPush = now;
    const body = JSON.stringify({ meta: { name: S.name, power: Math.round(totalPower()), hall: hallLevel() }, state: S });
    fetch(`api/save/${this.pid}-${SLOT}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then((r) => { el('sync').classList.toggle('online', r.ok); el('sync-label').textContent = r.ok ? 'synced' : 'local'; })
      .catch(() => {});
  },
  async leaderboard() {
    if (!this.online) return null;
    try { const r = await fetch('api/leaderboard', { cache: 'no-store' }); return r.ok ? (await r.json()).players : null; } catch { return null; }
  },
};

function log(text, kind = 'info') {
  if (!S) return;
  S.log.unshift({ t: S.time, text, kind });
  if (S.log.length > 80) S.log.length = 80;
  if (UI.tab !== 'log') UI.logUnread = true;
  UI.panelDirty = true;
}

/* =============================== 4. ECONOMY ============================== */

const hallLevel = () => (S.buildings.find((b) => b.type === 'hall') || { level: 1 }).level;
const countOf = (type) => S.buildings.filter((b) => b.type === type).length;
const limitOf = (type, hl = hallLevel()) => BUILDINGS[type].limit[hl - 1] || 0;
const builderCount = () => [2, 2, 3, 3, 4, 4][hallLevel() - 1];
const buildersBusy = () => S.buildings.filter((b) => b.build > 0).length;
const landRadius = () => 2.5 + hallLevel();

function capOf(k) {
  const hl = hallLevel();
  return k === 'diamonds' ? 150 + 120 * (hl - 1) : Math.round(3000 * Math.pow(2, hl - 1));
}

function costFor(type, targetLevel) {
  const d = BUILDINGS[type];
  const exp = type === 'hall' ? targetLevel - 2 : targetLevel - 1;
  const c = {};
  for (const [k, v] of Object.entries(d.base)) c[k] = Math.round((v * Math.pow(d.mult, exp)) / 5) * 5;
  return c;
}
const buildTime = (type, targetLevel) => Math.round(BUILDINGS[type].time * Math.pow(targetLevel, 1.5));
const canAfford = (cost) => Object.entries(cost).every(([k, v]) => S.res[k] >= v);
function pay(cost) {
  if (!canAfford(cost)) return false;
  for (const [k, v] of Object.entries(cost)) S.res[k] -= v;
  return true;
}
function gain(res, allowOverCap = false) {
  for (const [k, v] of Object.entries(res)) {
    if (!v) continue;
    const cap = capOf(k);
    S.res[k] = allowOverCap ? S.res[k] + v : Math.max(S.res[k], Math.min(cap, S.res[k] + v));
    S.res[k] = Math.max(0, S.res[k]);
  }
  bumpRes(Object.keys(res));
}

function isUnlockedTile(x, y) {
  const r = landRadius();
  return x < WATER_X && Math.abs(x + 0.5 - (HALL_X + 1)) <= r && Math.abs(y + 0.5 - (HALL_Y + 1)) <= r && x >= 0 && y >= 0 && y < GRID_H;
}
function buildingAt(x, y) {
  return S.buildings.find((b) => { const s = BUILDINGS[b.type].size || 1; return x >= b.x && x < b.x + s && y >= b.y && y < b.y + s; });
}
function placementError(type, x, y) {
  const d = BUILDINGS[type];
  const s = d.size || 1;
  for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) {
    if (!isUnlockedTile(x + i, y + j)) return 'Outside your land';
    if (buildingAt(x + i, y + j)) return 'Tile occupied';
  }
  if (d.coastal && x + s !== WATER_X) return 'Ports must touch the sea';
  return null;
}
function buildLockReason(type) {
  const d = BUILDINGS[type];
  const hl = hallLevel();
  if (d.hall && hl < d.hall) return `Requires Main Hall ${d.hall}`;
  if (countOf(type) >= limitOf(type)) {
    const next = d.limit.findIndex((v, i) => i >= hl && v > countOf(type));
    return next >= 0 ? `Limit reached — Main Hall ${next + 1} allows more` : 'Limit reached';
  }
  if (buildersBusy() >= builderCount()) return 'All builders are busy';
  return null;
}

function addBuilding(type, x, y, level = 0) {
  const b = { id: S.nextId++, type, x, y, level, build: 0, buildTotal: 0 };
  if (BUILDINGS[type].trains) { b.queue = []; b.trainLeft = 0; }
  S.buildings.push(b);
  return b;
}

function placeBuilding(type, x, y) {
  const lock = buildLockReason(type);
  if (lock) { toast(lock, 'bad'); return null; }
  const err = placementError(type, x, y);
  if (err) { toast(err, 'bad'); return null; }
  const cost = costFor(type, 1);
  if (!pay(cost)) { toast('Not enough resources', 'bad'); return null; }
  const b = addBuilding(type, x, y, 0);
  b.build = b.buildTotal = buildTime(type, 1);
  spawnDust(x, y, BUILDINGS[type].size || 1);
  UI.panelDirty = true;
  return b;
}

function upgradeError(b) {
  const d = BUILDINGS[b.type];
  if (b.build > 0) return 'Already under construction';
  if (b.type === 'hall' && b.level >= MAX_HALL) return 'Max level';
  if (b.type !== 'hall' && b.level >= hallLevel()) return `Upgrade Main Hall first (max level = hall level)`;
  if (buildersBusy() >= builderCount()) return 'All builders are busy';
  if (!canAfford(costFor(b.type, b.level + 1))) return 'Not enough resources';
  if (d.hall && hallLevel() < d.hall) return `Requires Main Hall ${d.hall}`;
  return null;
}
function upgradeBuilding(b) {
  const err = upgradeError(b);
  if (err) { toast(err, 'bad'); return false; }
  pay(costFor(b.type, b.level + 1));
  b.build = b.buildTotal = buildTime(b.type, b.level + 1);
  spawnDust(b.x, b.y, BUILDINGS[b.type].size || 1);
  UI.panelDirty = true;
  return true;
}
function demolish(b) {
  if (b.type === 'hall') return;
  const refund = {};
  for (const [k, v] of Object.entries(costFor(b.type, Math.max(1, b.level)))) refund[k] = Math.floor(v * 0.4);
  gain(refund);
  S.buildings = S.buildings.filter((x) => x !== b);
  UI.selected = null;
  UI.panelDirty = true;
  toast(`${BUILDINGS[b.type].name} demolished (40% refunded)`);
}
function completeBuilding(b) {
  b.build = 0;
  b.level++;
  const d = BUILDINGS[b.type];
  log(`${d.name} ${b.level === 1 ? 'constructed' : 'upgraded to level ' + b.level}.`, 'good');
  if (b.type !== 'wall') toast(`${d.icon} ${d.name} ${b.level === 1 ? 'is ready' : '→ level ' + b.level}`, 'good');
  if (b.type === 'hall') {
    toast(`Main Hall ${b.level}! New land and buildings unlocked.`, 'good');
    celebrate();
  }
  spawnSparkles(b);
  UI.panelDirty = true;
}

function allianceBonus() {
  const a = S.alliances.find((x) => x.id === S.allianceId);
  if (!a) return { prod: 0, atk: 0, def: 0, train: 0 };
  return { prod: 0.03 * a.level + 0.01 * a.members.length, atk: 0.02 * a.level, def: 0.04 * a.level, train: 0.05 * a.level };
}

function productionOf(b) {
  const d = BUILDINGS[b.type];
  if (b.level < 1) return null;
  if (d.produces) return [d.produces, d.rate * b.level * (1 + 0.25 * (b.level - 1))];
  if (b.type === 'port') return ['gold', d.rate * b.level * (1 + 0.2 * (b.level - 1))];
  if (b.type === 'hall') return ['gold', 0.5 * b.level];
  return null;
}

function territoryBonus() {
  const r = Object.fromEntries(RES.map((k) => [k, 0]));
  if (!S.world) return r;
  const { owner, tiles } = S.world;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== -2) continue;
    const bonus = TERRAIN[tiles[i]].bonus;
    if (bonus) for (const [k, v] of Object.entries(bonus)) r[k] += v;
  }
  return r;
}

function rates() {
  const r = Object.fromEntries(RES.map((k) => [k, 0]));
  for (const b of S.buildings) {
    const p = productionOf(b);
    if (p) r[p[0]] += p[1];
  }
  const tb = territoryBonus();
  const mult = 1 + allianceBonus().prod;
  for (const k of RES) r[k] = (r[k] + tb[k]) * mult;
  r.food -= armyHousing() * 0.015;   // troops eat
  return r;
}

function defenseRating() {
  let d = 0;
  for (const b of S.buildings) if (BUILDINGS[b.type].def && b.level > 0) d += BUILDINGS[b.type].def * Math.pow(b.level, 1.25);
  return d * (1 + allianceBonus().def);
}

/* =============================== 5. MILITARY ============================= */

const trainerOf = (u) => S.buildings.find((b) => b.type === UNITS[u].from && b.level > 0);
const armyHousing = () => Object.entries(S.army).reduce((s, [k, n]) => s + UNITS[k].housing * n, 0);
const queuedHousing = () => S.buildings.reduce((s, b) => s + (b.queue ? b.queue.reduce((q, u) => q + UNITS[u].housing, 0) : 0), 0);
const armyCap = () => 10 + 15 * hallLevel() + S.buildings.filter((b) => BUILDINGS[b.type].trains).reduce((s, b) => s + 3 * b.level, 0);
const queueLimit = (b) => 5 + 5 * b.level;

function generalData(id = S.activeGeneral) { return GENERALS.find((g) => g.id === id); }
function ownedGeneral(id = S.activeGeneral) { return S.generals.find((g) => g.id === id); }
function generalStats(id = S.activeGeneral) {
  const g = generalData(id), o = ownedGeneral(id) || { stars: 1 };
  const m = 1 + 0.1 * (o.stars - 1);
  return { atk: Math.min(100, Math.round(g.atk * m)), hp: Math.min(100, Math.round(g.hp * m)), spd: Math.min(100, Math.round(g.spd * m)) };
}
function generalMult(unit) {
  const gs = generalStats(), g = generalData();
  const spec = g.spec === unit ? 0.15 : 0;
  return { atk: 1 + gs.atk / 200 + spec, hp: 1 + gs.hp / 200 + spec, spd: 1 + gs.spd / 400 };
}
function unitStats(u, boosts = {}) {
  const U = UNITS[u], t = trainerOf(u), lvl = t ? t.level : 1;
  const lm = 1 + 0.12 * (lvl - 1), gm = generalMult(u), ab = allianceBonus();
  return {
    atk: U.atk * lm * gm.atk * (1 + ab.atk) * (boosts.warhorn ? 1.3 : 1),
    hp: U.hp * lm * gm.hp * (boosts.salve ? 1.3 : 1),
    speed: U.speed * gm.spd, range: U.range, level: lvl,
  };
}
const unitPower = (st) => st.atk + st.hp / 5;
function armyPower(army = S.army) {
  return COMBAT_UNITS.reduce((s, u) => s + unitPower(unitStats(u)) * (army[u] || 0), 0);
}
const totalPower = () => armyPower() + defenseRating();

function trainUnits(u, n) {
  const U = UNITS[u], b = trainerOf(u);
  if (!b) { toast(`Build a ${BUILDINGS[U.from].name} first`, 'bad'); return 0; }
  let made = 0;
  for (let i = 0; i < n; i++) {
    if (b.queue.length >= queueLimit(b)) { if (!made) toast('Training queue is full', 'bad'); break; }
    if (armyHousing() + queuedHousing() + U.housing > armyCap()) { if (!made) toast('Army housing is full — upgrade your Main Hall or barracks', 'bad'); break; }
    if (!pay(U.cost)) { if (!made) toast('Not enough resources', 'bad'); break; }
    if (!b.queue.length) b.trainLeft = U.time;
    b.queue.push(u);
    made++;
  }
  UI.panelDirty = true;
  return made;
}
function cancelTraining(b) {
  const u = b.queue.pop();
  if (!u) return;
  gain(UNITS[u].cost);
  if (!b.queue.length) b.trainLeft = 0;
  UI.panelDirty = true;
}
function stepTraining(b, dt) {
  if (!b.queue || !b.queue.length || b.level < 1) return;
  b.trainLeft -= dt * (1 + allianceBonus().train);
  while (b.trainLeft <= 0 && b.queue.length) {
    const u = b.queue.shift();
    S.army[u]++;
    UI.panelDirty = true;
    if (b.queue.length) b.trainLeft += UNITS[b.queue[0]].time; else b.trainLeft = 0;
  }
}

function appointGeneral(id) {
  if (!ownedGeneral(id)) return;
  S.activeGeneral = id;
  toast(`${generalData(id).name} now commands your armies`, 'good');
  UI.panelDirty = true;
}
function grantGeneral(id) {
  const o = ownedGeneral(id), g = generalData(id);
  if (!o) { S.generals.push({ id, stars: 1, xp: 0 }); return { dup: false }; }
  if (o.stars < 5) { o.stars++; return { dup: true, stars: o.stars }; }
  const gold = 400 * RARITY[g.rarity].dupXp;
  gain({ gold }, true);
  return { dup: true, max: true, gold };
}

function useItem(k) {
  if (!S.items[k]) return;
  if (k === 'warhorn' || k === 'salve') {
    if (S.boosts[k]) { toast('Already active for your next battle'); return; }
    S.boosts[k] = true;
    toast(`${ITEMS[k].icon} ${ITEMS[k].name} will empower your next battle`, 'good');
  } else if (k === 'hammer') {
    const pending = S.buildings.filter((b) => b.build > 0);
    if (!pending.length) { toast('Nothing is under construction', 'bad'); return; }
    pending.forEach(completeBuilding);
  } else if (k === 'map') {
    const target = S.kingdoms.find((kk) => !isSeen(kk.cx, kk.cy)) || S.kingdoms[0];
    reveal(target.cx, target.cy, 5);
    toast(`The map reveals the lands of ${target.name}`, 'good');
    log(`An ancient map revealed the lands around ${target.name}.`, 'info');
  } else if (k === 'shield') {
    S.shield += 900;
    toast('Peace Shield raised for 15 minutes', 'good');
  }
  S.items[k]--;
  UI.panelDirty = true;
}

// ---- Mystery boxes ----
function rollBox(box) {
  const kind = weighted(box.kinds);
  if (kind === 'general') {
    const rarity = weighted(box.rarity);
    const g = pick(GENERALS.filter((x) => x.rarity === rarity));
    const res = grantGeneral(g.id);
    return { kind, rarity, general: g, ...res };
  }
  if (kind === 'item') {
    const k = pick(Object.keys(ITEMS));
    const qty = box.resScale >= 4 ? randi(1, 2) : 1;
    S.items[k] += qty;
    return { kind, item: k, qty, rarity: box.resScale >= 10 ? 'epic' : box.resScale >= 4 ? 'rare' : 'common' };
  }
  const pool = ['gold', 'lumber', 'iron', 'food'];
  const bundle = {};
  const n = randi(2, 3);
  for (let i = 0; i < n; i++) { const k = pick(pool); bundle[k] = (bundle[k] || 0) + Math.round(rand(250, 600) * box.resScale / 10) * 10; }
  if (box.resScale >= 4 || Math.random() < 0.2) bundle.diamonds = Math.round(rand(3, 8) * Math.sqrt(box.resScale));
  gain(bundle, true);
  return { kind: 'res', bundle, rarity: box.resScale >= 10 ? 'epic' : box.resScale >= 4 ? 'rare' : 'common' };
}
function openBox(id) {
  const box = BOXES.find((b) => b.id === id);
  if (!pay(box.cost)) { toast('Not enough ' + Object.keys(box.cost).map((k) => RES_META[k].name).join('/'), 'bad'); return null; }
  const reward = rollBox(box);
  S.stats.boxesOpened++;
  log(`Opened a ${box.name}: ${rewardText(reward)}.`, reward.kind === 'general' && reward.rarity !== 'common' ? 'good' : 'info');
  showBoxOpening(box, reward);
  UI.panelDirty = true;
  return reward;
}
function rewardText(r) {
  if (r.kind === 'general') return `${RARITY[r.rarity].name} general ${r.general.name}` + (r.max ? ` (max stars → +${r.gold} gold)` : r.dup ? ` (duplicate → ${r.stars}★)` : '');
  if (r.kind === 'item') return `${r.qty}× ${ITEMS[r.item].name}`;
  return Object.entries(r.bundle).map(([k, v]) => `${RES_META[k].icon}${fmt(v)}`).join(' ');
}

/* ================================ 6. WORLD =============================== */

const widx = (x, y) => y * WORLD_W + x;
const inWorld = (x, y) => x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H;
const isSeen = (x, y) => inWorld(x, y) && S.world.seen[widx(x, y)] === 1;
const playerCapital = () => S.world.capital;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function makeNoise(rng, cell) {
  const gw = Math.ceil(WORLD_W / cell) + 2, gh = Math.ceil(WORLD_H / cell) + 2;
  const g = Array.from({ length: gw * gh }, rng);
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = sm(fx - ix), ty = sm(fy - iy);
    const v = (i, j) => g[(iy + j) * gw + (ix + i)];
    return lerp(lerp(v(0, 0), v(1, 0), tx), lerp(v(0, 1), v(1, 1), tx), ty);
  };
}

function generateWorld() {
  const rng = mulberry32(S.seed);
  const n1 = makeNoise(rng, 6), n2 = makeNoise(rng, 3), n3 = makeNoise(rng, 5);
  const tiles = new Array(WORLD_W * WORLD_H);
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    const edge = clamp(Math.min(x, y, WORLD_W - 1 - x, WORLD_H - 1 - y) / 3, 0, 1);
    const east = clamp((x - (WORLD_W - 11)) / 5, 0, 1);
    const h = n1(x, y) * 0.65 + n2(x, y) * 0.35 + 0.16 - (1 - edge) * 0.45 - east * 0.9;
    let t;
    if (h < 0.36) t = T.WATER;
    else if (h > 0.66 && n2(x + 7, y + 3) > 0.45) t = T.HILLS;
    else t = n3(x, y) > 0.55 ? T.FOREST : T.PLAINS;
    if ((t === T.HILLS || t === T.PLAINS) && rng() < 0.045) t = T.GOLD;
    tiles[widx(x, y)] = t;
  }
  const capital = { x: 9, y: 11 };
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const i = widx(capital.x + dx, capital.y + dy);
    if (tiles[i] === T.WATER) tiles[i] = T.PLAINS;
  }
  // Islands out east — only reachable with a Port.
  for (let k = 0; k < 3; k++) {
    const cx = WORLD_W - 5 + Math.floor(rng() * 2), cy = 3 + k * 7 + Math.floor(rng() * 3);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!inWorld(cx + dx, cy + dy) || (Math.abs(dx) + Math.abs(dy) === 2 && rng() < 0.6)) continue;
      tiles[widx(cx + dx, cy + dy)] = rng() < 0.5 ? T.FOREST : T.PLAINS;
    }
    tiles[widx(cx, cy)] = T.GEMS;
  }
  // Mainland connectivity (for placing kingdoms).
  const main = new Uint8Array(WORLD_W * WORLD_H);
  const stack = [[capital.x, capital.y]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (!inWorld(x, y) || main[widx(x, y)] || tiles[widx(x, y)] === T.WATER) continue;
    main[widx(x, y)] = 1;
    N4.forEach(([dx, dy]) => stack.push([x + dx, y + dy]));
  }
  // One gem cave deep on the mainland.
  const far = [];
  for (let i = 0; i < main.length; i++) if (main[i]) far.push(i);
  far.sort((a, b) => dist(b % WORLD_W, (b / WORLD_W) | 0, capital.x, capital.y) - dist(a % WORLD_W, (a / WORLD_W) | 0, capital.x, capital.y));
  tiles[far[Math.floor(rng() * 6)]] = T.GEMS;

  const owner = new Array(WORLD_W * WORLD_H).fill(-1);
  const seen = new Array(WORLD_W * WORLD_H).fill(0);
  S.world = { tiles, owner, seen, capital };
  claimAround(capital.x, capital.y, -2);

  // AI kingdoms
  const spots = [];
  for (let tries = 0; spots.length < 6 && tries < 4000; tries++) {
    const x = 2 + Math.floor(rng() * (WORLD_W - 4)), y = 2 + Math.floor(rng() * (WORLD_H - 4));
    if (!main[widx(x, y)] || tiles[widx(x, y)] === T.GEMS) continue;
    if (dist(x, y, capital.x, capital.y) < (tries < 2500 ? 7 : 5)) continue;
    if (spots.some((s) => dist(s.x, s.y, x, y) < (tries < 2500 ? 5.5 : 4))) continue;
    spots.push({ x, y });
  }
  const pers = Object.keys(PERSONALITIES);
  S.kingdoms = spots.map((p, i) => {
    const hall = 1 + (i % 3);
    const k = {
      id: i, name: KINGDOM_NAMES[i], ruler: RULERS[i], color: KINGDOM_COLORS[i], cx: p.x, cy: p.y, hall,
      power: Math.round(140 + hall * 120 + rng() * 90), defense: Math.round(40 * hall + rng() * 40),
      res: { gold: 800 * hall, iron: 300 * hall, lumber: 700 * hall, food: 600 * hall, diamonds: 10 * hall },
      personality: pers[i % pers.length], relation: Math.round(rng() * 50 - 20), allianceId: null, defeats: 0,
    };
    claimAround(p.x, p.y, i);
    return k;
  });
  reveal(capital.x, capital.y, 3);
}

function claimAround(x, y, who) {
  const { owner, tiles } = S.world;
  owner[widx(x, y)] = who;
  N4.forEach(([dx, dy]) => {
    const i = widx(x + dx, y + dy);
    if (inWorld(x + dx, y + dy) && tiles[i] !== T.WATER && owner[i] === -1) owner[i] = who;
  });
}

function reveal(x, y, r) {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (!inWorld(x + dx, y + dy) || dx * dx + dy * dy > r * r + 1) continue;
    const i = widx(x + dx, y + dy);
    if (!S.world.seen[i]) { S.world.seen[i] = 1; n++; }
  }
  UI.panelDirty = true;
  return n;
}

const playerTiles = () => S.world.owner.reduce((s, o) => s + (o === -2 ? 1 : 0), 0);
const kingdomTiles = (id) => S.world.owner.reduce((s, o) => s + (o === id ? 1 : 0), 0);
const territoryLimit = () => 5 + 4 * hallLevel();
const hasPort = () => S.buildings.some((b) => b.type === 'port' && b.level > 0);
function claimCost() {
  const n = Math.max(0, playerTiles() - 5);
  return { gold: Math.round(150 * Math.pow(1.16, n) / 5) * 5, food: Math.round(80 * Math.pow(1.12, n) / 5) * 5 };
}
function claimError(x, y) {
  const i = widx(x, y), { tiles, owner } = S.world;
  if (!isSeen(x, y)) return 'Scout this land first';
  if (tiles[i] === T.WATER) return 'You cannot claim the open sea';
  if (owner[i] === -2) return 'Already yours';
  if (owner[i] >= 0) return 'Owned by ' + S.kingdoms[owner[i]].name + ' — conquer it in battle';
  if (playerTiles() >= territoryLimit()) return `Territory limit (${territoryLimit()}) — upgrade your Main Hall`;
  const adjacent = N4.some(([dx, dy]) => inWorld(x + dx, y + dy) && owner[widx(x + dx, y + dy)] === -2);
  if (!adjacent) {
    if (!hasPort()) return 'Must border your territory (build a Port to reach across water)';
    let near = false;
    for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3; dx++) if (inWorld(x + dx, y + dy) && owner[widx(x + dx, y + dy)] === -2) { near = true; break; }
    if (!near) return 'Too far — must be within 3 tiles of your land';
  }
  if (!canAfford(claimCost())) return 'Not enough resources';
  return null;
}
function claimTile(x, y) {
  const err = claimError(x, y);
  if (err) { toast(err, 'bad'); return false; }
  pay(claimCost());
  S.world.owner[widx(x, y)] = -2;
  reveal(x, y, 1);
  const t = TERRAIN[S.world.tiles[widx(x, y)]];
  log(`Claimed ${t.name} at (${x},${y}). ` + (t.bonus ? 'Bonus: ' + Object.entries(t.bonus).map(([k, v]) => `+${v}/s ${RES_META[k].icon}`).join(' ') : ''), 'good');
  toast(`${t.name} claimed!`, 'good');
  return true;
}

// ---- Scouting ----
function sendScouts(x, y, n) {
  n = Math.min(n, S.army.scout);
  if (n < 1) { toast('No scouts available — train some at the Scout Lodge', 'bad'); return false; }
  const c = playerCapital();
  const d = dist(c.x, c.y, x, y);
  const total = Math.round(3 + d * 0.9 / generalMult('scout').spd);
  S.army.scout -= n;
  S.missions.push({ id: uid(), kind: 'scout', x, y, n, left: total, total });
  toast(`${n} scout${n > 1 ? 's' : ''} dispatched (${fmtTime(total)})`);
  UI.panelDirty = true;
  return true;
}
function completeScout(m) {
  const lodge = S.buildings.find((b) => b.type === 'scoutlodge' && b.level > 0);
  const r = Math.min(6, 2 + (lodge ? lodge.level : 0) + Math.floor(m.n / 3));
  const newly = reveal(m.x, m.y, r);
  const ownerId = S.world.owner[widx(m.x, m.y)];
  let lost = 0;
  if (ownerId >= 0) {
    const k = S.kingdoms[ownerId];
    const p = clamp(k.defense / (k.defense + 500), 0.05, 0.45);
    for (let i = 0; i < m.n; i++) if (Math.random() < p) lost++;
  }
  S.army.scout += m.n - lost;
  S.stats.scouted++;
  const reports = [];
  for (const k of S.kingdoms) {
    if (dist(k.cx, k.cy, m.x, m.y) <= r + 1 || ownerId === k.id) {
      S.intel[k.id] = { t: S.time, power: Math.round(k.power), defense: Math.round(k.defense), hall: k.hall, res: { ...k.res }, tiles: kingdomTiles(k.id) };
      reports.push(k.name);
    }
  }
  const msg = `Scouts returned from (${m.x},${m.y}): ${newly} tiles revealed` + (reports.length ? `, intel gathered on ${reports.join(', ')}` : '') + (lost ? `. ${lost} scout${lost > 1 ? 's were' : ' was'} captured.` : '.');
  log(msg, lost ? 'bad' : 'good');
  toast(`🔭 ${msg}`, lost ? 'bad' : 'good');
}

// ---- AI kingdoms ----
function aiTurn(offline) {
  const pp = totalPower();
  for (const k of S.kingdoms) {
    for (const r of Object.keys(k.res)) k.res[r] += (r === 'diamonds' ? 1 : 70) * k.hall;
    const w = { ...PERSONALITIES[k.personality].w };
    if (k.power < pp * 0.6) w.train += 3;               // keep pace with the player
    if (k.hall >= MAX_HALL) w.upgrade = 0;
    const action = weighted(w);
    const visible = isSeen(k.cx, k.cy);
    if (action === 'expand') {
      const limit = 5 + 4 * k.hall;
      if (kingdomTiles(k.id) < limit) {
        const cand = [];
        const { owner, tiles } = S.world;
        for (let i = 0; i < owner.length; i++) {
          if (owner[i] !== k.id) continue;
          const x = i % WORLD_W, y = (i / WORLD_W) | 0;
          for (const [dx, dy] of N4) {
            const j = widx(x + dx, y + dy);
            if (inWorld(x + dx, y + dy) && owner[j] === -1 && tiles[j] !== T.WATER) cand.push(j);
          }
        }
        if (cand.length) {
          cand.sort((a, b) => dist(a % WORLD_W, (a / WORLD_W) | 0, k.cx, k.cy) - dist(b % WORLD_W, (b / WORLD_W) | 0, k.cx, k.cy));
          const j = cand[Math.floor(Math.random() * Math.min(3, cand.length))];
          S.world.owner[j] = k.id;
          if (!offline && S.world.seen[j] && Math.random() < 0.35) log(`${k.name} expanded its borders.`, 'info');
        } else k.power += 10 + k.hall * 8;
      } else k.defense += 10;
    } else if (action === 'upgrade') {
      const need = 600 * Math.pow(2.2, k.hall);
      if (k.res.gold >= need && k.res.lumber >= need * 0.8) {
        k.res.gold -= need; k.res.lumber -= need * 0.8;
        k.hall++; k.power *= 1.1; k.defense *= 1.1;
        if (visible && !offline) log(`${k.name} upgraded its Keep to level ${k.hall}!`, 'info');
      } else k.defense += 6;
    } else if (action === 'build') {
      k.defense += 12 + k.hall * 6;
    } else {
      k.power += 15 + k.hall * 10;
    }
    k.relation += k.relation > 0 ? -0.3 : 0.4;
  }
  // Occasional wars between AI kingdoms.
  if (Math.random() < 0.12) {
    const a = pick(S.kingdoms.filter((k) => k.personality === 'aggressive' || k.personality === 'expansionist'));
    const targets = S.kingdoms.filter((k) => k !== a && (k.allianceId == null || k.allianceId !== a.allianceId) && dist(k.cx, k.cy, a.cx, a.cy) < 12);
    if (a && targets.length) {
      const b = pick(targets);
      const win = Math.random() < a.power / (a.power + b.power + b.defense * 0.5);
      const [w, l] = win ? [a, b] : [b, a];
      w.power *= 0.85; l.power *= 0.7;
      const taken = transferBorderTile(l.id, w.id);
      if (!offline && (isSeen(a.cx, a.cy) || isSeen(b.cx, b.cy))) log(`⚔️ ${a.name} attacked ${b.name} — ${w.name} prevailed${taken ? ' and seized land' : ''}.`, 'info');
    }
  }
  allianceTurn(offline);
  UI.panelDirty = true;
}
function transferBorderTile(fromId, toId) {
  const { owner } = S.world;
  const from = fromId === -2 ? playerCapital() : S.kingdoms[fromId] && { x: S.kingdoms[fromId].cx, y: S.kingdoms[fromId].cy };
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== fromId) continue;
    const x = i % WORLD_W, y = (i / WORLD_W) | 0;
    if (from && x === from.x && y === from.y) continue;           // capitals never fall
    if (N4.some(([dx, dy]) => inWorld(x + dx, y + dy) && owner[widx(x + dx, y + dy)] === toId)) { owner[i] = toId; return true; }
  }
  return false;
}

// ---- Raids on the player ----
function raidCandidates() {
  return S.kingdoms.filter((k) => (S.allianceId == null || k.allianceId !== S.allianceId) && (k.relation < 0 || k.personality === 'aggressive'));
}
function scheduleRaid() { S.raidTimer = rand(300, 540) / (1 + 0.08 * hallLevel()); }
function startRaid(k) {
  if (S.shield > 0) { log(`${k.name} marched on you but turned back at the sight of your Peace Shield.`, 'info'); return; }
  S.raid = { kid: k.id, left: 9, total: 9, size: clamp(Math.round(k.power / 40), 6, 30) };
  toast(`⚠️ ${k.name} is raiding your kingdom!`, 'bad');
  log(`${k.name} launched a raid against you!`, 'bad');
}
function alliedHelp() {
  if (S.allianceId == null) return 0;
  return S.kingdoms.filter((k) => k.allianceId === S.allianceId).reduce((s, k) => s + k.power * 0.12, 0);
}
function resolveRaid() {
  const k = S.kingdoms[S.raid.kid];
  S.raid = null;
  const attack = k.power * rand(0.35, 0.6);
  const help = alliedHelp();
  const defense = defenseRating() + armyPower() * 0.5 + help;
  const win = Math.random() < defense / (defense + attack);
  const lossFrac = win ? 0.05 : 0.15;
  const lostUnits = {};
  for (const u of COMBAT_UNITS) { const l = Math.floor(S.army[u] * lossFrac * rand(0.5, 1.2)); if (l) { S.army[u] -= l; lostUnits[u] = l; } }
  const lostText = Object.entries(lostUnits).map(([u, n]) => `${n} ${UNITS[u].name}${n > 1 ? 's' : ''}`).join(', ');
  k.relation -= 5;
  if (win) {
    const loot = { gold: Math.round(k.res.gold * 0.05) };
    k.res.gold -= loot.gold; k.power *= 0.8;
    gain(loot);
    S.stats.raidsRepelled++;
    const msg = `Raid by ${k.name} repelled!${help ? ' Allies sent reinforcements.' : ''} +${fmt(loot.gold)} gold from the fleeing enemy.` + (lostText ? ` Lost ${lostText}.` : '');
    log(msg, 'good'); toast('🛡️ ' + msg, 'good');
  } else {
    const stolen = {};
    for (const r of RES) { const f = r === 'diamonds' ? 0.05 : rand(0.12, 0.22); stolen[r] = Math.floor(S.res[r] * f); S.res[r] -= stolen[r]; k.res[r] = (k.res[r] || 0) + stolen[r]; }
    const tile = Math.random() < 0.5 && transferBorderTile(-2, k.id);
    S.stats.raidsLost++;
    const msg = `${k.name} broke through! They plundered ` + Object.entries(stolen).filter(([, v]) => v > 0).map(([r, v]) => `${RES_META[r].icon}${fmt(v)}`).join(' ') + (tile ? ' and seized a border territory' : '') + '.' + (lostText ? ` Lost ${lostText}.` : '');
    log(msg, 'bad'); toast('🔥 ' + msg, 'bad');
    shake(12);
  }
  UI.panelDirty = true;
}

/* ---- The simulation step: everything that advances with time ---- */
function step(dt, offline = false) {
  S.time += dt;
  const r = rates();
  for (const k of RES) {
    const cap = capOf(k);
    if (r[k] >= 0) { if (S.res[k] < cap) S.res[k] = Math.min(cap, S.res[k] + r[k] * dt); }
    else S.res[k] = Math.max(0, S.res[k] + r[k] * dt);
  }
  for (const b of S.buildings) {
    if (b.build > 0) { b.build -= dt; if (b.build <= 0) completeBuilding(b); }
    if (b.queue) stepTraining(b, dt);
  }
  for (const m of S.missions) { m.left -= dt; if (m.left <= 0) completeScout(m); }
  S.missions = S.missions.filter((m) => m.left > 0);
  if (S.shield > 0) S.shield = Math.max(0, S.shield - dt);
  S.aiTimer -= dt;
  while (S.aiTimer <= 0) { aiTurn(offline); S.aiTimer += AI_TICK; }
  if (S.raid) { S.raid.left -= dt; if (S.raid.left <= 0) resolveRaid(); }
  else if (!offline && S.started) {
    S.raidTimer -= dt;
    if (S.raidTimer <= 0) {
      scheduleRaid();
      const c = raidCandidates();
      if (c.length && (hallLevel() >= 2 || S.time > 900)) startRaid(S.kingdoms[+weighted(Object.fromEntries(c.map((k) => [k.id, k.power * (1 + Math.max(0, -k.relation) / 25)])))]);
    }
  }
}

/* ============================== 7. ALLIANCES ============================= */

const xpNeed = (lvl) => Math.round(800 * Math.pow(lvl, 1.5));
const allianceOf = (id) => S.alliances.find((a) => a.id === id);
const memberName = (m) => (m === 'P' ? S.name + ' (you)' : S.kingdoms[m].name);
const memberColor = (m) => (m === 'P' ? '#f2c14e' : S.kingdoms[m].color);

function createAlliances() {
  const defs = [
    { name: 'The Iron Pact',            emblem: '🐺', color: '#e5534b', members: [0, 2], open: false, minHall: 2, level: 2 },
    { name: 'Sunspear Accord',          emblem: '🦅', color: '#f2a33a', members: [3],    open: true,  minHall: 1, level: 1 },
    { name: 'Order of the Silver Rose', emblem: '⚜️', color: '#4ea1f2', members: [4, 5], open: true,  minHall: 2, level: 3 },
  ];
  S.alliances = defs.filter((d) => d.members.every((m) => S.kingdoms[m])).map((d, i) => {
    const a = { id: 'a' + i, ...d, leader: d.members[0], xp: 0, chat: [] };
    a.members.forEach((m) => { S.kingdoms[m].allianceId = a.id; });
    return a;
  });
}

function joinAlliance(id) {
  const a = allianceOf(id);
  if (!a || S.allianceId) return false;
  if (hallLevel() < a.minHall) { toast(`${a.name} requires Main Hall ${a.minHall}`, 'bad'); return false; }
  if (!a.open) {
    const leader = S.kingdoms[a.leader];
    const chance = clamp(0.35 + leader.relation / 100 + (totalPower() / (leader.power + leader.defense) - 1) * 0.25, 0.05, 0.9);
    if (Math.random() > chance) {
      toast(`${leader.ruler} declined your request to join ${a.name}`, 'bad');
      log(`${a.name} rejected your membership request.`, 'bad');
      leader.relation -= 3;
      return false;
    }
  }
  a.members.push('P');
  S.allianceId = a.id;
  a.members.forEach((m) => { if (m !== 'P') S.kingdoms[m].relation += 20; });
  chat(a, a.leader, `Welcome to ${a.name}, ${S.name}!`);
  log(`You joined ${a.name}.`, 'good');
  toast(`${a.emblem} You joined ${a.name}!`, 'good');
  UI.panelDirty = true;
  return true;
}

function createAlliance(name, color, emblem) {
  name = (name || '').trim().slice(0, 28);
  if (S.allianceId) return false;
  if (name.length < 3) { toast('Alliance name needs at least 3 characters', 'bad'); return false; }
  if (S.alliances.some((a) => a.name.toLowerCase() === name.toLowerCase())) { toast('That name is taken', 'bad'); return false; }
  if (!pay({ gold: 1000 })) { toast('Founding an alliance costs 🪙1000', 'bad'); return false; }
  const a = { id: 'p' + uid(), name, emblem, color, members: ['P'], leader: 'P', open: true, minHall: 1, level: 1, xp: 0, chat: [] };
  S.alliances.push(a);
  S.allianceId = a.id;
  log(`You founded the alliance ${name}.`, 'good');
  toast(`${emblem} ${name} founded!`, 'good');
  UI.panelDirty = true;
  return true;
}

function leaveAlliance() {
  const a = allianceOf(S.allianceId);
  if (!a) return;
  a.members = a.members.filter((m) => m !== 'P');
  S.allianceId = null;
  if (!a.members.length) {
    S.alliances = S.alliances.filter((x) => x !== a);
    log(`${a.name} was disbanded.`, 'info');
  } else {
    if (a.leader === 'P') {
      a.leader = a.members.reduce((best, m) => (S.kingdoms[m].power > S.kingdoms[best].power ? m : best), a.members[0]);
      chat(a, a.leader, `${S.name} has left. I will lead us now.`);
    }
    a.members.forEach((m) => { S.kingdoms[m].relation -= 10; });
    log(`You left ${a.name}.`, 'info');
  }
  UI.panelDirty = true;
}

function inviteKingdom(kid) {
  const a = allianceOf(S.allianceId), k = S.kingdoms[kid];
  if (!a || a.leader !== 'P' || k.allianceId) return false;
  const chance = clamp(0.3 + k.relation / 100 + (totalPower() / (k.power + k.defense) - 1) * 0.2 + a.level * 0.03, 0.05, 0.92);
  if (Math.random() < chance) {
    const prev = allianceOf(k.allianceId);
    if (prev) prev.members = prev.members.filter((m) => m !== kid);
    a.members.push(kid);
    k.allianceId = a.id;
    k.relation += 15;
    chat(a, kid, pick([`${k.ruler} is honoured to join ${a.name}.`, 'Our banners fly beside yours.', 'Together we are unstoppable!']));
    log(`${k.name} accepted your invitation to ${a.name}.`, 'good');
    toast(`🤝 ${k.name} joined ${a.name}!`, 'good');
  } else {
    k.relation -= 2;
    log(`${k.name} declined your alliance invitation.`, 'bad');
    toast(`${k.name} declined your invitation`, 'bad');
  }
  UI.panelDirty = true;
  return true;
}
function kickMember(kid) {
  const a = allianceOf(S.allianceId);
  if (!a || a.leader !== 'P') return;
  a.members = a.members.filter((m) => m !== kid);
  S.kingdoms[kid].allianceId = null;
  S.kingdoms[kid].relation -= 25;
  log(`${S.kingdoms[kid].name} was expelled from ${a.name}.`, 'info');
  UI.panelDirty = true;
}
function donate(res, amount) {
  const a = allianceOf(S.allianceId);
  if (!a) return;
  amount = Math.min(amount, Math.floor(S.res[res]));
  if (amount <= 0) { toast('Nothing to donate', 'bad'); return; }
  S.res[res] -= amount;
  addAllianceXp(a, res === 'diamonds' ? amount * 20 : amount);
  toast(`Donated ${RES_META[res].icon}${fmt(amount)} to ${a.name}`, 'good');
  UI.panelDirty = true;
}
function addAllianceXp(a, xp) {
  a.xp += xp;
  while (a.level < 10 && a.xp >= xpNeed(a.level)) {
    a.xp -= xpNeed(a.level); a.level++;
    if (a.id === S.allianceId) { log(`${a.name} reached level ${a.level}! Shared bonuses increased.`, 'good'); toast(`${a.emblem} ${a.name} reached level ${a.level}!`, 'good'); }
  }
}
function chat(a, who, text) {
  a.chat.push({ who, text, t: S.time });
  if (a.chat.length > 40) a.chat.shift();
  if (a.id === S.allianceId) UI.panelDirty = true;
}
function playerChat(text) {
  const a = allianceOf(S.allianceId);
  text = (text || '').trim().slice(0, 140);
  if (!a || !text) return;
  chat(a, 'P', text);
  const others = a.members.filter((m) => m !== 'P');
  if (others.length && Math.random() < 0.8) {
    const m = pick(others);
    setTimeout(() => chat(a, m, pick(['Aye!', `Agreed, ${S.name}.`, 'Ha! Well said.', 'For the alliance!', 'My scouts are on it.', 'We march at dawn.', 'Send more lumber and I am yours.'])), 900 + Math.random() * 1500);
  }
}

function allianceTurn(offline) {
  for (const a of S.alliances) {
    const ai = a.members.filter((m) => m !== 'P');
    addAllianceXp(a, ai.reduce((s, m) => s + S.kingdoms[m].hall * 15, 0));
    if (!offline && ai.length && Math.random() < 0.35) {
      const me = S.kingdoms[pick(ai)];
      const enemies = S.kingdoms.filter((k) => k.allianceId !== a.id);
      const enemy = enemies.length ? pick(enemies).name : 'the raiders';
      chat(a, me.id, pick([
        `Anyone have spare ${pick(['lumber', 'iron', 'food'])}? Building a new ${pick(['tower', 'granary', 'barracks'])}.`,
        `Scouts spotted ${enemy} troops near our border.`,
        `${enemy} just upgraded their keep. Keep an eye on them.`,
        `Alliance level ${a.level + 1} soon — keep donating!`,
        `Who wants to hit ${enemy} together?`,
        a.members.includes('P') ? `Good work out there, ${S.name}.` : 'Quiet day in the realm.',
      ]));
    }
    // AI alliances recruit unaligned kingdoms from time to time.
    if (a.leader !== 'P' && a.open && Math.random() < 0.03) {
      const free = S.kingdoms.filter((k) => k.allianceId == null);
      if (free.length) {
        const k = pick(free);
        a.members.push(k.id); k.allianceId = a.id;
        if (!offline && isSeen(k.cx, k.cy)) log(`${k.name} joined ${a.name}.`, 'info');
      }
    }
  }
}

/* =============================== 8. BATTLE =============================== */

const BW = 960, BH = 520, BDT = 1 / 30, BATTLE_LIMIT = 120;
const Battle = {
  b: null, speed: 1, bg: null,

  start(kid, sent) {
    const k = S.kingdoms[kid];
    const boosts = { ...S.boosts };
    S.boosts = { warhorn: false, salve: false };
    for (const u of COMBAT_UNITS) S.army[u] -= sent[u];
    const b = { kid, sent, boosts, t: 0, units: [], towers: [], shots: [], fx: [], done: false, result: null, nextId: 1 };
    // attackers
    const total = COMBAT_UNITS.reduce((s, u) => s + sent[u], 0);
    const g = Math.max(1, Math.ceil(total / 60));
    const layout = { archer: [70, 150], swordsman: [210, 280], horseman: [160, 230] };
    for (const u of COMBAT_UNITS) this.spawn(b, 0, u, sent[u], g, unitStats(u, boosts), layout[u]);
    // defenders
    const shares = { aggressive: [0.3, 0.4, 0.3], builder: [0.5, 0.4, 0.1] }[k.personality] || [0.35, 0.4, 0.25];
    const em = 1 + 0.12 * (k.hall - 1), eg = 1 + 0.08 * k.hall;
    const enemy = {};
    COMBAT_UNITS.forEach((u, i) => {
      const st = { atk: UNITS[u].atk * em * eg, hp: UNITS[u].hp * em * eg, speed: UNITS[u].speed, range: UNITS[u].range };
      enemy[u] = { st, n: Math.max(i === 1 ? 2 : 0, Math.round((k.power * shares[i]) / unitPower(st))) };
    });
    const etotal = COMBAT_UNITS.reduce((s, u) => s + enemy[u].n, 0);
    const eg2 = Math.max(1, Math.ceil(etotal / 60));
    const elayout = { archer: [810, 880], swordsman: [680, 750], horseman: [730, 800] };
    for (const u of COMBAT_UNITS) this.spawn(b, 1, u, enemy[u].n, eg2, enemy[u].st, elayout[u]);
    b.enemyStart = enemy;
    const nt = clamp(Math.round(k.defense / 70), 1, 8);
    for (let i = 0; i < nt; i++) {
      const hp = 260 + k.hall * 70;
      b.towers.push({ id: b.nextId++, side: 1, tower: true, x: 860 + (i % 2) * 50, y: 70 + (i * (BH - 140)) / Math.max(1, nt - 1) * (nt > 1 ? 1 : 0) + (nt === 1 ? 190 : 0), hp, max: hp,
        atk: 10 + k.hall * 3.5, range: 170, cd: Math.random(), cannon: k.hall >= 3 && i % 2 === 1, dead: false, r: 16 });
    }
    b.towersStart = nt;
    this.b = b;
    this.speed = 1;
    this.buildBackground();
    el('battle-title').textContent = `⚔️ Assault on ${k.name}`;
    el('battle-result').hidden = true;
    el('battle').hidden = false;
    document.querySelectorAll('[data-bspeed]').forEach((x) => x.classList.toggle('active', x.dataset.bspeed === '1'));
  },

  spawn(b, side, u, n, g, st, [x0, x1]) {
    for (let left = n; left > 0; left -= g) {
      const c = Math.min(g, left);
      b.units.push({
        id: b.nextId++, side, u, count: c, unitHp: st.hp, atk: st.atk, hp: st.hp * c, max: st.hp * c,
        speed: st.speed * 42, range: st.range, x: rand(x0, x1), y: rand(50, BH - 50), cd: Math.random() * 0.8,
        target: null, retarget: 0, dead: false, face: side ? -1 : 1, walk: Math.random() * 6, r: u === 'horseman' ? 10 : 7, hit: 0,
      });
    }
  },

  alive(side) { return this.b.units.filter((x) => !x.dead && x.side === side); },

  tick(dt) {
    const b = this.b;
    if (!b || b.done) return;
    b.t += dt;
    const all = b.units.concat(b.towers);
    for (const a of b.units) {
      if (a.dead) continue;
      a.retarget -= dt;
      if (!a.target || a.target.dead || a.retarget <= 0) {
        a.retarget = 0.5;
        let best = null, bd = 1e9;
        for (const e of all) {
          if (e.dead || e.side === a.side) continue;
          const d = dist(a.x, a.y, e.x, e.y) - (e.tower ? 60 : 0) * (a.side === 0 ? 0 : 1);
          if (d < bd) { bd = d; best = e; }
        }
        a.target = best;
      }
      const t = a.target;
      if (!t) continue;
      const d = dist(a.x, a.y, t.x, t.y);
      a.face = t.x >= a.x ? 1 : -1;
      if (d > a.range + t.r) {
        const sp = a.speed * dt;
        let vx = ((t.x - a.x) / d) * sp, vy = ((t.y - a.y) / d) * sp;
        for (const o of b.units) {           // light separation so squads don't stack
          if (o === a || o.dead || Math.abs(o.x - a.x) > 14 || Math.abs(o.y - a.y) > 14) continue;
          const od = dist(a.x, a.y, o.x, o.y) || 1;
          if (od < 13) { vx += ((a.x - o.x) / od) * sp * 0.6; vy += ((a.y - o.y) / od) * sp * 0.6; }
        }
        a.x = clamp(a.x + vx, 10, BW - 10); a.y = clamp(a.y + vy, 20, BH - 12);
        a.walk += dt * a.speed * 0.25;
      } else {
        a.cd -= dt;
        if (a.cd <= 0) {
          const alive = Math.ceil(a.hp / a.unitHp);
          const dmg = a.atk * alive * rand(0.8, 1.2);
          if (a.range > 40) { a.cd = 1.2; b.shots.push({ x: a.x, y: a.y - 8, t, dmg, v: 420, kind: 'arrow', side: a.side }); }
          else { a.cd = 1.0; this.hurt(t, dmg); b.fx.push({ kind: 'slash', x: (a.x + t.x) / 2, y: (a.y + t.y) / 2 - 6, life: 0.25, max: 0.25, face: a.face }); a.hit = 0.15; }
        }
      }
      if (a.hit > 0) a.hit -= dt;
    }
    for (const tw of b.towers) {
      if (tw.dead) continue;
      tw.cd -= dt;
      if (tw.cd > 0) continue;
      let best = null, bd = tw.range;
      for (const e of b.units) if (!e.dead && e.side === 0) { const d = dist(tw.x, tw.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
      if (best) {
        tw.cd = tw.cannon ? 2.2 : 1.3;
        b.shots.push({ x: tw.x, y: tw.y - 30, t: best, dmg: tw.atk * (tw.cannon ? 3.2 : 1.6) * (1 + 0.03 * Math.min(20, best.count)), v: tw.cannon ? 300 : 460, kind: tw.cannon ? 'ball' : 'arrow', side: 1, splash: tw.cannon });
      }
    }
    for (const s of b.shots) {
      const d = dist(s.x, s.y, s.t.x, s.t.y);
      const step = s.v * dt;
      if (d <= step || s.t.dead) {
        if (!s.t.dead) {
          this.hurt(s.t, s.dmg);
          if (s.splash) {
            b.fx.push({ kind: 'boom', x: s.t.x, y: s.t.y, life: 0.45, max: 0.45 });
            for (const o of b.units) if (o !== s.t && !o.dead && o.side === s.t.side && dist(o.x, o.y, s.t.x, s.t.y) < 26) this.hurt(o, s.dmg * 0.4);
          }
        }
        s.gone = true;
      } else { s.x += ((s.t.x - s.x) / d) * step; s.y += ((s.t.y - s.y) / d) * step; }
    }
    b.shots = b.shots.filter((s) => !s.gone);
    for (const f of b.fx) { f.life -= dt; if (f.vy !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 200 * dt; } }
    b.fx = b.fx.filter((f) => f.life > 0);

    const atk = this.alive(0).length, def = this.alive(1).length + b.towers.filter((t) => !t.dead).length;
    if (!atk || !def || b.t >= BATTLE_LIMIT) this.finish(atk > 0 && def === 0);
  },

  hurt(t, dmg) {
    t.hp -= dmg;
    t.flash = 0.12;
    if (Math.random() < 0.35 && this.b.fx.length < 220) this.b.fx.push({ kind: 'num', x: t.x + rand(-6, 6), y: t.y - 16, text: Math.round(dmg), life: 0.7, max: 0.7, side: t.side });
    if (t.hp <= 0 && !t.dead) {
      t.dead = true;
      const n = t.tower ? 16 : 7;
      for (let i = 0; i < n; i++) this.b.fx.push({ kind: 'bit', x: t.x, y: t.y - 6, vx: rand(-70, 70), vy: rand(-140, -40), life: 0.8, max: 0.8, color: t.tower ? '#8b8f99' : t.side ? S.kingdoms[this.b.kid].color : '#f2c14e' });
    }
  },

  finish(win) {
    const b = this.b;
    b.done = true;
    const k = S.kingdoms[b.kid];
    const survivors = { archer: 0, swordsman: 0, horseman: 0 };
    for (const a of b.units) if (a.side === 0 && !a.dead) survivors[a.u] += Math.min(a.count, Math.ceil(a.hp / a.unitHp));
    const lost = {};
    for (const u of COMBAT_UNITS) { S.army[u] += survivors[u]; lost[u] = b.sent[u] - survivors[u]; }
    let enemyLeft = 0;
    for (const a of b.units) if (a.side === 1 && !a.dead) enemyLeft += Math.ceil(a.hp / a.unitHp) * unitPower(b.enemyStart[a.u].st);
    const towersLeft = b.towers.filter((t) => !t.dead).length;
    k.power = Math.max(60, enemyLeft + k.power * 0.15);
    k.defense = Math.max(20, k.defense * (0.4 + 0.6 * towersLeft / b.towersStart));
    k.relation -= win ? 30 : 15;
    S.kingdoms.forEach((o) => { if (o !== k && o.allianceId && o.allianceId === k.allianceId) o.relation -= 10; });
    const r = { win, lost, survivors, loot: {}, tiles: 0, kingdom: k.name };
    if (win) {
      for (const res of RES) { const v = Math.floor(k.res[res] * 0.3 + (res === 'diamonds' ? 3 : 150) * k.hall); r.loot[res] = v; k.res[res] = Math.max(0, k.res[res] - v); }
      gain(r.loot);
      k.defeats++;
      for (let i = 0; i < 2; i++) if (transferBorderTile(k.id, -2)) r.tiles++;
      if (!r.tiles && playerTiles() < territoryLimit()) {        // not adjacent: seize an outlying tile anyway
        const i = S.world.owner.findIndex((o, j) => o === k.id && !(j % WORLD_W === k.cx && ((j / WORLD_W) | 0) === k.cy));
        if (i >= 0) { S.world.owner[i] = -2; S.world.seen[i] = 1; r.tiles = 1; }
      }
      S.stats.battlesWon++;
      if (S.intel[k.id]) Object.assign(S.intel[k.id], { power: Math.round(k.power), defense: Math.round(k.defense), t: S.time });
      log(`Victory over ${k.name}! Loot: ${Object.entries(r.loot).map(([x, v]) => RES_META[x].icon + fmt(v)).join(' ')}` + (r.tiles ? `, ${r.tiles} territor${r.tiles > 1 ? 'ies' : 'y'} captured.` : '.'), 'good');
    } else {
      S.stats.battlesLost++;
      log(`Defeat at ${k.name}. Your army retreats.`, 'bad');
    }
    b.result = r;
    save();
    UI.panelDirty = true;
    this.showResult();
  },

  showResult() {
    const r = this.b.result;
    const lostTxt = COMBAT_UNITS.filter((u) => r.lost[u] > 0).map((u) => `${UNITS[u].icon} ${r.lost[u]} ${UNITS[u].name}${r.lost[u] > 1 ? 's' : ''}`).join(', ') || 'none';
    el('battle-result').innerHTML = `<div class="modal-card">
      <p class="big-result ${r.win ? 'win' : 'loss'}">${r.win ? 'Victory!' : 'Defeat'}</p>
      <p class="muted">${r.win ? `${esc(r.kingdom)} has been humbled.` : `${esc(r.kingdom)} held the line.`}</p>
      ${r.win ? `<h3>Loot</h3><p>${costHtml(r.loot)}</p>${r.tiles ? `<p>🏳️ ${r.tiles} territor${r.tiles > 1 ? 'ies' : 'y'} captured</p>` : ''}` : ''}
      <h3>Casualties</h3><p class="small">${lostTxt}</p>
      <div class="actions" style="justify-content:center"><button class="btn" id="battle-close">Return to kingdom</button></div></div>`;
    el('battle-result').hidden = false;
  },

  skip() { let n = 0; while (this.b && !this.b.done && n++ < 20000) this.tick(BDT); },
  close() { this.b = null; el('battle').hidden = true; UI.panelDirty = true; },

  frame(realDt) {
    if (!this.b) return;
    if (!this.b.done) {
      const steps = Math.min(12, Math.round((realDt / BDT) * this.speed)) || 1;
      for (let i = 0; i < steps && !this.b.done; i++) this.tick(BDT);
    }
    this.draw();
  },

  buildBackground() {
    const c = document.createElement('canvas'); c.width = BW; c.height = BH;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, BH); grd.addColorStop(0, '#4f7a35'); grd.addColorStop(1, '#3d6329');
    g.fillStyle = grd; g.fillRect(0, 0, BW, BH);
    const rng = mulberry32(this.b.kid * 99 + 7);
    for (let i = 0; i < 1400; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)'; g.fillRect(rng() * BW, rng() * BH, 2 + rng() * 3, 2 + rng() * 3); }
    g.fillStyle = 'rgba(120,95,60,0.35)';
    g.beginPath(); g.moveTo(0, BH * 0.45);
    for (let x = 0; x <= BW; x += 40) g.lineTo(x, BH * 0.45 + Math.sin(x / 90) * 18);
    for (let x = BW; x >= 0; x -= 40) g.lineTo(x, BH * 0.55 + Math.sin(x / 90) * 18);
    g.fill();
    for (let i = 0; i < 26; i++) {
      const x = rng() * BW, y = rng() < 0.5 ? rng() * 30 : BH - rng() * 24;
      g.fillStyle = '#2d4a1f'; g.beginPath(); g.arc(x, y, 12 + rng() * 10, 0, 7); g.fill();
      g.fillStyle = '#3b5f27'; g.beginPath(); g.arc(x - 3, y - 4, 8 + rng() * 6, 0, 7); g.fill();
    }
    // enemy keep
    const col = S.kingdoms[this.b.kid].color;
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(BW - 64, BH / 2 - 56, 70, 120);
    g.fillStyle = '#7d808a'; g.fillRect(BW - 70, BH / 2 - 70, 70, 120);
    g.fillStyle = '#5d6069'; g.fillRect(BW - 70, BH / 2 + 30, 70, 20);
    for (let i = 0; i < 5; i++) { g.fillStyle = '#8e919b'; g.fillRect(BW - 70 + i * 15, BH / 2 - 80, 9, 10); }
    g.fillStyle = col; g.fillRect(BW - 38, BH / 2 - 118, 3, 40); g.beginPath(); g.moveTo(BW - 35, BH / 2 - 118); g.lineTo(BW - 10, BH / 2 - 110); g.lineTo(BW - 35, BH / 2 - 100); g.fill();
    this.bg = c;
  },

  draw() {
    const cv = el('battle-canvas'), g = cv.getContext('2d'), b = this.b;
    g.drawImage(this.bg, 0, 0);
    const k = S.kingdoms[b.kid];
    const ents = b.units.filter((u) => !u.dead).concat(b.towers.filter((t) => !t.dead)).sort((a, c) => a.y - c.y);
    for (const b2 of b.units) if (b2.dead) { g.fillStyle = 'rgba(60,20,20,.25)'; g.beginPath(); g.ellipse(b2.x, b2.y + 2, 6, 3, 0, 0, 7); g.fill(); }
    for (const e of ents) {
      if (e.tower) drawTowerSprite(g, e.x, e.y, e.cannon, e.flash > 0);
      else drawSoldier(g, e.x, e.y, e.u, e.side ? k.color : '#f2c14e', e.face, e.walk, e.hit > 0, e.flash > 0);
      if (e.flash > 0) e.flash -= 1 / 60;
      if (e.hp < e.max) {
        const w = e.tower ? 34 : 18;
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(e.x - w / 2, e.y - (e.tower ? 58 : 26), w, 4);
        g.fillStyle = e.side ? '#e5534b' : '#57c26b'; g.fillRect(e.x - w / 2, e.y - (e.tower ? 58 : 26), (w * e.hp) / e.max, 4);
      }
      if (e.count > 1) { g.fillStyle = 'rgba(0,0,0,.55)'; g.font = 'bold 9px sans-serif'; g.fillText('×' + Math.ceil(e.hp / e.unitHp), e.x + 7, e.y + 4); }
    }
    for (const s of b.shots) {
      if (s.kind === 'ball') { g.fillStyle = '#222'; g.beginPath(); g.arc(s.x, s.y, 4, 0, 7); g.fill(); }
      else {
        const a = Math.atan2(s.t.y - s.y, s.t.x - s.x);
        g.strokeStyle = s.side ? '#ddd' : '#fff3c4'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - Math.cos(a) * 10, s.y - Math.sin(a) * 10); g.stroke();
      }
    }
    for (const f of b.fx) {
      const p = f.life / f.max;
      g.globalAlpha = clamp(p, 0, 1);
      if (f.kind === 'num') { g.fillStyle = f.side ? '#ffd2cf' : '#fff'; g.font = 'bold 11px sans-serif'; g.fillText(f.text, f.x, f.y - (1 - p) * 18); }
      else if (f.kind === 'slash') { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(f.x, f.y, 9, -1.2 * f.face, 0.6 * f.face, f.face < 0); g.stroke(); }
      else if (f.kind === 'boom') { g.fillStyle = '#ffb347'; g.beginPath(); g.arc(f.x, f.y, 26 * (1 - p) + 6, 0, 7); g.fill(); g.fillStyle = '#fff3'; g.beginPath(); g.arc(f.x, f.y, 34 * (1 - p), 0, 7); g.fill(); }
      else if (f.kind === 'bit') { g.fillStyle = f.color; g.fillRect(f.x, f.y, 3, 3); }
      g.globalAlpha = 1;
    }
    // HUD strip
    const mine = this.alive(0).reduce((s, a) => s + Math.ceil(a.hp / a.unitHp), 0);
    const theirs = this.alive(1).reduce((s, a) => s + Math.ceil(a.hp / a.unitHp), 0);
    g.fillStyle = 'rgba(10,12,18,.72)'; g.fillRect(0, 0, BW, 26);
    g.font = 'bold 13px sans-serif';
    g.fillStyle = '#f2c14e'; g.fillText(`${S.name}: ${mine} troops`, 12, 18);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(fmtTime(BATTLE_LIMIT - b.t), BW / 2, 18);
    g.fillStyle = k.color; g.textAlign = 'right'; g.fillText(`${k.name}: ${theirs} troops, ${b.towers.filter((t) => !t.dead).length} towers`, BW - 12, 18);
    g.textAlign = 'left';
  },
};

function drawSoldier(g, x, y, u, color, face, walk, attacking, flash) {
  const bob = Math.sin(walk * 6) * 1.2;
  g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(x, y + 2, u === 'horseman' ? 11 : 6, 3, 0, 0, 7); g.fill();
  if (u === 'horseman') {
    g.fillStyle = flash ? '#fff' : '#6b4a2f';
    g.beginPath(); g.ellipse(x, y - 6 + bob * 0.5, 11, 5, 0, 0, 7); g.fill();
    g.fillRect(x + face * 8, y - 13 + bob * 0.5, face * 5, 7);
    g.strokeStyle = '#4a321f'; g.lineWidth = 2;
    const l = Math.sin(walk * 10) * 3;
    g.beginPath(); g.moveTo(x - 7, y - 3); g.lineTo(x - 7 + l, y + 2); g.moveTo(x + 7, y - 3); g.lineTo(x + 7 - l, y + 2); g.stroke();
    y -= 8;
  }
  g.fillStyle = flash ? '#fff' : color;
  g.fillRect(x - 3.5, y - 12 + bob, 7, 9);
  g.fillStyle = flash ? '#fff' : '#f1c9a5';
  g.beginPath(); g.arc(x, y - 15 + bob, 3.2, 0, 7); g.fill();
  g.fillStyle = shade(color, -0.35);
  g.fillRect(x - 3.5, y - 18.5 + bob, 7, 2.2);
  g.strokeStyle = '#ddd'; g.lineWidth = 1.5;
  g.beginPath();
  if (u === 'archer') { g.strokeStyle = '#8b5a2b'; g.arc(x + face * 5, y - 9 + bob, 5, -1.2, 1.2); if (face < 0) { g.beginPath(); g.arc(x - 5, y - 9 + bob, 5, Math.PI - 1.2, Math.PI + 1.2); } }
  else if (u === 'swordsman') { const sw = attacking ? -0.9 : 0; g.moveTo(x + face * 4, y - 8 + bob); g.lineTo(x + face * (4 + 9 * Math.cos(sw)), y - 8 + bob - 9 * Math.sin(-sw) - 4); }
  else { g.moveTo(x + face * 2, y - 6 + bob); g.lineTo(x + face * 16, y - 12 + bob); }
  g.stroke();
  if (u === 'swordsman') { g.fillStyle = shade(color, -0.2); g.fillRect(x - face * 5 - 2, y - 11 + bob, 4, 7); }
}
function drawTowerSprite(g, x, y, cannon, flash) {
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x, y + 3, 16, 6, 0, 0, 7); g.fill();
  g.fillStyle = flash ? '#fff' : '#8a8d96'; g.fillRect(x - 11, y - 40, 22, 42);
  g.fillStyle = '#6c6f78'; g.fillRect(x - 11, y - 6, 22, 8);
  g.fillStyle = flash ? '#fff' : '#9a9da6';
  for (let i = 0; i < 3; i++) g.fillRect(x - 13 + i * 10, y - 48, 6, 8);
  g.fillRect(x - 13, y - 42, 26, 4);
  g.fillStyle = '#222'; g.fillRect(x - 2, y - 30, 4, 8);
  if (cannon) { g.fillStyle = '#333'; g.fillRect(x - 14, y - 46, 12, 5); }
}

/* ============================ 9. RENDERERS =============================== */

const el = (id) => document.getElementById(id);
let cv, ctx, CW = 800, CH = 600, DPR = 1;
const cam = { ts: 40, ox: 0, oy: 0, ws: 24, wx: 0, wy: 0, shake: 0 };
let terrainCache = null, terrainKey = '', worldCache = null, worldKey = '';
const popTimers = {};
const villagers = [];

function resize() {
  const r = cv.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  CW = Math.max(200, r.width); CH = Math.max(200, r.height);
  cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR);
  fitKingdomCamera(true);
  cam.ws = Math.floor(Math.min(CW / WORLD_W, (CH - 20) / WORLD_H));
  cam.wx = Math.floor((CW - cam.ws * WORLD_W) / 2);
  cam.wy = Math.floor((CH - cam.ws * WORLD_H) / 2 + 8);
  terrainKey = worldKey = '';
}
function fitKingdomCamera(force) {
  const r = landRadius();
  if (!force && cam.fitFor === r) return;
  cam.fitFor = r;
  const cx = HALL_X + 1, cy = HALL_Y + 1;
  const x0 = Math.max(-1, cx - r - 1.5), x1 = Math.min(GRID_W + 1, Math.max(cx + r + 1.5, WATER_X + 2.5));
  const y0 = Math.max(-0.6, cy - r - 1.3), y1 = Math.min(GRID_H + 0.6, cy + r + 1.3);
  cam.ts = Math.max(16, Math.floor(Math.min(CW / (x1 - x0), (CH - 20) / (y1 - y0))));
  cam.ox = Math.round(CW / 2 - (cam.ts * (x0 + x1)) / 2);
  cam.oy = Math.round(CH / 2 - (cam.ts * (y0 + y1)) / 2 + 10);
  terrainKey = '';
}
const tileToScreen = (x, y) => ({ x: cam.ox + x * cam.ts, y: cam.oy + y * cam.ts });
const screenToTile = (sx, sy) => ({ x: Math.floor((sx - cam.ox) / cam.ts), y: Math.floor((sy - cam.oy) / cam.ts) });
const worldToScreen = (x, y) => ({ x: cam.wx + x * cam.ws, y: cam.wy + y * cam.ws });
const screenToWorld = (sx, sy) => ({ x: Math.floor((sx - cam.wx) / cam.ws), y: Math.floor((sy - cam.wy) / cam.ws) });

// ---------- effects ----------
function spawnDust(x, y, s) {
  for (let i = 0; i < 18; i++) UI.fx.push({ kind: 'dust', tx: x + Math.random() * s, ty: y + s * 0.8 + Math.random() * 0.3, vx: rand(-0.8, 0.8), vy: rand(-1.2, -0.3), life: 0.9, max: 0.9, r: rand(2, 5) });
}
function spawnSparkles(b) {
  const s = BUILDINGS[b.type].size || 1;
  for (let i = 0; i < 26; i++) UI.fx.push({ kind: 'spark', tx: b.x + s / 2, ty: b.y + s / 2, vx: rand(-2.5, 2.5), vy: rand(-3.5, -0.5), life: 1.1, max: 1.1, color: pick(['#f2c14e', '#fff3c4', '#ffffff']) });
}
function floatText(tx, ty, text, color) { UI.fx.push({ kind: 'text', tx, ty, text, color, life: 1.6, max: 1.6 }); }
function celebrate() { for (let i = 0; i < 80; i++) UI.fx.push({ kind: 'spark', tx: HALL_X + 1, ty: HALL_Y + 1, vx: rand(-6, 6), vy: rand(-7, -1), life: 1.8, max: 1.8, color: pick(['#f2c14e', '#e5534b', '#4ea1f2', '#57c26b', '#fff']) }); }
function shake(n) { cam.shake = Math.max(cam.shake, n); }

// ---------- drawing primitives ----------
function box(g, x, y, w, d, h, top, front) {
  g.fillStyle = front; g.fillRect(x, y + d - h, w, h);
  g.fillStyle = top; g.fillRect(x, y - h, w, d);
}
function gable(g, x, y, w, d, rh, color) {
  const ry = y + d * 0.45 - rh;
  g.fillStyle = shade(color, 0.18);
  g.beginPath(); g.moveTo(x - 2, y); g.lineTo(x + w + 2, y); g.lineTo(x + w - 2, ry); g.lineTo(x + 2, ry); g.closePath(); g.fill();
  g.fillStyle = color;
  g.beginPath(); g.moveTo(x + 2, ry); g.lineTo(x + w - 2, ry); g.lineTo(x + w + 2, y + d); g.lineTo(x - 2, y + d); g.closePath(); g.fill();
  g.strokeStyle = shade(color, -0.35); g.lineWidth = 1; g.beginPath(); g.moveTo(x + 2, ry); g.lineTo(x + w - 2, ry); g.stroke();
}
function cone(g, cx, by, r, h, color) {
  g.fillStyle = color; g.beginPath(); g.moveTo(cx - r, by); g.lineTo(cx + r, by); g.lineTo(cx, by - h); g.closePath(); g.fill();
  g.fillStyle = shade(color, 0.2); g.beginPath(); g.moveTo(cx - r, by); g.lineTo(cx, by); g.lineTo(cx, by - h); g.closePath(); g.fill();
}
function shadow(g, cx, cy, rx, ry) { g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.fill(); }
function flag(g, x, y, h, color, t) {
  g.fillStyle = '#5b4630'; g.fillRect(x, y - h, 2, h);
  g.fillStyle = color; g.beginPath(); g.moveTo(x + 2, y - h);
  for (let i = 0; i <= 6; i++) g.lineTo(x + 2 + i * 2.5, y - h + Math.sin(t * 5 + i * 0.9) * 1.6);
  for (let i = 6; i >= 0; i--) g.lineTo(x + 2 + i * 2.5, y - h + 8 + Math.sin(t * 5 + i * 0.9) * 1.6);
  g.fill();
}
function mound(g, x, y, s, color) {
  shadow(g, x + s / 2, y + s * 0.8, s * 0.46, s * 0.14);
  g.fillStyle = shade(color, -0.2); g.beginPath(); g.ellipse(x + s / 2, y + s * 0.62, s * 0.44, s * 0.3, 0, Math.PI, 0); g.fill();
  g.fillStyle = color; g.beginPath(); g.ellipse(x + s / 2, y + s * 0.6, s * 0.4, s * 0.36, 0, Math.PI, 0); g.fill();
  g.fillStyle = shade(color, 0.15); g.beginPath(); g.ellipse(x + s * 0.42, y + s * 0.42, s * 0.18, s * 0.1, -0.3, 0, 7); g.fill();
  g.fillStyle = '#1b1510'; g.beginPath(); g.ellipse(x + s / 2, y + s * 0.62, s * 0.13, s * 0.16, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#7a5a36'; g.fillRect(x + s * 0.35, y + s * 0.44, s * 0.3, s * 0.05); g.fillRect(x + s * 0.35, y + s * 0.44, s * 0.05, s * 0.18); g.fillRect(x + s * 0.6, y + s * 0.44, s * 0.05, s * 0.18);
}

// ---------- building art ----------
function drawBuilding(g, b, px, py, s, t, ghost) {
  const d = BUILDINGS[b.type];
  if (b.level === 0 && !ghost) return drawScaffold(g, b, px, py, s);
  const u = s / 40, seed = b.id * 1.7;
  switch (b.type) {
    case 'hall': {
      const lvl = b.level;
      shadow(g, px + s / 2, py + s * 0.9, s * 0.48, s * 0.12);
      box(g, px + s * 0.1, py + s * 0.34, s * 0.8, s * 0.56, s * 0.2, '#b3b7bf', '#8a8f99');
      box(g, px + s * 0.24, py + s * 0.3, s * 0.52, s * 0.36, s * 0.34, '#c4c8cf', '#9ca1ab');
      gable(g, px + s * 0.24, py + s * 0.3 - s * 0.34, s * 0.52, s * 0.36, s * 0.16, lvl >= 5 ? '#6a3fa0' : lvl >= 3 ? '#b5452f' : '#3f6fb5');
      for (const cx of [0.14, 0.86]) {
        box(g, px + s * cx - s * 0.08, py + s * 0.66, s * 0.16, s * 0.2, s * 0.34, '#c4c8cf', '#9ca1ab');
        cone(g, px + s * cx, py + s * 0.66 - s * 0.34 + 1, s * 0.1, s * 0.16, lvl >= 3 ? '#b5452f' : '#3f6fb5');
      }
      g.fillStyle = '#4a3522'; g.beginPath(); g.moveTo(px + s * 0.43, py + s * 0.9); g.lineTo(px + s * 0.43, py + s * 0.8); g.arc(px + s / 2, py + s * 0.8, s * 0.07, Math.PI, 0); g.lineTo(px + s * 0.57, py + s * 0.9); g.fill();
      if (lvl >= 2) { g.fillStyle = '#f2c14e'; g.fillRect(px + s * 0.24, py + s * 0.62, s * 0.52, 2); }
      if (lvl >= 4) for (const cx of [0.3, 0.7]) { g.fillStyle = '#b5452f'; g.fillRect(px + s * cx - 3, py + s * 0.52, 6, s * 0.12); }
      flag(g, px + s / 2, py + s * 0.02, s * 0.26, '#f2c14e', t);
      break;
    }
    case 'goldmine': case 'ironmine': case 'diamondmine': {
      const col = b.type === 'goldmine' ? '#9c7a4a' : b.type === 'ironmine' ? '#7d8189' : '#4b4458';
      mound(g, px, py, s, col);
      const n = b.type === 'diamondmine' ? 4 : 5;
      for (let i = 0; i < n; i++) {
        const ox = px + s * (0.18 + hash2(b.id, i) * 0.64), oy = py + s * (0.3 + hash2(i, b.id) * 0.25);
        if (b.type === 'diamondmine') {
          const glow = 0.6 + 0.4 * Math.sin(t * 3 + i);
          g.fillStyle = `rgba(111,227,242,${0.35 * glow})`; g.beginPath(); g.arc(ox, oy, 6 * u, 0, 7); g.fill();
          g.fillStyle = '#6fe3f2'; g.beginPath(); g.moveTo(ox, oy - 6 * u); g.lineTo(ox + 3 * u, oy); g.lineTo(ox, oy + 3 * u); g.lineTo(ox - 3 * u, oy); g.fill();
        } else {
          g.fillStyle = b.type === 'goldmine' ? '#f2c14e' : '#c6d2de';
          g.beginPath(); g.arc(ox, oy, 2.2 * u, 0, 7); g.fill();
          if (b.type === 'goldmine' && Math.sin(t * 4 + i * 2 + seed) > 0.93) { g.fillStyle = '#fff'; g.fillRect(ox - 4 * u, oy - 0.5, 8 * u, 1); g.fillRect(ox - 0.5, oy - 4 * u, 1, 8 * u); }
        }
      }
      // mine cart rolling in and out
      const cx = px + s * (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.8 + seed)));
      g.fillStyle = '#5b4630'; g.fillRect(cx - 5 * u, py + s * 0.78, 10 * u, 5 * u);
      g.fillStyle = b.type === 'goldmine' ? '#f2c14e' : b.type === 'ironmine' ? '#9fb3c8' : '#6fe3f2'; g.fillRect(cx - 4 * u, py + s * 0.76, 8 * u, 2.5 * u);
      g.fillStyle = '#222'; g.beginPath(); g.arc(cx - 3 * u, py + s * 0.78 + 5 * u, 1.6 * u, 0, 7); g.arc(cx + 3 * u, py + s * 0.78 + 5 * u, 1.6 * u, 0, 7); g.fill();
      break;
    }
    case 'lumbermill': {
      shadow(g, px + s / 2, py + s * 0.85, s * 0.44, s * 0.12);
      for (let i = 0; i < 3; i++) { g.fillStyle = '#8b5a2b'; g.fillRect(px + s * 0.08, py + s * (0.62 + i * 0.08), s * 0.34, s * 0.07); g.fillStyle = '#d9a86a'; g.beginPath(); g.arc(px + s * 0.08, py + s * (0.655 + i * 0.08), s * 0.035, 0, 7); g.fill(); }
      box(g, px + s * 0.44, py + s * 0.42, s * 0.48, s * 0.42, s * 0.22, '#a0703f', '#7b5230');
      gable(g, px + s * 0.44, py + s * 0.42 - s * 0.22, s * 0.48, s * 0.42, s * 0.12, '#b5452f');
      const sx = px + s * 0.3, sy = py + s * 0.42, sr = s * 0.13;
      g.save(); g.translate(sx, sy); g.rotate(t * 6);
      g.fillStyle = '#c9ced6'; g.beginPath();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = i % 2 ? sr : sr * 0.8; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.fill(); g.fillStyle = '#555'; g.beginPath(); g.arc(0, 0, sr * 0.25, 0, 7); g.fill(); g.restore();
      break;
    }
    case 'farm': {
      g.fillStyle = '#6b4f2d'; g.fillRect(px + s * 0.05, py + s * 0.12, s * 0.9, s * 0.82);
      for (let i = 0; i < 5; i++) {
        const ry = py + s * (0.18 + i * 0.15);
        g.fillStyle = i % 2 ? '#c9b24a' : '#8fbf4a';
        for (let j = 0; j < 7; j++) {
          const sw = Math.sin(t * 2 + j * 0.6 + i) * 1.5 * u;
          g.fillRect(px + s * (0.1 + j * 0.12) + sw, ry, s * 0.07, s * 0.1);
        }
      }
      box(g, px + s * 0.62, py + s * 0.62, s * 0.3, s * 0.3, s * 0.14, '#b5452f', '#8a3322');
      gable(g, px + s * 0.62, py + s * 0.62 - s * 0.14, s * 0.3, s * 0.3, s * 0.08, '#6d3a2a');
      break;
    }
    case 'wall': {
      const has = (dx, dy) => { const o = buildingAt(b.x + dx, b.y + dy); return o && o.type === 'wall'; };
      const h = s * 0.32, c1 = b.level >= 4 ? '#c0c4cc' : b.level >= 2 ? '#a9adb6' : '#9aa0a8', c2 = shade(c1, -0.25);
      shadow(g, px + s / 2, py + s * 0.72, s * 0.35, s * 0.1);
      if (has(-1, 0)) box(g, px, py + s * 0.35, s * 0.5, s * 0.3, h, c1, c2);
      if (has(1, 0)) box(g, px + s * 0.5, py + s * 0.35, s * 0.5, s * 0.3, h, c1, c2);
      if (has(0, -1)) box(g, px + s * 0.35, py, s * 0.3, s * 0.5, h, c1, c2);
      box(g, px + s * 0.28, py + s * 0.3, s * 0.44, s * 0.4, h * 1.15, shade(c1, 0.08), c2);
      if (has(0, 1)) box(g, px + s * 0.35, py + s * 0.5, s * 0.3, s * 0.5, h, c1, c2);
      break;
    }
    case 'tower': {
      shadow(g, px + s / 2, py + s * 0.85, s * 0.3, s * 0.1);
      box(g, px + s * 0.28, py + s * 0.5, s * 0.44, s * 0.36, s * 0.72, '#b8bcc4', '#8f949d');
      for (let i = 0; i < 3; i++) box(g, px + s * (0.26 + i * 0.17), py + s * 0.5 - s * 0.72, s * 0.1, s * 0.1, s * 0.08, '#c9cdd4', '#9da2ab');
      g.fillStyle = '#2b2b2b'; g.fillRect(px + s * 0.46, py + s * 0.52, s * 0.08, s * 0.14);
      g.fillStyle = '#3f6fb5'; g.beginPath(); g.arc(px + s * 0.5, py + s * 0.5 - s * 0.66, s * 0.05, 0, 7); g.fill();
      break;
    }
    case 'cannon': {
      shadow(g, px + s / 2, py + s * 0.78, s * 0.42, s * 0.14);
      g.fillStyle = '#7d818a'; g.beginPath(); g.ellipse(px + s / 2, py + s * 0.66, s * 0.4, s * 0.2, 0, 0, 7); g.fill();
      g.fillStyle = '#9aa0a8'; g.beginPath(); g.ellipse(px + s / 2, py + s * 0.6, s * 0.4, s * 0.2, 0, 0, 7); g.fill();
      const a = Math.sin(t * 0.6 + seed) * 1.2 - Math.PI / 2 + (S.raid ? Math.PI : 0) * 0.5;
      g.save(); g.translate(px + s / 2, py + s * 0.52); g.rotate(a);
      g.fillStyle = '#2d2f33'; g.fillRect(0, -s * 0.07, s * 0.36, s * 0.14); g.fillStyle = '#44474d'; g.fillRect(s * 0.3, -s * 0.09, s * 0.08, s * 0.18);
      g.restore();
      g.fillStyle = '#5b4630'; g.beginPath(); g.arc(px + s / 2, py + s * 0.52, s * 0.1, 0, 7); g.fill();
      break;
    }
    case 'spire': {
      shadow(g, px + s / 2, py + s * 0.85, s * 0.28, s * 0.1);
      g.fillStyle = '#4b3a6b'; g.beginPath(); g.moveTo(px + s * 0.3, py + s * 0.86); g.lineTo(px + s * 0.7, py + s * 0.86); g.lineTo(px + s * 0.56, py - s * 0.1); g.lineTo(px + s * 0.44, py - s * 0.1); g.fill();
      g.fillStyle = '#6a5394'; g.beginPath(); g.moveTo(px + s * 0.3, py + s * 0.86); g.lineTo(px + s * 0.5, py + s * 0.86); g.lineTo(px + s * 0.5, py - s * 0.1); g.lineTo(px + s * 0.44, py - s * 0.1); g.fill();
      const pulse = 0.7 + 0.3 * Math.sin(t * 3);
      const grd = g.createRadialGradient(px + s / 2, py - s * 0.22, 0, px + s / 2, py - s * 0.22, s * 0.3 * pulse);
      grd.addColorStop(0, 'rgba(210,170,255,.95)'); grd.addColorStop(1, 'rgba(176,124,242,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(px + s / 2, py - s * 0.22, s * 0.3 * pulse, 0, 7); g.fill();
      g.fillStyle = '#efe0ff'; g.beginPath(); g.arc(px + s / 2, py - s * 0.22, s * 0.07, 0, 7); g.fill();
      break;
    }
    case 'port': {
      g.fillStyle = '#7b5230'; g.fillRect(px + s * 0.1, py + s * 0.3, s * 1.5, s * 0.4);
      g.fillStyle = '#a0703f'; for (let i = 0; i < 8; i++) g.fillRect(px + s * (0.12 + i * 0.185), py + s * 0.3, s * 0.15, s * 0.36);
      g.fillStyle = '#5b3d22'; for (let i = 0; i < 4; i++) g.fillRect(px + s * (0.4 + i * 0.36), py + s * 0.68, s * 0.06, s * 0.14);
      box(g, px + s * 0.08, py + s * 0.12, s * 0.36, s * 0.3, s * 0.18, '#a0703f', '#7b5230');
      gable(g, px + s * 0.08, py + s * 0.12 - s * 0.18, s * 0.36, s * 0.3, s * 0.08, '#3f6fb5');
      const bob = Math.sin(t * 1.6 + seed) * 2;
      const sxp = px + s * (1.25 + 0.12 * Math.sin(t * 0.3 + seed)), syp = py + s * 0.95 + bob;
      g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(sxp, syp + 3, s * 0.34, s * 0.07, 0, 0, 7); g.fill();
      g.fillStyle = '#6b4424'; g.beginPath(); g.moveTo(sxp - s * 0.34, syp - s * 0.08); g.lineTo(sxp + s * 0.34, syp - s * 0.08); g.lineTo(sxp + s * 0.24, syp + s * 0.06); g.lineTo(sxp - s * 0.26, syp + s * 0.06); g.fill();
      g.fillStyle = '#4a2f18'; g.fillRect(sxp - 1, syp - s * 0.6, 2, s * 0.52);
      g.fillStyle = '#efe6d2'; g.beginPath(); g.moveTo(sxp + 2, syp - s * 0.56); g.quadraticCurveTo(sxp + s * 0.3 + Math.sin(t * 2) * 2, syp - s * 0.36, sxp + 2, syp - s * 0.14); g.fill();
      g.fillStyle = '#f2c14e'; g.fillRect(sxp - 1, syp - s * 0.66, 7, 4);
      break;
    }
    case 'archery': {
      shadow(g, px + s / 2, py + s * 0.85, s * 0.44, s * 0.1);
      g.fillStyle = '#c9b48a'; g.beginPath(); g.moveTo(px + s * 0.08, py + s * 0.86); g.lineTo(px + s * 0.34, py + s * 0.22); g.lineTo(px + s * 0.6, py + s * 0.86); g.fill();
      g.fillStyle = '#a8946a'; g.beginPath(); g.moveTo(px + s * 0.34, py + s * 0.22); g.lineTo(px + s * 0.6, py + s * 0.86); g.lineTo(px + s * 0.34, py + s * 0.86); g.fill();
      g.fillStyle = '#3a2b1a'; g.beginPath(); g.moveTo(px + s * 0.28, py + s * 0.86); g.lineTo(px + s * 0.34, py + s * 0.6); g.lineTo(px + s * 0.4, py + s * 0.86); g.fill();
      const tx = px + s * 0.78, ty = py + s * 0.5;
      g.fillStyle = '#5b4630'; g.fillRect(tx - 1, ty, 2, s * 0.34);
      [['#fff', 0.16], ['#e5534b', 0.12], ['#fff', 0.08], ['#e5534b', 0.04]].forEach(([c, r]) => { g.fillStyle = c; g.beginPath(); g.arc(tx, ty, s * r, 0, 7); g.fill(); });
      flag(g, px + s * 0.34, py + s * 0.24, s * 0.16, '#57c26b', t);
      break;
    }
    case 'barracks': {
      shadow(g, px + s / 2, py + s * 0.88, s * 0.46, s * 0.12);
      box(g, px + s * 0.08, py + s * 0.4, s * 0.84, s * 0.48, s * 0.26, '#b89c78', '#8d7556');
      gable(g, px + s * 0.08, py + s * 0.4 - s * 0.26, s * 0.84, s * 0.48, s * 0.14, '#9e3a2a');
      g.strokeStyle = '#d7dbe2'; g.lineWidth = 2 * u;
      g.beginPath(); g.moveTo(px + s * 0.4, py + s * 0.66); g.lineTo(px + s * 0.6, py + s * 0.82); g.moveTo(px + s * 0.6, py + s * 0.66); g.lineTo(px + s * 0.4, py + s * 0.82); g.stroke();
      break;
    }
    case 'stable': {
      shadow(g, px + s / 2, py + s * 0.88, s * 0.46, s * 0.12);
      box(g, px + s * 0.06, py + s * 0.38, s * 0.7, s * 0.5, s * 0.24, '#9c6b3f', '#76502e');
      gable(g, px + s * 0.06, py + s * 0.38 - s * 0.24, s * 0.7, s * 0.5, s * 0.14, '#6d3a2a');
      g.fillStyle = '#3a2716'; g.fillRect(px + s * 0.3, py + s * 0.66, s * 0.2, s * 0.22);
      const hb = Math.sin(t * 1.5 + seed) * 1.5;
      g.fillStyle = '#5a3a22'; g.fillRect(px + s * 0.34, py + s * 0.66 + hb, s * 0.08, s * 0.12); g.fillRect(px + s * 0.34, py + s * 0.66 + hb, s * 0.14, s * 0.05);
      g.fillStyle = '#d6b85a'; g.beginPath(); g.ellipse(px + s * 0.86, py + s * 0.8, s * 0.1, s * 0.08, 0, 0, 7); g.fill();
      break;
    }
    case 'scoutlodge': {
      shadow(g, px + s / 2, py + s * 0.88, s * 0.4, s * 0.1);
      box(g, px + s * 0.1, py + s * 0.52, s * 0.44, s * 0.36, s * 0.2, '#8f6a45', '#6f5034');
      gable(g, px + s * 0.1, py + s * 0.52 - s * 0.2, s * 0.44, s * 0.36, s * 0.1, '#4e7a3a');
      g.fillStyle = '#6f5034';
      g.fillRect(px + s * 0.66, py + s * 0.1, s * 0.04, s * 0.78); g.fillRect(px + s * 0.84, py + s * 0.1, s * 0.04, s * 0.78);
      g.fillStyle = '#8f6a45'; g.fillRect(px + s * 0.6, py + s * 0.04, s * 0.34, s * 0.1);
      const glint = Math.sin(t * 2 + seed) > 0.8;
      g.fillStyle = glint ? '#fff' : '#9fb3c8'; g.beginPath(); g.arc(px + s * 0.92, py + s * 0.02, s * 0.03, 0, 7); g.fill();
      g.strokeStyle = '#3a2716'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px + s * 0.78, py); g.lineTo(px + s * 0.92, py + s * 0.02); g.stroke();
      break;
    }
  }
  if (!ghost && b.type !== 'wall') levelBadge(g, px + s - 8, py + s - 6, b.level);
  if (!ghost && b.build > 0) {
    drawScaffold(g, b, px, py, s, true);
  }
}
function drawScaffold(g, b, px, py, s, overlay) {
  if (!overlay) {
    shadow(g, px + s / 2, py + s * 0.85, s * 0.42, s * 0.12);
    g.fillStyle = '#8a6d4a'; g.fillRect(px + s * 0.12, py + s * 0.6, s * 0.76, s * 0.28);
    g.fillStyle = '#a6a9ae'; g.fillRect(px + s * 0.18, py + s * 0.66, s * 0.26, s * 0.12); g.fillRect(px + s * 0.5, py + s * 0.7, s * 0.3, s * 0.1);
  }
  g.strokeStyle = '#c39a62'; g.lineWidth = 1.5;
  g.beginPath();
  for (const fx of [0.14, 0.5, 0.86]) { g.moveTo(px + s * fx, py + s * 0.88); g.lineTo(px + s * fx, py + s * 0.18); }
  for (const fy of [0.3, 0.55, 0.8]) { g.moveTo(px + s * 0.12, py + s * fy); g.lineTo(px + s * 0.88, py + s * fy); }
  g.moveTo(px + s * 0.14, py + s * 0.8); g.lineTo(px + s * 0.5, py + s * 0.3);
  g.stroke();
  const p = 1 - b.build / b.buildTotal;
  g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(px + 3, py - 2, s - 6, 7);
  g.fillStyle = '#f2c14e'; g.fillRect(px + 4, py - 1, (s - 8) * p, 5);
  if (Math.random() < 0.08) UI.fx.push({ kind: 'spark', tx: b.x + Math.random() * (s / cam.ts), ty: b.y + 0.3, vx: rand(-1, 1), vy: rand(-2, -0.5), life: 0.5, max: 0.5, color: '#ffd27a' });
}
function levelBadge(g, x, y, lvl) {
  g.fillStyle = 'rgba(20,24,32,.85)'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
  g.strokeStyle = '#f2c14e'; g.lineWidth = 1; g.stroke();
  g.fillStyle = '#f2c14e'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(lvl, x, y + 0.5); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

// ---------- kingdom view ----------
function buildTerrain() {
  fitKingdomCamera();
  const key = `${cam.ts}-${cam.ox}-${cam.oy}-${hallLevel()}-${CW}-${CH}`;
  if (key === terrainKey) return;
  terrainKey = key;
  const c = document.createElement('canvas');
  c.width = Math.round(CW * DPR); c.height = Math.round(CH * DPR);
  const g = c.getContext('2d'); g.scale(DPR, DPR);
  const ts = cam.ts;
  g.fillStyle = '#1d3b1f'; g.fillRect(0, 0, CW, CH);
  const vx0 = Math.floor(-cam.ox / ts) - 1, vx1 = Math.ceil((CW - cam.ox) / ts) + 1;
  const vy0 = Math.floor(-cam.oy / ts) - 1, vy1 = Math.ceil((CH - cam.oy) / ts) + 1;
  for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) {
    const { x: sx, y: sy } = tileToScreen(x, y);
    const h = hash2(x, y, 3);
    if (x >= WATER_X) { g.fillStyle = shade('#2a6b9c', (h - 0.5) * 0.08); g.fillRect(sx, sy, ts + 1, ts + 1); continue; }
    const open = isUnlockedTile(x, y);
    g.fillStyle = open ? shade('#6a9c45', (h - 0.5) * 0.12) : shade('#3f6230', (h - 0.5) * 0.14);
    g.fillRect(sx, sy, ts + 1, ts + 1);
    if (open && h > 0.8) { g.fillStyle = pick(['#e8e36a', '#f0f0f0', '#e58ab0']); g.fillRect(sx + h * ts * 0.7, sy + hash2(y, x) * ts * 0.8, 2, 2); }
    if (open && h < 0.08) { g.fillStyle = '#8a8d86'; g.beginPath(); g.ellipse(sx + ts * 0.3, sy + ts * 0.6, ts * 0.08, ts * 0.05, 0, 0, 7); g.fill(); }
  }
  // sandy shore
  const shoreX = cam.ox + WATER_X * cam.ts;
  g.fillStyle = '#d9c38e';
  g.beginPath(); g.moveTo(shoreX - ts * 0.15, cam.oy + vy0 * ts);
  for (let y = vy0; y <= vy1; y++) g.lineTo(shoreX + ts * (0.12 + hash2(y, 9) * 0.12), cam.oy + y * ts);
  g.lineTo(shoreX - ts * 0.15, cam.oy + vy1 * ts); g.fill();
  // trees on locked land (drawn in y order for overlap)
  for (let y = vy0; y <= vy1; y++) for (let x = vx0; x < WATER_X; x++) {
    if (isUnlockedTile(x, y) || hash2(x, y, 7) > 0.62) continue;
    const { x: sx, y: sy } = tileToScreen(x, y);
    const tx = sx + ts * (0.3 + hash2(x, y, 8) * 0.4), ty = sy + ts * (0.5 + hash2(x, y, 9) * 0.3);
    shadow(g, tx, ty + ts * 0.18, ts * 0.26, ts * 0.08);
    g.fillStyle = '#5a3d22'; g.fillRect(tx - 1.5, ty, 3, ts * 0.18);
    cone(g, tx, ty + 2, ts * 0.26, ts * 0.5, '#2e5a2a'); cone(g, tx, ty - ts * 0.18, ts * 0.2, ts * 0.42, '#3a6e33');
  }
  // land border
  const r = landRadius();
  const x0 = Math.max(0, Math.ceil(HALL_X + 1 - r - 0.5)), x1 = Math.min(WATER_X, Math.floor(HALL_X + 1 + r + 0.5));
  const y0 = Math.max(0, Math.ceil(HALL_Y + 1 - r - 0.5)), y1 = Math.min(GRID_H, Math.floor(HALL_Y + 1 + r + 0.5));
  g.setLineDash([6, 5]); g.strokeStyle = 'rgba(242,193,78,.45)'; g.lineWidth = 2;
  g.strokeRect(cam.ox + x0 * ts, cam.oy + y0 * ts, (x1 - x0) * ts, (y1 - y0) * ts); g.setLineDash([]);
  terrainCache = c;
}

function drawKingdom(g, t, dt) {
  buildTerrain();
  g.drawImage(terrainCache, 0, 0, CW, CH);
  const ts = cam.ts;
  // animated water
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1.5;
  for (let y = -1; y <= GRID_H; y += 1) for (let x = WATER_X; x < GRID_W + 3; x += 1) {
    if (hash2(x, y, 11) < 0.5) continue;
    const { x: sx, y: sy } = tileToScreen(x, y);
    const o = Math.sin(t * 1.5 + x + y * 0.7) * ts * 0.12;
    g.beginPath(); g.moveTo(sx + ts * 0.2 + o, sy + ts * 0.5); g.quadraticCurveTo(sx + ts * 0.4 + o, sy + ts * 0.38, sx + ts * 0.6 + o, sy + ts * 0.5); g.stroke();
  }
  // hover / placement
  const h = UI.hover;
  if (UI.placing && h) {
    const s = BUILDINGS[UI.placing].size || 1, err = placementError(UI.placing, h.x, h.y);
    const p = tileToScreen(h.x, h.y);
    g.fillStyle = err ? 'rgba(229,83,75,.35)' : 'rgba(87,194,107,.35)'; g.fillRect(p.x, p.y, ts * s, ts * s);
    g.strokeStyle = err ? '#e5534b' : '#57c26b'; g.lineWidth = 2; g.strokeRect(p.x + 1, p.y + 1, ts * s - 2, ts * s - 2);
  } else if (h && isUnlockedTile(h.x, h.y)) {
    const p = tileToScreen(h.x, h.y);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.strokeRect(p.x + 0.5, p.y + 0.5, ts - 1, ts - 1);
  }
  // buildings sorted by their bottom edge
  const list = [...S.buildings].sort((a, b) => (a.y + (BUILDINGS[a.type].size || 1)) - (b.y + (BUILDINGS[b.type].size || 1)) || a.x - b.x);
  for (const b of list) {
    const s = (BUILDINGS[b.type].size || 1) * ts, p = tileToScreen(b.x, b.y);
    if (UI.selected === b.id) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      g.strokeStyle = `rgba(242,193,78,${0.5 + pulse * 0.5})`; g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(p.x + s / 2, p.y + s * 0.8, s * 0.55, s * 0.2, 0, 0, 7); g.stroke();
    }
    drawBuilding(g, b, p.x, p.y, s, t);
    // production popups
    const prod = productionOf(b);
    if (prod && b.build <= 0 && S.res[prod[0]] < capOf(prod[0])) {
      popTimers[b.id] = (popTimers[b.id] ?? hash2(b.id, 1) * 6) - dt;
      if (popTimers[b.id] <= 0) {
        popTimers[b.id] = 6;
        const amt = prod[1] * 6 * (1 + allianceBonus().prod);
        floatText(b.x + (BUILDINGS[b.type].size || 1) / 2, b.y + 0.2, `+${amt >= 10 ? fmt(amt) : amt.toFixed(1)} ${RES_META[prod[0]].icon}`, RES_META[prod[0]].color);
      }
    }
  }
  if (UI.placing && h && !placementError(UI.placing, h.x, h.y)) {
    const s = (BUILDINGS[UI.placing].size || 1) * ts, p = tileToScreen(h.x, h.y);
    g.globalAlpha = 0.65; drawBuilding(g, { id: 0, type: UI.placing, x: h.x, y: h.y, level: 1, build: 0 }, p.x, p.y, s, t, true); g.globalAlpha = 1;
  }
  drawVillagers(g, t, dt);
  if (S.raid) drawRaid(g, t);
  drawFx(g, dt, tileToScreen, ts);
}

function drawVillagers(g, t, dt) {
  if (villagers.length < 7) villagers.push({ x: HALL_X + 1, y: HALL_Y + 2, tx: HALL_X + 1, ty: HALL_Y + 2, c: pick(['#c0392b', '#2980b9', '#8e44ad', '#16a085', '#d35400']), wait: Math.random() * 3 });
  for (const v of villagers) {
    const d = dist(v.x, v.y, v.tx, v.ty);
    if (d < 0.05) {
      v.wait -= dt;
      if (v.wait <= 0) {
        const r = landRadius();
        v.tx = clamp(HALL_X + 1 + rand(-r, r), 0.5, WATER_X - 0.5); v.ty = clamp(HALL_Y + 1 + rand(-r, r), 0.5, GRID_H - 0.5);
        v.wait = rand(1, 4);
      }
    } else { const sp = Math.min(d, dt * 0.9); v.x += ((v.tx - v.x) / d) * sp; v.y += ((v.ty - v.y) / d) * sp; }
    const p = tileToScreen(v.x, v.y), ts = cam.ts, bob = d > 0.05 ? Math.abs(Math.sin(t * 9 + v.c.length)) * 1.5 : 0;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(p.x, p.y + 1, ts * 0.08, ts * 0.03, 0, 0, 7); g.fill();
    g.fillStyle = v.c; g.fillRect(p.x - ts * 0.05, p.y - ts * 0.16 - bob, ts * 0.1, ts * 0.14);
    g.fillStyle = '#f1c9a5'; g.beginPath(); g.arc(p.x, p.y - ts * 0.2 - bob, ts * 0.045, 0, 7); g.fill();
  }
}

function drawRaid(g, t) {
  const r = S.raid, k = S.kingdoms[r.kid], p = 1 - r.left / r.total, ts = cam.ts;
  const edge = 0.25 + 0.2 * Math.sin(t * 6);
  const grd = g.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * 0.35, CW / 2, CH / 2, Math.max(CW, CH) * 0.7);
  grd.addColorStop(0, 'rgba(229,83,75,0)'); grd.addColorStop(1, `rgba(229,83,75,${edge})`);
  g.fillStyle = grd; g.fillRect(0, 0, CW, CH);
  const towers = S.buildings.filter((b) => BUILDINGS[b.type].def && b.type !== 'wall' && b.level > 0);
  for (let i = 0; i < r.size; i++) {
    const fall = hash2(i, r.kid, 5) < p * 0.7;
    const sx = -1 + p * (HALL_X - 1) + hash2(i, 2) * 2, sy = 2 + hash2(i, 3) * (GRID_H - 4);
    const pos = tileToScreen(sx, sy);
    if (fall) { g.fillStyle = 'rgba(80,20,20,.5)'; g.fillRect(pos.x - 4, pos.y - 2, 8, 3); continue; }
    drawSoldier(g, pos.x, pos.y, i % 4 === 0 ? 'horseman' : 'swordsman', k.color, 1, t + i, false, false);
    if (towers.length && hash2(i, Math.floor(t * 2)) < 0.12) {
      const tw = pick(towers), tp = tileToScreen(tw.x + 0.5, tw.y);
      g.strokeStyle = tw.type === 'spire' ? '#d2aaff' : '#fff3c4'; g.lineWidth = tw.type === 'spire' ? 2.5 : 1;
      g.beginPath(); g.moveTo(tp.x, tp.y - ts * 0.3); g.lineTo(pos.x, pos.y - 8); g.stroke();
    }
  }
  g.fillStyle = 'rgba(10,12,18,.8)'; g.fillRect(CW / 2 - 150, CH - 44, 300, 32);
  g.fillStyle = '#ffb3ad'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center';
  g.fillText(`⚠ ${k.name} raiding — ${Math.ceil(r.left)}s`, CW / 2, CH - 23); g.textAlign = 'left';
}

function drawFx(g, dt, toScreen, ts) {
  for (const f of UI.fx) {
    f.life -= dt;
    const a = clamp(f.life / f.max, 0, 1);
    if (f.kind === 'text') {
      const p = toScreen(f.tx, f.ty - (1 - a) * 1.1);
      g.globalAlpha = a; g.font = 'bold 12px sans-serif'; g.textAlign = 'center';
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(f.text, p.x + 1, p.y + 1);
      g.fillStyle = f.color || '#fff'; g.fillText(f.text, p.x, p.y); g.textAlign = 'left';
    } else {
      f.tx += f.vx * dt; f.ty += f.vy * dt; f.vy += (f.kind === 'dust' ? 0.5 : 5) * dt;
      const p = toScreen(f.tx, f.ty);
      g.globalAlpha = a;
      if (f.kind === 'dust') { g.fillStyle = '#d8cbb0'; g.beginPath(); g.arc(p.x, p.y, f.r * (1.5 - a * 0.5), 0, 7); g.fill(); }
      else { g.fillStyle = f.color; g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
    }
    g.globalAlpha = 1;
  }
  UI.fx = UI.fx.filter((f) => f.life > 0);
  if (UI.fx.length > 400) UI.fx.splice(0, UI.fx.length - 400);
}

// ---------- world view ----------
function buildWorldCache() {
  const key = `${cam.ws}-${CW}-${CH}`;
  if (key === worldKey) return;
  worldKey = key;
  const c = document.createElement('canvas'); c.width = Math.round(CW * DPR); c.height = Math.round(CH * DPR);
  const g = c.getContext('2d'); g.scale(DPR, DPR);
  const ws = cam.ws, { tiles } = S.world;
  g.fillStyle = '#16324f'; g.fillRect(0, 0, CW, CH);
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    const t = tiles[widx(x, y)], p = worldToScreen(x, y), h = hash2(x, y, 21);
    g.fillStyle = shade(TERRAIN[t].color, (h - 0.5) * (t === T.WATER ? 0.05 : 0.14)); g.fillRect(p.x, p.y, ws + 0.5, ws + 0.5);
    if (t === T.FOREST) for (let i = 0; i < 3; i++) cone(g, p.x + ws * (0.25 + i * 0.25), p.y + ws * (0.75 - (i % 2) * 0.25), ws * 0.14, ws * 0.38, '#2a4f25');
    else if (t === T.HILLS) { cone(g, p.x + ws * 0.4, p.y + ws * 0.8, ws * 0.3, ws * 0.45, '#6f6550'); cone(g, p.x + ws * 0.7, p.y + ws * 0.85, ws * 0.2, ws * 0.3, '#7d735c'); }
    else if (t === T.GOLD) { cone(g, p.x + ws * 0.5, p.y + ws * 0.8, ws * 0.3, ws * 0.4, '#8f7a3a'); g.fillStyle = '#ffe07a'; g.fillRect(p.x + ws * 0.45, p.y + ws * 0.55, 3, 3); g.fillRect(p.x + ws * 0.6, p.y + ws * 0.65, 2, 2); }
    else if (t === T.GEMS) { g.fillStyle = '#c8a8ff'; g.beginPath(); g.moveTo(p.x + ws * 0.5, p.y + ws * 0.2); g.lineTo(p.x + ws * 0.7, p.y + ws * 0.55); g.lineTo(p.x + ws * 0.5, p.y + ws * 0.8); g.lineTo(p.x + ws * 0.3, p.y + ws * 0.55); g.fill(); }
    else if (t === T.PLAINS && h > 0.7) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(p.x + ws * h * 0.6, p.y + ws * 0.5, 2, 2); }
    else if (t === T.WATER) {
      // soft shoreline
      if (N4.some(([dx, dy]) => inWorld(x + dx, y + dy) && tiles[widx(x + dx, y + dy)] !== T.WATER)) { g.fillStyle = 'rgba(160,200,230,.18)'; g.fillRect(p.x, p.y, ws, ws); }
    }
  }
  worldCache = c;
}

let fogCache = null, fogKey = '';
function fogLayer() {
  const seen = S.world.seen, n = seen.reduce((a, b) => a + b, 0), key = `${n}-${worldKey}`;
  if (key === fogKey) return fogCache;
  fogKey = key;
  const ws = cam.ws, w = Math.round(CW * DPR), h = Math.round(CH * DPR);
  const tiles = document.createElement('canvas'); tiles.width = w; tiles.height = h;
  const tg = tiles.getContext('2d'); tg.scale(DPR, DPR);
  tg.fillStyle = '#0d1016';
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    if (seen[widx(x, y)]) continue;
    const p = worldToScreen(x, y); tg.fillRect(p.x - 1, p.y - 1, ws + 2, ws + 2);
  }
  // soft cloud texture inside the fog
  const rng = mulberry32(S.seed + 5);
  for (let i = 0; i < 90; i++) {
    const x = cam.wx + rng() * WORLD_W * ws, y = cam.wy + rng() * WORLD_H * ws, r = ws * (1 + rng() * 2.5);
    const grd = tg.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(60,68,86,.35)'); grd.addColorStop(1, 'rgba(60,68,86,0)');
    tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = grd; tg.fillRect(x - r, y - r, r * 2, r * 2);
  }
  fogCache = document.createElement('canvas'); fogCache.width = w; fogCache.height = h;
  const fg = fogCache.getContext('2d');
  fg.filter = `blur(${Math.max(2, ws * 0.35) * DPR}px)`;
  fg.drawImage(tiles, 0, 0);
  fg.filter = 'none';
  fg.globalAlpha = 0.6; fg.drawImage(tiles, 0, 0);   // keep the core opaque, edges soft
  return fogCache;
}

function drawCastle(g, cx, cy, ws, color, big) {
  const s = ws * (big ? 1.1 : 0.9);
  shadow(g, cx, cy + s * 0.32, s * 0.45, s * 0.12);
  g.fillStyle = '#b7bac2'; g.fillRect(cx - s * 0.35, cy - s * 0.15, s * 0.7, s * 0.45);
  g.fillStyle = '#d0d3da'; g.fillRect(cx - s * 0.18, cy - s * 0.42, s * 0.36, s * 0.35);
  g.fillStyle = color; g.beginPath(); g.moveTo(cx - s * 0.24, cy - s * 0.42); g.lineTo(cx + s * 0.24, cy - s * 0.42); g.lineTo(cx, cy - s * 0.7); g.fill();
  g.fillStyle = '#3a2b1a'; g.fillRect(cx - s * 0.07, cy + s * 0.1, s * 0.14, s * 0.2);
}

function drawWorld(g, t, dt) {
  buildWorldCache();
  g.drawImage(worldCache, 0, 0, CW, CH);
  const ws = cam.ws, { owner, seen, tiles } = S.world;
  // water shimmer
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    if (tiles[widx(x, y)] !== T.WATER || hash2(x, y, 4) < 0.6 || !seen[widx(x, y)]) continue;
    const p = worldToScreen(x, y), o = Math.sin(t + x * 0.8 + y) * ws * 0.15;
    g.beginPath(); g.moveTo(p.x + ws * 0.2 + o, p.y + ws * 0.5); g.lineTo(p.x + ws * 0.6 + o, p.y + ws * 0.5); g.stroke();
  }
  // territories
  const colOf = (o) => (o === -2 ? '#f2c14e' : S.kingdoms[o].color);
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    const i = widx(x, y), o = owner[i];
    if (o === -1 || !seen[i]) continue;
    const p = worldToScreen(x, y), c = colOf(o);
    g.fillStyle = c + '40'; g.fillRect(p.x, p.y, ws, ws);
    g.fillStyle = c;
    const bw = Math.max(2, ws * 0.1);
    if (!inWorld(x, y - 1) || owner[widx(x, y - 1)] !== o) g.fillRect(p.x, p.y, ws, bw);
    if (!inWorld(x, y + 1) || owner[widx(x, y + 1)] !== o) g.fillRect(p.x, p.y + ws - bw, ws, bw);
    if (!inWorld(x - 1, y) || owner[widx(x - 1, y)] !== o) g.fillRect(p.x, p.y, bw, ws);
    if (!inWorld(x + 1, y) || owner[widx(x + 1, y)] !== o) g.fillRect(p.x + ws - bw, p.y, bw, ws);
  }
  // capitals
  const cap = playerCapital(), cp = worldToScreen(cap.x + 0.5, cap.y + 0.5);
  drawCastle(g, cp.x, cp.y, ws, '#f2c14e', true);
  for (const k of S.kingdoms) {
    if (!isSeen(k.cx, k.cy)) continue;
    const p = worldToScreen(k.cx + 0.5, k.cy + 0.5);
    drawCastle(g, p.x, p.y, ws, k.color, k.hall >= 4);
  }
  // fog of war
  g.drawImage(fogLayer(), 0, 0, CW, CH);
  // labels
  g.font = `bold ${Math.max(10, ws * 0.42)}px sans-serif`; g.textAlign = 'center';
  const label = (text, x, y, c) => { g.fillStyle = 'rgba(0,0,0,.65)'; const w = g.measureText(text).width + 8; g.fillRect(x - w / 2, y - ws * 0.42, w, ws * 0.56); g.fillStyle = c; g.fillText(text, x, y); };
  label(S.name, cp.x, cp.y + ws * 1.05, '#f2c14e');
  for (const k of S.kingdoms) if (isSeen(k.cx, k.cy)) { const p = worldToScreen(k.cx + 0.5, k.cy + 0.5); label(`${k.name} ·${k.hall}`, p.x, p.y + ws * 1.05, shade(k.color, 0.35)); }
  g.textAlign = 'left';
  // scout missions
  for (const m of S.missions) {
    const a = worldToScreen(cap.x + 0.5, cap.y + 0.5), b = worldToScreen(m.x + 0.5, m.y + 0.5), p = 1 - m.left / m.total;
    g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
    const x = lerp(a.x, b.x, p), y = lerp(a.y, b.y, p);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 5 + Math.sin(t * 8), 0, 7); g.fill();
    g.fillStyle = '#4ea1f2'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
    g.strokeStyle = '#4ea1f2'; g.beginPath(); g.arc(b.x, b.y, ws * (0.4 + (t % 1) * 0.5), 0, 7); g.stroke();
  }
  // selection + hover
  const sel = UI.worldSel;
  if (sel) { const p = worldToScreen(sel.x, sel.y); g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.strokeRect(p.x + 1, p.y + 1, ws - 2, ws - 2); g.strokeStyle = '#f2c14e'; g.lineWidth = 1; g.strokeRect(p.x - 2, p.y - 2, ws + 4, ws + 4); }
  const h = UI.hover;
  if (h && inWorld(h.x, h.y)) { const p = worldToScreen(h.x, h.y); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.strokeRect(p.x + 0.5, p.y + 0.5, ws - 1, ws - 1); }
  UI.fx.length = 0;   // kingdom-space effects don't belong on the world map
}

/* ================================= 10. UI ================================ */

// ---------- toasts ----------
function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = text;
  el('toasts').appendChild(t);
  while (el('toasts').children.length > 5) el('toasts').firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 3800);
}

// ---------- HUD ----------
function buildHud() {
  el('resources').innerHTML = RES.map((k) => `<div class="res" id="res-${k}" style="--c:${RES_META[k].color}" title="${RES_META[k].name}">
    <span class="ico">${RES_META[k].icon}</span><span class="val">0</span><span class="rate"></span><i class="fill"></i></div>`).join('');
}
function bumpRes(keys) {
  for (const k of keys) { const n = el('res-' + k); if (n) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); } }
}
function updateHud() {
  const r = rates();
  for (const k of RES) {
    const n = el('res-' + k), cap = capOf(k);
    n.querySelector('.val').textContent = fmt(S.res[k]);
    const rate = n.querySelector('.rate');
    const v = r[k] * 60;
    rate.textContent = (v >= 0 ? '+' : '') + (Math.abs(v) >= 100 ? fmt(v) : v.toFixed(Math.abs(v) < 10 ? 1 : 0)) + '/m';
    rate.classList.toggle('neg', v < 0);
    n.querySelector('.fill').style.width = clamp((S.res[k] / cap) * 100, 0, 100) + '%';
    n.title = `${RES_META[k].name}: ${Math.floor(S.res[k])} / ${cap} storage`;
  }
  el('kingdom-name').textContent = S.name;
  el('hall-label').textContent = `Main Hall ${hallLevel()} · ${playerTiles()} territories`;
  el('builders').textContent = `${buildersBusy()}/${builderCount()}`;
  el('army-cap').textContent = `${armyHousing() + queuedHousing()}/${armyCap()}`;
  el('power').textContent = fmt(totalPower());
  el('shield-chip').hidden = S.shield <= 0;
  el('shield-time').textContent = fmtTime(S.shield);
  el('log-dot').hidden = !UI.logUnread;
  if (!API.online) el('sync-label').textContent = 'local';
}

// ---------- panel ----------
const statBars = (st) => `
  <div class="stat-bar atk"><span>Attack</span><div class="track"><i style="width:${st.atk}%"></i></div><b>${st.atk}</b></div>
  <div class="stat-bar hp"><span>Health</span><div class="track"><i style="width:${st.hp}%"></i></div><b>${st.hp}</b></div>
  <div class="stat-bar spd"><span>Speed</span><div class="track"><i style="width:${st.spd}%"></i></div><b>${st.spd}</b></div>`;
const btn = (label, action, arg = '', opts = {}) =>
  `<button class="btn ${opts.cls || ''}" data-action="${action}" data-arg="${esc(arg)}" ${opts.disabled ? 'disabled' : ''} ${opts.title ? `title="${esc(opts.title)}"` : ''}>${label}</button>`;
const progress = (p) => `<div class="progress"><i style="width:${clamp(p * 100, 0, 100)}%"></i></div>`;

function renderPanel(force) {
  if (!force && (UI.pointerDown || (document.activeElement && el('panel').contains(document.activeElement) && document.activeElement.tagName === 'INPUT'))) return;
  const fn = { info: renderInfo, army: renderArmy, generals: renderGenerals, shop: renderShop, alliance: renderAlliance, log: renderLog }[UI.tab];
  const html = fn();
  if (html !== UI.lastPanelHtml) {
    const body = el('panel-body'), scroll = body.scrollTop;
    body.innerHTML = html; body.scrollTop = scroll;
    UI.lastPanelHtml = html;
  }
  UI.panelDirty = false;
}

function renderInfo() {
  if (UI.view === 'world') return renderWorldInfo();
  const b = S.buildings.find((x) => x.id === UI.selected);
  return b ? renderBuildingInfo(b) : renderBuildList();
}

function renderBuildList() {
  const hall = S.buildings.find((b) => b.type === 'hall');
  let h = `<h2>Build</h2><p class="muted small">Pick a structure, then click a free tile inside your land (dashed border). Walls can be painted by dragging.</p>
    <div class="card hl"><div class="row"><span style="font-size:26px">🏰</span><div><b>Main Hall · level ${hall.level}</b><div class="small muted">Storage ${fmt(capOf('gold'))} · Builders ${builderCount()} · Land ${Math.round(landRadius() * 2)}×${Math.round(landRadius() * 2)}</div></div>
    <span class="spacer"></span>${btn('View', 'select', hall.id, { cls: 'sm ghost' })}</div>
    ${hall.build > 0 ? `<div style="margin-top:8px">${progress(1 - hall.build / hall.buildTotal)}<div class="small muted">Upgrading… ${fmtTime(hall.build)}</div></div>` : ''}</div>`;
  for (const cat of ['resource', 'defense', 'military', 'core']) {
    const types = BUILD_ORDER.filter((t) => BUILDINGS[t].cat === cat);
    h += `<h3>${CAT_NAMES[cat]}</h3><div class="build-grid">`;
    for (const t of types) {
      const d = BUILDINGS[t], lock = buildLockReason(t), cost = costFor(t, 1);
      const hardLock = d.hall && hallLevel() < d.hall;
      h += `<button class="build-item ${lock ? 'locked' : ''}" data-action="place" data-arg="${t}" ${lock ? `title="${esc(lock)}"` : ''} data-type="${t}">
        <div class="bi-top"><span class="bi-ico">${d.icon}</span><b>${d.name}</b><span class="count">${countOf(t)}/${limitOf(t)}</span></div>
        ${hardLock ? `<div class="desc">🔒 Main Hall ${d.hall}</div>` : `<div>${costHtml(cost, S.res)}</div>`}
        <div class="desc">${lock && !hardLock ? '⛔ ' + esc(lock) : esc(d.desc)}</div></button>`;
    }
    h += '</div>';
  }
  return h;
}

function hallUnlocks(level) {
  const out = [];
  for (const t of BUILD_ORDER) {
    const a = limitOf(t, level - 1), bb = limitOf(t, level);
    if (bb > a) out.push(`${BUILDINGS[t].icon} ${BUILDINGS[t].name} ${a === 0 ? '(new!)' : `${a}→${bb}`}`);
  }
  return out;
}

function renderBuildingInfo(b) {
  const d = BUILDINGS[b.type], prod = productionOf(b);
  let h = `<div class="row"><span style="font-size:34px">${d.icon}</span><div><h2>${d.name}</h2><div class="muted small">Level ${b.level}${b.type === 'hall' ? ' / ' + MAX_HALL : ' / ' + hallLevel()} · tile (${b.x},${b.y})</div></div>
    <span class="spacer"></span><button class="icon-btn" data-action="deselect" title="Close">✕</button></div><p class="small muted">${esc(d.desc)}</p>`;
  if (b.build > 0) h += `<div class="card">${progress(1 - b.build / b.buildTotal)}<div class="small" style="margin-top:4px">${b.level === 0 ? 'Constructing' : 'Upgrading to level ' + (b.level + 1)}… <b>${fmtTime(b.build)}</b></div>
    ${S.items.hammer ? `<div style="margin-top:6px">${btn(`🔨 Use Builder's Hammer (${S.items.hammer})`, 'use-item', 'hammer', { cls: 'sm ghost' })}</div>` : ''}</div>`;
  h += '<dl class="kv">';
  if (prod) {
    const nxt = { ...b, level: b.level + 1 };
    h += `<dt>Production</dt><dd>${RES_META[prod[0]].icon} ${(prod[1] * 60).toFixed(0)}/min${b.type !== 'hall' ? ` → ${(productionOf(nxt)[1] * 60).toFixed(0)}` : ''}</dd>`;
  }
  if (d.def) h += `<dt>Defense rating</dt><dd>🛡️ ${Math.round(d.def * Math.pow(Math.max(1, b.level), 1.25))}</dd>`;
  if (d.trains) h += `<dt>Unit level</dt><dd>${b.level} (+${Math.round(12 * (b.level - 1))}% stats)</dd>`;
  if (b.type === 'hall') h += `<dt>Storage cap</dt><dd>${fmt(capOf('gold'))} (💎${capOf('diamonds')})</dd><dt>Territory limit</dt><dd>${territoryLimit()}</dd><dt>Army housing</dt><dd>${armyCap()}</dd>`;
  h += '</dl>';
  const maxed = b.type === 'hall' ? b.level >= MAX_HALL : false;
  if (!maxed) {
    const cost = costFor(b.type, b.level + 1), err = upgradeError(b);
    h += `<h3>Upgrade to level ${b.level + 1}</h3><div class="card"><div class="row wrap">${costHtml(cost, S.res)}<span class="small muted">⏱ ${fmtTime(buildTime(b.type, b.level + 1))}</span></div>
      ${b.type === 'hall' ? `<div class="small muted" style="margin-top:6px">Unlocks: ${hallUnlocks(b.level + 1).join(' · ') || 'more land & storage'}, +land, +storage${[2, 4].includes(b.level) ? ', +1 builder' : ''}</div>` : ''}
      <div style="margin-top:8px">${btn('⬆ Upgrade', 'upgrade', b.id, { disabled: !!err, title: err || '', cls: 'block' })}</div>
      ${err ? `<div class="small muted" style="margin-top:4px">${esc(err)}</div>` : ''}</div>`;
  } else h += `<p class="muted">Maximum level reached. Long live the crown!</p>`;
  if (d.trains) h += `<h3>Training</h3>` + unitRow(d.trains);
  if (b.type === 'port' && b.level > 0) {
    const sell = (0.5 + 0.1 * b.level).toFixed(1), buy = (2.2 - 0.15 * b.level).toFixed(2);
    h += `<h3>Market</h3><p class="small muted">Sell 200 goods for ${sell}🪙 each · buy 100 goods for ${buy}🪙 each.</p><div class="row wrap">`;
    for (const r of ['lumber', 'iron', 'food']) h += btn(`Sell 200 ${RES_META[r].icon}`, 'trade', 'sell:' + r, { cls: 'sm ghost' }) + btn(`Buy 100 ${RES_META[r].icon}`, 'trade', 'buy:' + r, { cls: 'sm ghost' });
    h += '</div>';
  }
  if (b.type === 'scoutlodge') h += `<p class="small muted">Send scouts from the 🗺️ World map: click any tile, then "Send scouts". Lodge level increases reveal radius.</p>`;
  if (b.type !== 'hall') h += `<div style="margin-top:16px">${btn('Demolish', 'demolish', b.id, { cls: 'sm red' })}</div>`;
  return h;
}

function unitRow(u) {
  const U = UNITS[u], t = trainerOf(u), st = unitStats(u);
  const q = t ? t.queue : [];
  const noBuild = !t;
  return `<div class="card"><div class="unit-row"><span class="unit-ico">${U.icon}</span><div><b>${U.name}</b> <span class="muted">× ${S.army[u]}</span>
    <div class="stats-mini">⚔ ${st.atk.toFixed(0)} · ❤ ${st.hp.toFixed(0)} · 💨 ${st.speed.toFixed(1)}${U.housing > 1 ? ' · 🏠' + U.housing : ''} · ⏱${U.time}s</div>
    <div>${costHtml(U.cost, S.res)}</div></div>
    <div class="row">${btn('+1', 'train', u + ':1', { cls: 'sm', disabled: noBuild })}${btn('+5', 'train', u + ':5', { cls: 'sm', disabled: noBuild })}</div></div>
    ${noBuild ? `<div class="small muted" style="margin-top:4px">Build a ${BUILDINGS[U.from].name}${BUILDINGS[U.from].hall ? ` (Main Hall ${BUILDINGS[U.from].hall})` : ''} to train ${U.name}s.</div>` : ''}
    ${q.length ? `<div class="queue">${q.map((x, i) => `<span class="${i === 0 ? 'first' : ''}">${UNITS[x].icon}${i === 0 ? ' ' + fmtTime(t.trainLeft) : ''}</span>`).join('')}
      <button class="btn sm ghost" data-action="cancel-train" data-arg="${t.id}" title="Cancel last">✕</button></div>` : ''}</div>`;
}

function renderArmy() {
  const g = generalData(), gs = generalStats();
  let h = `<h2>Army</h2><dl class="kv"><dt>Housing</dt><dd>${armyHousing()} + ${queuedHousing()} queued / ${armyCap()}</dd>
    <dt>Army power</dt><dd>⚡ ${fmt(armyPower())}</dd><dt>Defense rating</dt><dd>🛡️ ${fmt(defenseRating())}</dd><dt>Food upkeep</dt><dd>🌾 ${(armyHousing() * 0.9).toFixed(1)}/min</dd></dl>`;
  h += `<div class="card" style="margin-top:10px"><div class="general"><div class="portrait r-${g.rarity}">${g.icon}</div><div><b>${g.name}</b> <span class="stars">${'★'.repeat(ownedGeneral().stars)}</span>
    <div class="small muted">Commanding: +${gs.atk / 2}% atk, +${gs.hp / 2}% hp, +${gs.spd / 4}% speed${g.spec ? ` · +15% ${UNITS[g.spec].name}s` : ''}</div></div></div></div>`;
  if (S.boosts.warhorn || S.boosts.salve) h += `<p class="small">Ready for next battle: ${S.boosts.warhorn ? '📯 War Horn ' : ''}${S.boosts.salve ? '🧪 Healing Salve' : ''}</p>`;
  h += '<h3>Train units</h3>';
  for (const u of Object.keys(UNITS)) h += unitRow(u);
  h += `<p class="small muted">Tip: scout a rival on the 🗺️ World map, then attack it from its tile to plunder resources and seize land.</p>`;
  return h;
}

function renderGenerals() {
  const g = generalData(), o = ownedGeneral();
  let h = `<h2>Generals</h2><p class="small muted">Your active general boosts every unit in battle. Win rarer generals from Mystery Boxes — duplicates add stars (+10% stats each).</p>
    <div class="card hl"><div class="general"><div class="portrait r-${g.rarity}">${g.icon}</div><div>
    <div class="rarity r-${g.rarity}">${RARITY[g.rarity].name} · Active</div><b style="font-size:16px">${g.name}</b> <span class="stars">${'★'.repeat(o.stars)}${'☆'.repeat(5 - o.stars)}</span></div></div>
    <div style="margin-top:8px" id="active-general-bars">${statBars(generalStats())}</div>
    <p class="small muted" style="margin:8px 0 0">${esc(g.lore)}${g.spec ? ` <b>Specialty:</b> +15% ${UNITS[g.spec].name}s.` : ''}</p></div>
    <h3>Roster · ${S.generals.length}/${GENERALS.length} discovered</h3><div class="roster">`;
  const order = ['legendary', 'epic', 'rare', 'common'];
  const owned = [...S.generals].sort((a, b) => order.indexOf(generalData(a.id).rarity) - order.indexOf(generalData(b.id).rarity));
  for (const og of owned) {
    const gd = generalData(og.id), st = generalStats(og.id), active = og.id === S.activeGeneral;
    h += `<div class="card ${active ? 'hl' : ''}"><div class="portrait r-${gd.rarity}">${gd.icon}</div><div class="rarity r-${gd.rarity}">${RARITY[gd.rarity].name}</div>
      <b class="small">${gd.name}</b><div class="stars">${'★'.repeat(og.stars)}</div>${statBars(st)}
      <div style="margin-top:6px">${active ? '<span class="small muted">Commanding</span>' : btn('Appoint', 'appoint', og.id, { cls: 'sm' })}</div></div>`;
  }
  for (let i = S.generals.length; i < GENERALS.length; i++) h += `<div class="card" style="opacity:.35"><div class="portrait">❔</div><div class="small muted">Undiscovered</div></div>`;
  h += '</div><h3>Items</h3>';
  for (const [k, it] of Object.entries(ITEMS)) {
    h += `<div class="card"><div class="row"><span style="font-size:22px">${it.icon}</span><div><b>${it.name}</b> <span class="muted">× ${S.items[k]}</span><div class="small muted">${it.desc}</div></div><span class="spacer"></span>
      ${btn('Use', 'use-item', k, { cls: 'sm', disabled: !S.items[k] || S.boosts[k] })}</div></div>`;
  }
  return h;
}

function renderShop() {
  let h = `<h2>Mystery Boxes</h2><p class="small muted">Spend coins for a chance at rare generals, bundles of resources, or special items.</p>`;
  for (const b of BOXES) {
    h += `<div class="card"><div class="box-card"><div class="box-art" style="--glow:${b.glow}">${b.icon}</div><div><b>${b.name}</b>
      <div class="odds">${Object.entries(b.kinds).map(([k, v]) => `<span class="muted">${{ res: 'Resources', item: 'Item', general: 'General' }[k]} ${v}%</span>`).join('')}</div>
      <div class="odds">${Object.entries(b.rarity).filter(([, v]) => v).map(([r, v]) => `<span class="r-${r}">${RARITY[r].name} ${v}%</span>`).join('')}</div>
      <div class="row">${costHtml(b.cost, S.res)}<span class="spacer"></span>${btn('Open', 'open-box', b.id, { disabled: !canAfford(b.cost) })}</div></div></div></div>`;
  }
  h += `<p class="small muted">Boxes opened: ${S.stats.boxesOpened}</p>`;
  return h;
}

function relationBar(v) {
  const c = v > 20 ? 'var(--green)' : v < -20 ? 'var(--red)' : 'var(--gold)';
  const label = v > 40 ? 'Friendly' : v > 10 ? 'Cordial' : v > -10 ? 'Neutral' : v > -40 ? 'Hostile' : 'Enemy';
  return `<span style="color:${c}">${label} (${Math.round(v)})</span>`;
}

function renderWorldInfo() {
  const sel = UI.worldSel;
  let h = '';
  if (!sel) {
    h += `<h2>World Map</h2><p class="small muted">Click any tile to inspect it. Scout the fog, claim neutral land for production bonuses, and raid rival kingdoms.</p>
      <dl class="kv"><dt>Territories</dt><dd>${playerTiles()} / ${territoryLimit()}</dd><dt>Scouts at home</dt><dd>🔭 ${S.army.scout}</dd>
      <dt>Port (island access)</dt><dd>${hasPort() ? '✅' : '❌'}</dd></dl>`;
    const tb = territoryBonus();
    h += `<p class="small">Land bonus: ${RES.filter((k) => tb[k] > 0).map((k) => `${RES_META[k].icon}+${(tb[k] * 60).toFixed(k === 'diamonds' ? 1 : 0)}/m`).join(' ') || 'none yet'}</p>`;
  } else {
    const i = widx(sel.x, sel.y), t = S.world.tiles[i], o = S.world.owner[i], seen = isSeen(sel.x, sel.y);
    const ter = TERRAIN[t];
    h += `<div class="row"><h2>${seen ? ter.name : 'Unexplored'}</h2><span class="muted small">(${sel.x}, ${sel.y})</span><span class="spacer"></span><button class="icon-btn" data-action="world-deselect">✕</button></div>`;
    if (seen && ter.bonus) h += `<p class="small">Bonus when held: ${Object.entries(ter.bonus).map(([k, v]) => `${RES_META[k].icon} +${(v * 60).toFixed(k === 'diamonds' ? 1 : 0)}/min`).join(' ')}</p>`;
    if (seen && o === -2) h += `<p class="card">🏳️ Your territory${sel.x === playerCapital().x && sel.y === playerCapital().y ? ' — the capital' : ''}.</p>`;
    if (seen && o === -1 && t !== T.WATER) {
      const err = claimError(sel.x, sel.y);
      h += `<div class="card"><b>Neutral land</b><div class="row" style="margin-top:6px">${costHtml(claimCost(), S.res)}<span class="spacer"></span>${btn('🏳️ Claim', 'claim', '', { disabled: !!err, title: err || '' })}</div>${err ? `<div class="small muted">${esc(err)}</div>` : ''}</div>`;
    }
    if (seen && o >= 0) h += kingdomCard(S.kingdoms[o]);
    const n = S.army.scout;
    h += `<h3>Scouting</h3><div class="card"><div class="row"><span>Send</span><select id="scout-count" style="width:80px">${Array.from({ length: Math.max(1, n) }, (_, k) => `<option>${k + 1}</option>`).join('')}</select><span>of ${n} scouts</span><span class="spacer"></span>
      ${btn('🔭 Send scouts', 'scout', '', { disabled: n < 1 })}</div><div class="small muted" style="margin-top:4px">Travel ≈ ${fmtTime(3 + dist(playerCapital().x, playerCapital().y, sel.x, sel.y) * 0.9)} · reveals the area and gathers intel on nearby kingdoms.</div></div>`;
  }
  if (S.missions.length) h += '<h3>Missions</h3>' + S.missions.map((m) => `<div class="card small">🔭 ${m.n} scout${m.n > 1 ? 's' : ''} → (${m.x},${m.y}) ${progress(1 - m.left / m.total)} ${fmtTime(m.left)}</div>`).join('');
  h += '<h3>Known kingdoms</h3>';
  const known = S.kingdoms.filter((k) => isSeen(k.cx, k.cy));
  if (!known.length) h += '<p class="small muted">None yet — send scouts into the fog.</p>';
  for (const k of known) {
    const a = allianceOf(k.allianceId);
    h += `<div class="member" data-action="world-focus" data-arg="${k.id}" style="cursor:pointer"><span class="dot" style="background:${k.color}"></span><div><b>${k.name}</b><div class="small muted">Keep ${k.hall} · ${kingdomTiles(k.id)} lands${a ? ' · ' + a.emblem + ' ' + esc(a.name) : ''}</div></div><span class="spacer"></span><span class="small">${relationBar(k.relation)}</span></div>`;
  }
  return h;
}

function kingdomCard(k) {
  const intel = S.intel[k.id], a = allianceOf(k.allianceId), allied = S.allianceId && k.allianceId === S.allianceId;
  let h = `<div class="card hl"><div class="row"><span class="dot" style="background:${k.color};width:16px;height:16px"></span><div><b>${k.name}</b><div class="small muted">${k.ruler} · ${PERSONALITIES[k.personality].name}</div></div></div>
    <dl class="kv" style="margin-top:8px"><dt>Relation</dt><dd>${relationBar(k.relation)}</dd><dt>Alliance</dt><dd>${a ? a.emblem + ' ' + esc(a.name) : '—'}</dd>`;
  if (intel) {
    h += `<dt>Keep level</dt><dd>${intel.hall}</dd><dt>Army (est.)</dt><dd>⚡ ~${fmt(intel.power)}</dd><dt>Defenses (est.)</dt><dd>🛡️ ~${fmt(intel.defense)}</dd>
      <dt>Treasury</dt><dd>🪙${fmt(intel.res.gold)} 🪵${fmt(intel.res.lumber)}</dd><dt>Intel age</dt><dd>${fmtTime(S.time - intel.t)} ago</dd>`;
  } else h += `<dt>Intel</dt><dd class="muted">Unknown — send scouts</dd>`;
  h += `</dl><div class="row wrap" style="margin-top:10px">
    ${btn('⚔️ Attack', 'attack-open', k.id, { cls: 'red', disabled: !intel || allied, title: allied ? 'This kingdom is your ally' : !intel ? 'Scout them first' : '' })}
    ${btn('🎁 Gift 🪙200', 'gift', k.id, { cls: 'ghost sm' })}
    ${S.allianceId && allianceOf(S.allianceId).leader === 'P' && !allied ? btn('🤝 Invite', 'invite', k.id, { cls: 'blue sm' }) : ''}</div></div>`;
  return h;
}

let leaderboardCache = { t: 0, data: null };
function renderAlliance() {
  const a = allianceOf(S.allianceId);
  let h = '';
  if (a) {
    const bonus = allianceBonus(), leader = a.leader === 'P';
    h += `<div class="row"><div class="emblem" style="background:${a.color}">${a.emblem}</div><div><h2>${esc(a.name)}</h2><div class="small muted">Level ${a.level} · ${a.members.length} members · ${a.open ? 'Open' : 'Invite only'}</div></div></div>
      <div style="margin:8px 0">${progress(a.level >= 10 ? 1 : a.xp / xpNeed(a.level))}<div class="small muted">${a.level >= 10 ? 'Max level' : `${fmt(a.xp)} / ${fmt(xpNeed(a.level))} XP`}</div></div>
      <div class="card"><b class="small">Shared bonuses</b><div class="small">🌾 +${Math.round(bonus.prod * 100)}% production · ⚔ +${Math.round(bonus.atk * 100)}% attack · 🛡 +${Math.round(bonus.def * 100)}% defense · ⏱ +${Math.round(bonus.train * 100)}% training</div>
      <div class="small muted">Allies never raid you and send reinforcements when you are attacked.</div></div>
      <h3>Members</h3><div class="card">`;
    for (const m of a.members) {
      const k = m === 'P' ? null : S.kingdoms[m];
      h += `<div class="member"><span class="dot" style="background:${memberColor(m)}"></span><div><b>${esc(memberName(m))}</b> ${a.leader === m ? '👑' : ''}<div class="small muted">⚡ ${fmt(k ? k.power + k.defense : totalPower())}</div></div><span class="spacer"></span>
        ${leader && m !== 'P' ? btn('Kick', 'kick', m, { cls: 'sm ghost' }) : ''}</div>`;
    }
    h += '</div>';
    if (leader) {
      const cands = S.kingdoms.filter((k) => k.allianceId !== a.id);
      h += `<h3>Manage</h3><div class="row wrap">${btn(a.open ? '🔓 Open recruitment' : '🔒 Invite only', 'toggle-open', '', { cls: 'sm ghost' })}</div>
        <div class="card" style="margin-top:8px"><b class="small">Invite kingdoms</b>` + (cands.length ? cands.map((k) => `<div class="member"><span class="dot" style="background:${k.color}"></span><div class="small"><b>${k.name}</b><div class="muted">${relationBar(k.relation)}${k.allianceId ? ' · in ' + esc(allianceOf(k.allianceId).name) : ''}</div></div><span class="spacer"></span>${btn('Invite', 'invite', k.id, { cls: 'sm blue' })}</div>`).join('') : '<div class="small muted">Every kingdom has joined you!</div>') + '</div>';
    }
    h += `<h3>Donate</h3><div class="row wrap">${[['gold', 250], ['lumber', 250], ['iron', 150], ['food', 250], ['diamonds', 5]].map(([r, v]) => btn(`${RES_META[r].icon}${v}`, 'donate', `${r}:${v}`, { cls: 'sm ghost', disabled: S.res[r] < v })).join('')}</div>
      <h3>Alliance chat</h3><div class="chat" id="chat">${a.chat.slice(-30).map((c) => `<div><b style="color:${memberColor(c.who)}">${esc(c.who === 'P' ? S.name : S.kingdoms[c.who].name)}:</b> ${esc(c.text)}</div>`).join('') || '<span class="muted">No messages yet.</span>'}</div>
      <div class="row" style="margin-top:6px"><input type="text" id="chat-input" placeholder="Message your allies…" maxlength="140" />${btn('Send', 'chat-send', '', { cls: 'sm' })}</div>
      <div style="margin-top:14px">${btn('Leave alliance', 'leave', '', { cls: 'sm red' })}</div>`;
  } else {
    const d = UI.allianceDraft || (UI.allianceDraft = { name: '', color: ALLIANCE_COLORS[0], emblem: ALLIANCE_EMBLEMS[0] });
    h += `<h2>Alliances</h2><p class="small muted">Band together with other kingdoms for shared production, attack, defense and training bonuses. Allies never raid you and reinforce you when attacked.</p>`;
    for (const x of S.alliances) {
      const can = hallLevel() >= x.minHall;
      h += `<div class="card"><div class="row"><div class="emblem" style="background:${x.color}">${x.emblem}</div><div><b>${esc(x.name)}</b><div class="small muted">Lvl ${x.level} · ${x.members.length} members · ${x.open ? 'Open' : 'Invite only'} · Hall ${x.minHall}+</div>
        <div class="small">${x.members.map((m) => `<span class="dot" style="background:${memberColor(m)};width:8px;height:8px"></span> ${esc(memberName(m))}`).join(' ')}</div></div><span class="spacer"></span>
        ${btn(x.open ? 'Join' : 'Request', 'join', x.id, { cls: 'sm', disabled: !can, title: can ? '' : `Requires Main Hall ${x.minHall}` })}</div></div>`;
    }
    h += `<h3>Found your own</h3><div class="card"><input type="text" id="alliance-name" placeholder="Alliance name" maxlength="28" value="${esc(d.name)}" />
      <div class="row" style="margin-top:8px"><span class="small muted">Emblem</span><div class="swatches">${ALLIANCE_EMBLEMS.map((e) => `<button class="${e === d.emblem ? 'sel' : ''}" style="background:#262d3b" data-action="emblem" data-arg="${e}">${e}</button>`).join('')}</div></div>
      <div class="row" style="margin-top:8px"><span class="small muted">Colour</span><div class="swatches">${ALLIANCE_COLORS.map((c) => `<button class="${c === d.color ? 'sel' : ''}" style="background:${c}" data-action="color" data-arg="${c}"></button>`).join('')}</div></div>
      <div class="row" style="margin-top:10px">${costHtml({ gold: 1000 }, S.res)}<span class="spacer"></span>${btn('Found alliance', 'create-alliance', '', { disabled: S.res.gold < 1000 })}</div></div>`;
  }
  // rankings
  const rows = [{ name: S.name + ' (you)', power: totalPower(), color: '#f2c14e', you: true }]
    .concat(S.kingdoms.map((k) => ({ name: isSeen(k.cx, k.cy) ? k.name : '??? (unscouted)', power: k.power + k.defense, color: k.color })))
    .sort((x, y) => y.power - x.power);
  h += '<h3>Realm ranking</h3><div class="card">' + rows.map((r, i) => `<div class="member"><b style="width:20px">${i + 1}</b><span class="dot" style="background:${r.color}"></span><span ${r.you ? 'style="color:var(--gold);font-weight:700"' : ''}>${esc(r.name)}</span><span class="spacer"></span><span class="small">⚡ ${fmt(r.power)}</span></div>`).join('') + '</div>';
  if (API.online) {
    if (Date.now() - leaderboardCache.t > 30000) { leaderboardCache.t = Date.now(); API.leaderboard().then((d) => { leaderboardCache.data = d; UI.panelDirty = true; }); }
    const lb = leaderboardCache.data;
    h += '<h3>Global ranking (server)</h3><div class="card">' + (lb && lb.length ? lb.map((p, i) => `<div class="member"><b style="width:20px">${i + 1}</b><span>${esc(p.name)}</span><span class="spacer"></span><span class="small">Hall ${p.hall} · ⚡ ${fmt(p.power)}</span></div>`).join('') : '<span class="small muted">Loading…</span>') + '</div>';
  }
  return h;
}

function renderLog() {
  UI.logUnread = false;
  return `<h2>Chronicle</h2><dl class="kv" style="margin-bottom:10px"><dt>Battles won / lost</dt><dd>${S.stats.battlesWon} / ${S.stats.battlesLost}</dd><dt>Raids repelled / suffered</dt><dd>${S.stats.raidsRepelled} / ${S.stats.raidsLost}</dd><dt>Scouting missions</dt><dd>${S.stats.scouted}</dd></dl>` +
    S.log.map((l) => `<div class="log-item ${l.kind}"><time>${fmtTime(l.t)}</time><span>${esc(l.text)}</span></div>`).join('');
}

// ---------- modals ----------
function showModal(html) { UI.boxToken = (UI.boxToken || 0) + 1; el('modal-card').innerHTML = html; el('modal').hidden = false; }
function closeModal() { el('modal').hidden = true; el('modal-card').innerHTML = ''; }

function showWelcome() {
  showModal(`<h2 style="font-size:26px">👑 Ironcrown</h2><p>Rule a young kingdom in a realm of rivals. Mine gold and iron, raise walls and towers, train archers, swordsmen and horsemen, recruit legendary generals — and decide who to befriend and who to conquer.</p>
    <ul class="small muted" style="padding-left:18px"><li>Resources flow in automatically — even while you're away.</li><li>Upgrade the <b>Main Hall</b> to unlock land, buildings and levels.</li><li>Scout the 🗺️ World map, claim land, raid rivals, join alliances.</li></ul>
    <label class="small muted">Name your kingdom</label><input type="text" id="welcome-name" value="${esc(S.name)}" maxlength="24" />
    <div class="actions"><button class="btn" data-action="begin" id="begin-btn">Begin your reign</button></div>`);
}

function showMenu() {
  showModal(`<h2>Kingdom menu</h2><dl class="kv"><dt>Save slot</dt><dd>${esc(SLOT)}</dd><dt>Backend</dt><dd>${API.online ? '🟢 Python server (cloud save)' : '⚪ Local browser storage'}</dd><dt>Played</dt><dd>${fmtTime(S.time)}</dd></dl>
    <h3>Rename kingdom</h3><div class="row"><input type="text" id="rename-input" value="${esc(S.name)}" maxlength="24" />${btn('Rename', 'rename', '', { cls: 'sm' })}</div>
    <h3>Save data</h3><div class="row wrap">${btn('💾 Save now', 'save', '', { cls: 'sm' })}${btn('Export', 'export', '', { cls: 'sm ghost' })}${btn('Import', 'import', '', { cls: 'sm ghost' })}${btn('Reset game', 'reset', '', { cls: 'sm red' })}</div>
    <div class="actions">${btn('Close', 'close-modal', '', { cls: 'ghost' })}</div>`);
}

function showAttack(kid) {
  const k = S.kingdoms[kid], intel = S.intel[kid];
  UI.attackDraft = { kid, sent: Object.fromEntries(COMBAT_UNITS.map((u) => [u, S.army[u]])) };
  const g = generalData();
  const rows = COMBAT_UNITS.map((u) => `<div class="row" style="margin:6px 0"><span style="width:26px">${UNITS[u].icon}</span><span style="width:90px">${UNITS[u].name}</span>
    <input type="range" min="0" max="${S.army[u]}" value="${S.army[u]}" data-send="${u}" ${S.army[u] ? '' : 'disabled'} /><b style="width:60px;text-align:right" id="send-${u}">${S.army[u]}/${S.army[u]}</b></div>`).join('');
  showModal(`<h2>⚔️ Attack ${k.name}</h2><p class="small muted">Est. enemy army ⚡${fmt(intel.power)} · defenses 🛡️${fmt(intel.defense)} (intel ${fmtTime(S.time - intel.t)} old)</p>
    ${rows}
    <div class="card" style="margin-top:10px"><div class="general"><div class="portrait r-${g.rarity}">${g.icon}</div><div><b>${g.name}</b> leads the assault${statBars(generalStats())}</div></div></div>
    <div class="row wrap small">${S.boosts.warhorn ? '📯 War Horn active' : S.items.warhorn ? btn('Use 📯 War Horn', 'use-item', 'warhorn', { cls: 'sm ghost' }) : ''} ${S.boosts.salve ? '🧪 Healing Salve active' : S.items.salve ? btn('Use 🧪 Salve', 'use-item', 'salve', { cls: 'sm ghost' }) : ''}</div>
    <p>Your strike force: <b id="attack-power">⚡${fmt(armyPower())}</b> vs ~⚡${fmt(intel.power + intel.defense * 0.8)}</p>
    <div class="actions">${btn('Cancel', 'close-modal', '', { cls: 'ghost' })}${btn('⚔️ Launch attack', 'attack-launch', kid, { cls: 'red', disabled: armyPower() <= 0 })}</div>`);
}
function updateAttackDraft() {
  const d = UI.attackDraft;
  document.querySelectorAll('[data-send]').forEach((r) => { d.sent[r.dataset.send] = +r.value; el('send-' + r.dataset.send).textContent = `${r.value}/${S.army[r.dataset.send]}`; });
  const p = COMBAT_UNITS.reduce((s, u) => s + unitPower(unitStats(u, S.boosts)) * d.sent[u], 0);
  el('attack-power').textContent = '⚡' + fmt(p);
  const launch = document.querySelector('[data-action="attack-launch"]');
  if (launch) launch.disabled = p <= 0;
}

function showBoxOpening(box, reward) {
  const r = reward.rarity;
  showModal(`<div class="box-open"><div class="chest shake" id="chest">${box.icon}</div><p class="muted">Opening ${box.name}…</p></div>`);
  const token = (UI.boxToken = (UI.boxToken || 0) + 1);
  setTimeout(() => {
    if (el('modal').hidden || token !== UI.boxToken || !el('chest')) return;   // modal closed or replaced meanwhile
    let body;
    if (reward.kind === 'general') {
      const g = reward.general;
      body = `<div class="portrait r-${r}">${g.icon}</div><div class="rarity r-${r}">${RARITY[r].name} General</div><div class="reward-title r-${r}">${g.name}</div>
        ${reward.dup ? `<p class="small">${reward.max ? `Already at 5★ — converted to 🪙${reward.gold}` : `Duplicate! ${g.name} is now ${'★'.repeat(reward.stars)}`}</p>` : '<p class="small">A new general joins your court!</p>'}
        <div style="max-width:260px;margin:auto;text-align:left">${statBars(generalStats(g.id))}</div>`;
    } else if (reward.kind === 'item') {
      const it = ITEMS[reward.item];
      body = `<div style="font-size:70px">${it.icon}</div><div class="reward-title">${reward.qty}× ${it.name}</div><p class="small muted">${it.desc}</p>`;
    } else {
      body = `<div style="font-size:70px">💰</div><div class="reward-title">Treasure!</div><p style="font-size:18px">${costHtml(reward.bundle)}</p>`;
    }
    el('modal-card').innerHTML = `<div class="box-open r-${r}" style="--r:${RARITY[r].color}"><div class="burst"><div class="reward" id="box-reward">${body}</div></div></div>
      <div class="actions" style="justify-content:center">${btn('Collect', 'close-modal', '', { cls: 'ghost' })}${btn('Open another', 'open-box', box.id, { disabled: !canAfford(box.cost) })}</div>`;
    if (r === 'legendary' || r === 'epic') celebrate();
  }, 1300);
}

// ---------- actions (event delegation) ----------
const ACTIONS = {
  place(t) { if (buildLockReason(t)) { toast(buildLockReason(t), 'bad'); return; } setView('kingdom'); UI.placing = t; UI.selected = null; updatePlacingHint(); },
  'cancel-place'() { UI.placing = null; updatePlacingHint(); },
  select(id) { UI.selected = +id; setTab('info'); setView('kingdom'); },
  deselect() { UI.selected = null; },
  upgrade(id) { upgradeBuilding(S.buildings.find((b) => b.id === +id)); },
  demolish(id) {
    const b = S.buildings.find((x) => x.id === +id);
    showModal(`<h2>Demolish ${BUILDINGS[b.type].name}?</h2><p>You will get 40% of its cost back.</p><div class="actions">${btn('Cancel', 'close-modal', '', { cls: 'ghost' })}${btn('Demolish', 'demolish-yes', id, { cls: 'red' })}</div>`);
  },
  'demolish-yes'(id) { closeModal(); demolish(S.buildings.find((b) => b.id === +id)); },
  train(arg) { const [u, n] = arg.split(':'); const made = trainUnits(u, +n); if (made) toast(`Training ${made} ${UNITS[u].name}${made > 1 ? 's' : ''}`); },
  'cancel-train'(id) { cancelTraining(S.buildings.find((b) => b.id === +id)); },
  trade(arg) {
    const [kind, r] = arg.split(':'), port = S.buildings.filter((b) => b.type === 'port' && b.level > 0).sort((a, b) => b.level - a.level)[0];
    if (!port) return;
    if (kind === 'sell') { if (S.res[r] < 200) return toast(`Need 200 ${RES_META[r].name}`, 'bad'); S.res[r] -= 200; gain({ gold: Math.round(200 * (0.5 + 0.1 * port.level)) }); }
    else { const price = Math.round(100 * (2.2 - 0.15 * port.level)); if (!pay({ gold: price })) return toast('Not enough gold', 'bad'); gain({ [r]: 100 }); }
    UI.panelDirty = true;
  },
  'world-deselect'() { UI.worldSel = null; },
  'world-focus'(kid) { const k = S.kingdoms[+kid]; UI.worldSel = { x: k.cx, y: k.cy }; setView('world'); setTab('info'); },
  claim() { claimTile(UI.worldSel.x, UI.worldSel.y); },
  scout() { const n = +(el('scout-count') ? el('scout-count').value : 1); sendScouts(UI.worldSel.x, UI.worldSel.y, n); },
  'attack-open'(kid) { showAttack(+kid); },
  'attack-launch'(kid) { const d = UI.attackDraft; closeModal(); Battle.start(+kid, d.sent); },
  gift(kid) { const k = S.kingdoms[+kid]; if (!pay({ gold: 200 })) return toast('Not enough gold', 'bad'); k.relation = Math.min(100, k.relation + 8); toast(`${k.ruler} appreciates your gift`, 'good'); UI.panelDirty = true; },
  invite(kid) { inviteKingdom(+kid); },
  kick(kid) { kickMember(+kid); },
  join(id) { joinAlliance(id); },
  leave() { leaveAlliance(); },
  'toggle-open'() { const a = allianceOf(S.allianceId); a.open = !a.open; UI.panelDirty = true; },
  donate(arg) { const [r, v] = arg.split(':'); donate(r, +v); },
  'chat-send'() { const i = el('chat-input'); playerChat(i.value); i.value = ''; i.blur(); renderPanel(true); },
  emblem(e) { UI.allianceDraft.emblem = e; },
  color(c) { UI.allianceDraft.color = c; },
  'create-alliance'() { const d = UI.allianceDraft; d.name = el('alliance-name').value; if (createAlliance(d.name, d.color, d.emblem)) UI.allianceDraft = null; },
  appoint(id) { appointGeneral(id); },
  'use-item'(k) { useItem(k); if (UI.attackDraft && !el('modal').hidden && (k === 'warhorn' || k === 'salve')) showAttack(UI.attackDraft.kid); },
  'open-box'(id) { openBox(id); },
  menu() { showMenu(); },
  'close-modal'() { closeModal(); },
  begin() { S.name = (el('welcome-name').value || 'Ironcrown').trim().slice(0, 24) || 'Ironcrown'; S.started = true; closeModal(); save(); toast(`Long live ${S.name}!`, 'good'); },
  rename() { const v = el('rename-input').value.trim().slice(0, 24); if (v) { S.name = v; save(); toast('Kingdom renamed'); } closeModal(); },
  save() { save(); API.push(true); toast('Game saved', 'good'); },
  export() {
    const data = btoa(unescape(encodeURIComponent(JSON.stringify(S))));
    showModal(`<h2>Export save</h2><p class="small muted">Copy this code somewhere safe.</p><textarea style="width:100%;height:140px;background:#1a1f29;color:#e8e2d0;border-radius:8px" readonly onclick="this.select()">${data}</textarea><div class="actions">${btn('Close', 'close-modal', '', { cls: 'ghost' })}</div>`);
    navigator.clipboard?.writeText(data).then(() => toast('Save code copied to clipboard'), () => {});
  },
  import() { showModal(`<h2>Import save</h2><textarea id="import-data" style="width:100%;height:140px;background:#1a1f29;color:#e8e2d0;border-radius:8px"></textarea><div class="actions">${btn('Cancel', 'close-modal', '', { cls: 'ghost' })}${btn('Import', 'import-yes')}</div>`); },
  'import-yes'() {
    try { const d = JSON.parse(decodeURIComponent(escape(atob(el('import-data').value.trim())))); if (d.version !== VERSION) throw 0; S = d; save(); closeModal(); resetView(); toast('Save imported', 'good'); }
    catch { toast('Invalid save code', 'bad'); }
  },
  reset() { showModal(`<h2>Reset everything?</h2><p>Your kingdom will be lost forever.</p><div class="actions">${btn('Cancel', 'close-modal', '', { cls: 'ghost' })}${btn('Reset', 'reset-yes', '', { cls: 'red' })}</div>`); },
  'reset-yes'() { storage.del(SAVE_KEY); newGame(); resetView(); showWelcome(); },
};

function setView(v) {
  UI.view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'world') { UI.placing = null; updatePlacingHint(); }
  UI.hover = null; el('tooltip').hidden = true;
  UI.panelDirty = true;
}
function setTab(t) {
  UI.tab = t;
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  UI.lastPanelHtml = ''; UI.panelDirty = true;
  el('panel-body').scrollTop = 0;
  if (S) renderPanel(true);
}
function resetView() { UI.selected = null; UI.placing = null; UI.worldSel = null; terrainKey = worldKey = ''; setView('kingdom'); setTab('info'); }
function updatePlacingHint() {
  const h = el('placing-hint');
  h.hidden = !UI.placing;
  if (UI.placing) h.innerHTML = `Placing ${BUILDINGS[UI.placing].icon} ${BUILDINGS[UI.placing].name} — click a tile <button class="btn sm ghost" data-action="cancel-place">Cancel (Esc)</button>`;
  UI.panelDirty = true;
}

function bindInput() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (t && !t.disabled && ACTIONS[t.dataset.action]) { ACTIONS[t.dataset.action](t.dataset.arg); UI.panelDirty = true; renderPanel(true); updateHud(); }
    const tab = e.target.closest('[data-tab]'); if (tab) setTab(tab.dataset.tab);
    const view = e.target.closest('[data-view]'); if (view) { setView(view.dataset.view); renderPanel(true); }
    const bs = e.target.closest('[data-bspeed]');
    if (bs) { Battle.speed = +bs.dataset.bspeed; document.querySelectorAll('[data-bspeed]').forEach((x) => x.classList.toggle('active', x === bs)); }
    if (e.target.id === 'battle-skip') Battle.skip();
    if (e.target.id === 'battle-close') Battle.close();
    if (e.target === el('modal') && S.started) closeModal();
  });
  el('panel').addEventListener('pointerdown', () => { UI.pointerDown = true; });
  window.addEventListener('pointerup', () => { setTimeout(() => { UI.pointerDown = false; }, 0); });
  document.addEventListener('input', (e) => { if (e.target.dataset.send) updateAttackDraft(); if (e.target.id === 'alliance-name' && UI.allianceDraft) UI.allianceDraft.name = e.target.value; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!el('modal').hidden && S.started) closeModal(); else if (UI.placing) ACTIONS['cancel-place'](); else { UI.selected = null; UI.worldSel = null; } UI.panelDirty = true; }
    if (e.key === 'Enter' && e.target.id === 'chat-input') ACTIONS['chat-send']();
    if (e.key === 'Enter' && e.target.id === 'welcome-name') ACTIONS.begin();
  });

  let dragging = false, lastPlaced = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (UI.view === 'kingdom') {
      const t = screenToTile(p.x, p.y);
      UI.hover = t;
      if (dragging && UI.placing === 'wall' && (!lastPlaced || lastPlaced.x !== t.x || lastPlaced.y !== t.y) && !placementError('wall', t.x, t.y) && !buildLockReason('wall')) { placeBuilding('wall', t.x, t.y); lastPlaced = t; }
      const b = buildingAt(t.x, t.y);
      showTip(p, b && !UI.placing ? `<b>${BUILDINGS[b.type].name}</b> · level ${b.level}${b.build > 0 ? `<br>🔨 ${fmtTime(b.build)}` : ''}` : null);
    } else {
      const t = screenToWorld(p.x, p.y);
      UI.hover = t;
      if (!inWorld(t.x, t.y)) return showTip(p, null);
      const i = widx(t.x, t.y), o = S.world.owner[i];
      showTip(p, isSeen(t.x, t.y) ? `<b>${TERRAIN[S.world.tiles[i]].name}</b>${o === -2 ? '<br>Your territory' : o >= 0 ? '<br>' + S.kingdoms[o].name : ''}` : '<b>Unexplored</b><br>Send scouts to reveal');
    }
  });
  cv.addEventListener('pointerleave', () => { UI.hover = null; el('tooltip').hidden = true; });
  cv.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    const p = pos(e);
    if (UI.view === 'kingdom') {
      const t = screenToTile(p.x, p.y);
      if (UI.placing) {
        const type = UI.placing;
        if (placeBuilding(type, t.x, t.y)) {
          if (type === 'wall') { dragging = true; lastPlaced = t; }
          if (type !== 'wall' || buildLockReason('wall')) { UI.placing = null; updatePlacingHint(); }
        }
      } else {
        const b = buildingAt(t.x, t.y);
        UI.selected = b ? b.id : null;
        if (b) setTab('info');
      }
    } else {
      const t = screenToWorld(p.x, p.y);
      if (inWorld(t.x, t.y)) { UI.worldSel = t; setTab('info'); }
    }
    renderPanel(true);
  });
  window.addEventListener('pointerup', () => { dragging = false; lastPlaced = null; });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); if (UI.placing) ACTIONS['cancel-place'](); });
  new ResizeObserver(resize).observe(el('stage-wrap'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('beforeunload', save);
}
function showTip(p, html) {
  const tip = el('tooltip');
  if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html; tip.hidden = false;
  tip.style.left = Math.min(p.x + 14, CW - 200) + 'px'; tip.style.top = p.y + 14 + 'px';
}

/* ======================== 11. MAIN LOOP & BOOT =========================== */

let lastFrame = performance.now(), hudTimer = 0, panelTimer = 0, saveTimer = 0;
function frame(now) {
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (dt > 1.5) { let t = Math.min(dt, OFFLINE_CAP); while (t > 0) { const d = Math.min(2, t); step(d, true); t -= d; } dt = 0; }  // tab was in background
  dt = Math.min(dt, 0.25);
  step(dt);
  if (Battle.b) Battle.frame(dt);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const t = now / 1000;
  if (cam.shake > 0) { ctx.translate(rand(-cam.shake, cam.shake), rand(-cam.shake, cam.shake)); cam.shake *= 0.85; if (cam.shake < 0.3) cam.shake = 0; }
  if (UI.view === 'kingdom') drawKingdom(ctx, t, dt); else drawWorld(ctx, t, dt);
  hudTimer -= dt; panelTimer -= dt; saveTimer -= dt;
  if (hudTimer <= 0) { updateHud(); hudTimer = 0.1; }
  if (panelTimer <= 0 || (UI.panelDirty && panelTimer < 0.75)) { renderPanel(); panelTimer = 1; }
  if (saveTimer <= 0) { save(); saveTimer = 15; }
  requestAnimationFrame(frame);
}

async function boot() {
  cv = el('stage'); ctx = cv.getContext('2d');
  buildHud();
  const fresh = params.get('reset') === '1';
  if (fresh) {
    storage.del(SAVE_KEY);
    params.delete('reset');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  }
  await API.init();
  let loaded = load();
  if (API.online) {
    el('sync').classList.add('online'); el('sync-label').textContent = 'synced';
    const remote = fresh ? null : await API.pull();
    if (remote && remote.version === VERSION && (!loaded || remote.savedAt > S.savedAt)) { S = remote; loaded = true; }
  }
  if (loaded) catchUp(); else newGame();
  resize();
  bindInput();
  setTab('info');
  updateHud();
  if (!S.started) showWelcome();
  requestAnimationFrame(frame);
  document.body.dataset.ready = '1';
}

// Hooks used by the Playwright test-suite (tests/e2e.mjs) and handy from the console.
window.ironcrown = {
  get state() { return S; }, UI, Battle, BUILDINGS, UNITS, GENERALS,
  api: { placeBuilding, upgradeBuilding, trainUnits, openBox, sendScouts, claimTile, createAlliance, joinAlliance, donate, useItem, appointGeneral, save, load },
  debug: {
    fastForward(sec) { let t = sec; while (t > 0) { const d = Math.min(1, t); step(d, true); t -= d; } UI.panelDirty = true; renderPanel(true); updateHud(); },
    give(res) { for (const [k, v] of Object.entries(res)) S.res[k] += v; UI.panelDirty = true; updateHud(); },
    tileToClient(x, y) { const r = cv.getBoundingClientRect(), p = tileToScreen(x + 0.5, y + 0.5); return { x: r.left + p.x, y: r.top + p.y }; },
    worldToClient(x, y) { const r = cv.getBoundingClientRect(), p = worldToScreen(x + 0.5, y + 0.5); return { x: r.left + p.x, y: r.top + p.y }; },
    freeTile(type) { for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if (!placementError(type, x, y)) return { x, y }; return null; },
    revealAll() { S.world.seen.fill(1); UI.panelDirty = true; },
    rates, totalPower, armyPower, hallLevel, territoryBonus, kingdomTiles,
  },
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
