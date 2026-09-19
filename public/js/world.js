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
  S.world = { terrain, owner: new Array(N).fill(-1), seen: new Array(N).fill(0), feat: {}, capital: -1, harbor: -1 };
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

function claimCost() {
  const n = Math.max(0, playerTiles() - 7);
  return { gold: Math.round(150 * Math.pow(1.14, n) / 5) * 5, food: Math.round(80 * Math.pow(1.1, n) / 5) * 5 };
}
function nearOutpost(i) {
  const { feat, owner } = S.world;
  return Object.keys(feat).some((k) => feat[k].type === 'fort' && feat[k].captured && owner[k] === -2 && WG.dist(+k, i) <= 2);
}
function claimError(i, viaDivision) {
  const { terrain, owner } = S.world;
  if (!isSeen(i)) return 'Scout this land first';
  if (terrain[i] === T.WATER) return 'You cannot claim the open sea';
  if (terrain[i] === T.MOUNTAIN) return 'Mountains cannot be settled';
  if (owner[i] === -2) return 'Already yours';
  if (owner[i] >= 0) return `Owned by ${S.kingdoms[owner[i]].name} — send a division to conquer it`;
  if (playerTiles() >= territoryLimit()) return `Territory limit (${territoryLimit()}) — upgrade the Main Hall or research Administration`;
  const f = S.world.feat[i];
  if (f && f.type === 'fort' && !f.captured) return 'Capture the fort with a division';
  if (f && f.type === 'ruins' && !f.looted) return 'Explore the ruins with a division first';
  const adjacent = WG.neighbors(i).some((n) => owner[n] === -2) || nearOutpost(i);
  if (!adjacent && !viaDivision) return 'Must border your territory — or march a division here and claim from there';
  if (!canAfford(claimCost())) return 'Not enough resources';
  return null;
}
function claimTile(i, viaDivision) {
  const err = claimError(i, viaDivision);
  if (err) { toast(err, 'bad'); return false; }
  pay(claimCost());
  S.world.owner[i] = -2;
  reveal(i, 1);
  const t = TERRAIN[S.world.terrain[i]];
  log(`Claimed ${t.name} (${WG.col(i)},${WG.row(i)}).`, 'good');
  toast(`🏳️ ${t.name} claimed!`, 'good');
  worldVersion++;
  UI.panelDirty = true;
  return true;
}

/* ---- Scouting ---- */
function scoutTime(i, n) { return Math.round(3 + WG.dist(S.world.capital, i) * 1.1 / (UNITS.scout.speed / 2.4) / (1 + 0.05 * n)); }
function sendScouts(i, n) {
  n = Math.min(n, S.army.scout);
  if (n < 1) { toast('No scouts at home — train some at the Scout Lodge', 'bad'); return false; }
  const total = scoutTime(i, n);
  S.army.scout -= n;
  S.missions.push({ id: uid(), hex: i, n, left: total, total });
  toast(`🔭 ${n} scout${n > 1 ? 's' : ''} dispatched (${fmtTime(total)})`);
  UI.panelDirty = true;
  return true;
}
function gatherIntel(k) {
  S.intel[k.id] = { t: S.time, power: Math.round(k.power), defense: Math.round(k.defense), navy: Math.round(k.navy), hall: k.hall, res: { ...k.res }, tiles: kingdomTiles(k.id) };
}
function completeScout(m) {
  const lodge = S.buildings.find((b) => b.type === 'scoutlodge' && b.level > 0);
  const r = Math.min(7, 2 + (lodge ? lodge.level : 0) + visionBonus() + Math.floor(m.n / 3));
  const newly = reveal(m.hex, r);
  const ownerId = S.world.owner[m.hex];
  let lost = 0;
  if (ownerId >= 0) {
    const k = S.kingdoms[ownerId];
    const p = clamp(k.defense / (k.defense + 500), 0.05, 0.45) * (1 - 0.25 * R('espionage'));
    for (let i = 0; i < m.n; i++) if (Math.random() < p) lost++;
  }
  S.army.scout += m.n - lost;
  S.stats.scouted++;
  const f = S.world.feat[m.hex];
  if (f && f.type === 'cave' && !f.explored) { f.explored = true; log(`Scouts found ${MINERALS[f.mineral].name} in a cave!`, 'good'); }
  const reports = [];
  for (const k of S.kingdoms) if (WG.dist(k.capital, m.hex) <= r + 1 || ownerId === k.id) { gatherIntel(k); reports.push(k.name); }
  const msg = `Scouts returned from (${WG.col(m.hex)},${WG.row(m.hex)}): ${newly} hexes revealed` + (reports.length ? `, intel on ${reports.join(', ')}` : '') + (lost ? `. ${lost} scout${lost > 1 ? 's were' : ' was'} captured.` : '.');
  log(msg, lost ? 'bad' : 'good');
  toast('🔭 ' + msg, lost ? 'bad' : 'good');
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
