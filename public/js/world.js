/* ==========================================================================
   World: hex terrain generation, features, territory, claiming, scouting.
   owner[] codes: -1 neutral, -2 player, 0..n AI kingdom index.
   ========================================================================== */
'use strict';

let WDEPTH = new Int16Array(WG.N);   // water: hexes to nearest land
let OCEAN = new Uint8Array(WG.N);    // water connected to the map edge

const isWater = (i) => S.world.terrain[i] === T.WATER;
const isPassable = (i) => i >= 0 && isFinite(TERRAIN[S.world.terrain[i]].cost);

function deriveWorld() {
  WDEPTH = WG.distanceField((i) => S.world.terrain[i] !== T.WATER, 8);
  OCEAN = new Uint8Array(WG.N);
  const q = [];
  for (let i = 0; i < WG.N; i++) {
    const c = WG.col(i), r = WG.row(i);
    if (isWater(i) && (c === 0 || r === 0 || c === WW - 1 || r === WH - 1)) { OCEAN[i] = 1; q.push(i); }
  }
  for (let h = 0; h < q.length; h++) for (const n of WG.neighbors(q[h])) if (!OCEAN[n] && isWater(n)) { OCEAN[n] = 1; q.push(n); }
  S.world.seenSet = null;
  worldVersion++;
}
let worldVersion = 0;

function generateWorld() {
  const seed = S.seed, rng = mulberry32(seed ^ 0x5eed);
  const N = WG.N, elev = new Float32Array(N), moist = new Float32Array(N), ridge = new Float32Array(N);
  const islands = Array.from({ length: 4 }, (_, k) => ({ c: WW - 5 - rng() * 5, r: 4 + k * 8.5 + rng() * 3, s: 1.6 + rng() * 1.4 }));
  for (let i = 0; i < N; i++) {
    const c = WG.col(i), r = WG.row(i), nx = c / WW, ny = r / WH;
    const dx = (nx - 0.42) / 0.5, dy = (ny - 0.5) / 0.5;
    let e = fbm(c * 0.1, r * 0.12, seed, 5) * 0.8 + fbm(c * 0.035, r * 0.045, seed + 99, 3) * 0.55 - Math.sqrt(dx * dx + dy * dy) * 0.62;
    for (const is of islands) e += 0.55 * Math.exp(-((dist(c, r, is.c, is.r) / is.s) ** 2));
    const edge = Math.min(c, r, WW - 1 - c, WH - 1 - r);
    if (edge < 2) e -= (2 - edge) * 0.25;
    elev[i] = e;
    moist[i] = fbm(c * 0.09 + 40, r * 0.1 - 13, seed + 5, 4);
    ridge[i] = 1 - Math.abs(2 * fbm(c * 0.11 - 7, r * 0.13 + 3, seed + 31, 3) - 1);
  }
  const sorted = Array.from(elev).sort((a, b) => a - b);
  const sea = sorted[Math.floor(N * 0.47)], top = sorted[N - 1];
  const terrain = new Array(N);
  for (let i = 0; i < N; i++) {
    const h = (elev[i] - sea) / (top - sea), m = moist[i], rw = WG.row(i);
    let t;
    if (h < 0) t = T.WATER;
    else if ((h > 0.55 && ridge[i] > 0.74) || h > 0.86) t = T.MOUNTAIN;
    else if (h > 0.42 && ridge[i] > 0.6) t = T.HILLS;
    else if (h < 0.1 && m > 0.6) t = T.SWAMP;
    else if (m < 0.38 && rw > WH * 0.5) t = T.DESERT;
    else if (m > 0.55) t = T.FOREST;
    else if (m > 0.47) t = T.MEADOW;
    else t = T.PLAINS;
    terrain[i] = t;
  }
  S.world = { terrain, owner: new Array(N).fill(-1), seen: new Array(N).fill(0), feat: {}, bld: {}, capital: -1, harbor: -1 };
  deriveWorld();

  // --- Player capital: coastal, roomy, western half ---
  let best = -1, bestScore = -1e9;
  for (let i = 0; i < N; i++) {
    const c = WG.col(i), r = WG.row(i);
    if (!isPassable(i) || c < 6 || c > WW * 0.5 || r < 6 || r > WH - 7) continue;
    const ocean = WG.neighbors(i).filter((n) => OCEAN[n]);
    if (!ocean.length) continue;
    const room = WG.within(i, 3).filter(isPassable).length;
    const score = room + hash2(i, 1, seed) * 3 - Math.abs(r - WH / 2) * 0.3;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) best = WG.idx(12, Math.floor(WH / 2));
  const cap = best;
  S.world.capital = cap;
  S.world.terrain[cap] = T.PLAINS;
  WG.neighbors(cap).forEach((n) => { if (terrain[n] === T.MOUNTAIN || terrain[n] === T.SWAMP) terrain[n] = T.MEADOW; });
  S.world.harbor = WG.neighbors(cap).filter((n) => OCEAN[n]).sort((a, b) => WDEPTH[b] - WDEPTH[a])[0];
  deriveWorld();

  // Mainland = land reachable on foot from the capital.
  const main = new Uint8Array(N), q = [cap];
  main[cap] = 1;
  for (let h = 0; h < q.length; h++) for (const n of WG.neighbors(q[h])) if (!main[n] && isPassable(n)) { main[n] = 1; q.push(n); }

  // --- AI kingdoms ---
  const caps = [];
  for (let pass = 0; pass < 3 && caps.length < 6; pass++) {
    const minP = [9, 7, 5][pass], minK = [7, 6, 4][pass];
    for (let tries = 0; tries < 3000 && caps.length < 6; tries++) {
      const i = Math.floor(rng() * N);
      if (!main[i] || terrain[i] === T.SWAMP || WG.dist(i, cap) < minP || caps.some((k) => WG.dist(k, i) < minK)) continue;
      const c = WG.col(i), r = WG.row(i);
      if (c < 2 || r < 2 || c > WW - 3 || r > WH - 3) continue;
      caps.push(i);
    }
  }
  const pers = Object.keys(PERSONALITIES);
  S.kingdoms = caps.map((ci, k) => {
    const hall = 1 + (k % 3);
    terrain[ci] = terrain[ci] === T.DESERT ? T.DESERT : T.PLAINS;
    const coastal = WG.neighbors(ci).some((n) => OCEAN[n]);
    const kd = { id: k, name: KINGDOM_NAMES[k], ruler: RULERS[k], color: KINGDOM_COLORS[k], capital: ci, hall,
      power: Math.round(140 + hall * 120 + rng() * 90), defense: Math.round(40 * hall + rng() * 40), navy: coastal ? Math.round(80 + rng() * 100 * hall) : 0,
      res: { gold: 800 * hall, iron: 300 * hall, lumber: 700 * hall, food: 600 * hall, diamonds: 10 * hall },
      personality: pers[k % pers.length], relation: Math.round(rng() * 50 - 22), allianceId: null, defeats: 0,
      coastal, treaty: 0, tradePact: false, atWar: false };
    claimAround(ci, k);
    return kd;
  });
  claimAround(cap, -2);

  // --- Features ---
  const feat = S.world.feat, free = (i) => !feat[i] && S.world.owner[i] === -1;
  const farFromCapitals = (i, d) => WG.dist(i, cap) >= d && caps.every((c) => WG.dist(c, i) >= d);
  const land = [], water = [];
  for (let i = 0; i < N; i++) (isWater(i) ? water : land).push(i);
  const place = (list, n, test, make) => {
    let placed = 0;
    for (let tries = 0; tries < 4000 && placed < n; tries++) {
      const i = list[Math.floor(rng() * list.length)];
      if (free(i) && test(i)) { feat[i] = make(i); placed++; }
    }
  };
  const tierOf = (i) => clamp(Math.ceil(WG.dist(i, cap) / 9), 1, 3);
  place(land, Math.round(land.length * 0.025), (i) => [T.HILLS, T.DESERT, T.PLAINS].includes(terrain[i]), () => ({ type: 'goldvein' }));
  place(land, 12, (i) => isPassable(i) && (terrain[i] === T.HILLS || WG.neighbors(i).some((n) => terrain[n] === T.MOUNTAIN)) && farFromCapitals(i, 2),
    () => ({ type: 'cave', mineral: weighted({ iron: 5, gold: 3, gems: 2 }), explored: false }));
  // Island gem caves & pirate coves
  const islandLand = land.filter((i) => !main[i] && isPassable(i));
  place(islandLand, 3, () => true, () => ({ type: 'cave', mineral: 'gems', explored: false }));
  place(islandLand, 2, (i) => WG.neighbors(i).some((n) => OCEAN[n]), () => ({ type: 'cove', power: Math.round(380 + rng() * 260), destroyed: false }));
  place(land, 12, (i) => isPassable(i) && farFromCapitals(i, 3), (i) => { const t = tierOf(i); return { type: 'ruins', tier: t, guard: Math.round(50 * t ** 1.7 + rng() * 40), looted: false }; });
  place(land, 4, (i) => isPassable(i) && farFromCapitals(i, 4) && main[i], (i) => { const t = tierOf(i); return { type: 'fort', tier: t, guard: Math.round(160 + 140 * t + rng() * 60), captured: false }; });
  place(water, 10, (i) => OCEAN[i] && WDEPTH[i] >= 1 && WG.dist(i, cap) >= 3, (i) => ({ type: 'wreck', tier: tierOf(i), salvaged: false }));
  reveal(cap, 3);
  deriveWorld();
}

function claimAround(i, who) {
  const { owner } = S.world;
  owner[i] = who;
  for (const n of WG.neighbors(i)) if (isPassable(n) && owner[n] === -1) owner[n] = who;
}
function reveal(i, r) {
  let n = 0;
  for (const j of WG.within(i, r)) if (!S.world.seen[j]) { S.world.seen[j] = 1; n++; }
  if (n) { UI.panelDirty = true; fogDirty = true; }
  return n;
}
let fogDirty = true;
const isSeen = (i) => i >= 0 && S.world.seen[i] === 1;
const playerTiles = () => S.world.owner.reduce((s, o) => s + (o === -2 ? 1 : 0), 0);
const kingdomTiles = (id) => S.world.owner.reduce((s, o) => s + (o === id ? 1 : 0), 0);
const visionBonus = () => R('cartography');

function distToTerritory(i) {
  let best = 99;
  const { owner } = S.world;
  for (let j = 0; j < owner.length; j++) if (owner[j] === -2) { const d = WG.dist(i, j); if (d < best) best = d; }
  return best;
}
// Claim any explored land anywhere; the further from your borders, the pricier.
function claimCost(i) {
  const n = Math.max(0, playerTiles() - 7), far = i != null ? Math.max(0, distToTerritory(i) - 1) : 0;
  const m = 1 + 0.2 * far;
  return { gold: Math.round((150 * Math.pow(1.14, n) * m) / 5) * 5, food: Math.round((80 * Math.pow(1.1, n) * m) / 5) * 5 };
}
function claimError(i) {
  const { terrain, owner } = S.world;
  if (!isSeen(i)) return 'Explore this land first (scouts, fleets or divisions)';
  if (terrain[i] === T.WATER) return 'You cannot claim the open sea';
  if (terrain[i] === T.MOUNTAIN) return 'Mountains cannot be settled';
  if (owner[i] === -2) return 'Already yours';
  if (owner[i] >= 0) return `Owned by ${S.kingdoms[owner[i]].name} — send a division to conquer it`;
  if (playerTiles() >= territoryLimit()) return `Territory limit (${territoryLimit()}) — upgrade the Main Hall or research Administration`;
  const f = S.world.feat[i];
  if (f && f.type === 'fort' && !f.captured) return 'Capture the fort with a division';
  if (f && f.type === 'ruins' && !f.looted) return 'Explore the ruins with a division first';
  if (f && f.type === 'cove' && !f.destroyed) return 'Destroy the pirate cove first';
  if (!canAfford(claimCost(i))) return 'Not enough resources';
  return null;
}
function claimTile(i) {
  const err = claimError(i);
  if (err) { toast(err, 'bad'); return false; }
  pay(claimCost(i));
  S.world.owner[i] = -2;
  reveal(i, 1);
  const t = TERRAIN[S.world.terrain[i]];
  log(`Claimed ${t.name} (${WG.col(i)},${WG.row(i)}).`, 'good');
  toast(`🏳️ ${t.name} claimed!`, 'good');
  worldVersion++;
  UI.panelDirty = true;
  return true;
}

/* ---- Scouting: scout parties are units you move on the map ----
   Every hex they pass through (and a radius around it) is revealed. */
const scoutRadius = () => { const lodge = S.buildings.find((b) => b.type === 'scoutlodge' && b.level > 0); return 2 + Math.floor((lodge ? lodge.level : 0) / 2) + visionBonus(); };
const scoutCost = (i) => { const t = S.world.terrain[i]; return t === T.WATER ? (transportCapacity() > 0 ? 1.2 : Infinity) : t === T.MOUNTAIN ? 3 : TERRAIN[t].cost; };
function dispatchScouts(n, dest) {
  n = Math.min(n, S.army.scout);
  if (n < 1) { toast('No scouts at home — train some at the Scout Lodge', 'bad'); return null; }
  S.army.scout -= n;
  const p = { id: 's' + uid(), kind: 'scout', name: `Scouts ×${n}`, n, at: S.world.capital, path: [], prog: 0, order: null, status: 'idle' };
  S.scouts.push(p);
  if (dest != null && dest >= 0) giveOrder(p, 'move', dest);
  UI.panelDirty = true;
  return p;
}
function scoutEnter(p) {
  reveal(p.at, scoutRadius());
  const f = S.world.feat[p.at];
  if (f && f.type === 'cave' && !f.explored) { f.explored = true; log(`Scouts found ${MINERALS[f.mineral].name} in a cave!`, 'good'); toast(`🕳️ Scouts found ${MINERALS[f.mineral].name}`, 'good'); }
  for (const k of S.kingdoms) if (WG.dist(k.capital, p.at) <= scoutRadius() + 1) { if (!S.intel[k.id] || S.time - S.intel[k.id].t > 60) log(`Scouts gathered intel on ${k.name}.`, 'info'); gatherIntel(k); }
  const o = S.world.owner[p.at];
  if (o >= 0 && Math.random() < 0.04 * (hostileToPlayer(S.kingdoms[o]) ? 2 : 1) * (1 - 0.25 * R('espionage'))) {
    p.n--; p.name = `Scouts ×${p.n}`;
    log(`A scout was captured by ${S.kingdoms[o].name}.`, 'bad');
    if (p.n <= 0) { S.scouts = S.scouts.filter((x) => x !== p); if (UI.selEntity && UI.selEntity.id === p.id) UI.selEntity = null; toast('🔭 Your scout party was captured', 'bad'); }
  }
  S.stats.scouted++;
}
function scoutArrive(p) {
  p.status = 'idle';
  if (p.at === S.world.capital && p.order && p.order.type === 'return') {
    S.army.scout += p.n; S.scouts = S.scouts.filter((x) => x !== p);
    if (UI.selEntity && UI.selEntity.id === p.id) UI.selEntity = null;
    toast('🔭 Scouts returned home');
  }
}
function gatherIntel(k) {
  S.intel[k.id] = { t: S.time, power: Math.round(k.power), defense: Math.round(k.defense), navy: Math.round(k.navy), hall: k.hall, res: { ...k.res }, tiles: kingdomTiles(k.id) };
}
function transferBorderTile(fromId, toId) {
  const { owner } = S.world;
  const home = fromId === -2 ? S.world.capital : S.kingdoms[fromId] && S.kingdoms[fromId].capital;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== fromId || i === home) continue;
    if (WG.neighbors(i).some((n) => owner[n] === toId)) { owner[i] = toId; worldVersion++; return i; }
  }
  return -1;
}

/* ---- Buildings on territory hexes ---- */
const tbAt = (i) => S.world.bld[i];
const tbCost = (type, lvl) => scaleCost(TERRITORY_BUILDINGS[type].cost, Math.pow(1.9, lvl - 1));
const tbTime = (type, lvl) => Math.round(TERRITORY_BUILDINGS[type].time * Math.pow(lvl, 1.4) * (1 - 0.12 * R('architecture')));
const hexCoastal = (i) => WG.neighbors(i).some((n) => OCEAN[n]);
function tbAllowed(type, i) {
  const t = S.world.terrain[i];
  return TERRITORY_BUILDINGS[type].on(t, S.world.feat[i], hexCoastal(i));
}
function tbError(type, i, upgrade) {
  if (S.world.owner[i] !== -2) return 'You must own this hex';
  if (i === S.world.capital) return 'Build in your capital from the Kingdom view';
  const cur = tbAt(i);
  if (!upgrade && cur) return 'This hex already has a building';
  if (upgrade && (!cur || cur.level >= TB_MAX)) return 'Max level';
  if (cur && cur.build > 0) return 'Under construction';
  if (!upgrade && !tbAllowed(type, i)) return `Can't build a ${TERRITORY_BUILDINGS[type].name} on ${TERRAIN[S.world.terrain[i]].name}`;
  if (!canAfford(tbCost(type, upgrade ? cur.level + 1 : 1))) return 'Not enough resources';
  return null;
}
function buildTerritory(type, i) {
  const upgrade = !!tbAt(i);
  if (upgrade) type = tbAt(i).type;
  const err = tbError(type, i, upgrade);
  if (err) { toast(err, 'bad'); return false; }
  const lvl = upgrade ? tbAt(i).level + 1 : 1;
  pay(tbCost(type, lvl));
  const t = tbTime(type, lvl);
  if (upgrade) Object.assign(tbAt(i), { build: t, total: t });
  else S.world.bld[i] = { type, level: 0, build: t, total: t };
  toast(`${TERRITORY_BUILDINGS[type].icon} ${TERRITORY_BUILDINGS[type].name} ${upgrade ? 'upgrading' : 'under construction'} at ${hexName(i)}`, 'good');
  UI.panelDirty = true;
  return true;
}
function stepTerritory(dt) {
  for (const [k, b] of Object.entries(S.world.bld)) {
    const i = +k;
    if (S.world.owner[i] !== -2) { delete S.world.bld[k]; continue; }   // lost the hex → building gone
    if (b.build > 0) {
      b.build -= dt;
      if (b.build <= 0) {
        b.build = 0; b.level++;
        const d = TERRITORY_BUILDINGS[b.type];
        log(`${d.name} ${b.level === 1 ? 'built' : 'upgraded to level ' + b.level} at ${hexName(i)}.`, 'good');
        if (d.vision) reveal(i, d.vision + b.level - 1);
        UI.panelDirty = true;
      }
    }
  }
}
function tbProduction(i) {
  const b = tbAt(i);
  if (!b || b.level < 1) return null;
  const d = TERRITORY_BUILDINGS[b.type], out = {};
  if (d.prod) for (const [k, v] of Object.entries(d.prod)) out[k] = v * b.level;
  const f = S.world.feat[i];
  if (b.type === 'mine' && f) {   // mines triple the special deposit instead of plain iron
    delete out.iron;
    if (f.type === 'goldvein') out.gold = 0.6 * 2 * b.level;
    if (f.type === 'cave' && f.explored) for (const [k, v] of Object.entries(MINERALS[f.mineral].bonus)) out[k] = v * 2 * b.level;
  }
  return out;
}
function dockAt(water) {
  for (const n of WG.neighbors(water)) { const b = S.world.bld[n]; if (b && b.type === 'dock' && b.level > 0 && S.world.owner[n] === -2) return n; }
  return -1;
}
const stationedAt = (i) => S.divisions.filter((d) => d.at === i && !d.path.length && d.status !== 'fighting');
function hexDefense(i) {
  const b = tbAt(i), d = b && b.level > 0 ? TERRITORY_BUILDINGS[b.type].def || 0 : 0;
  return d * (b ? b.level : 0) + stationedAt(i).reduce((s, x) => s + armyPower(x.units, x.general), 0) + (i === S.world.capital ? defenseRating() + armyPower(S.army, S.castellan) : 0);
}
const isDefended = (i) => hexDefense(i) > 0;
