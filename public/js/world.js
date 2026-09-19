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
  const SX = 50 / WW, SY = 36 / WH;   // sample noise in the old 50×36 units → same continents, finer hexes
  const islands = Array.from({ length: 4 }, (_, k) => ({ c: 50 - 5 - rng() * 5, r: 4 + k * 8.5 + rng() * 3, s: 1.6 + rng() * 1.4 }));
  for (let i = 0; i < N; i++) {
    const c = WG.col(i) * SX, r = WG.row(i) * SY, nx = c / 50, ny = r / 36;
    const dx = (nx - 0.42) / 0.5, dy = (ny - 0.5) / 0.5;
    let e = fbm(c * 0.1, r * 0.12, seed, 5) * 0.8 + fbm(c * 0.035, r * 0.045, seed + 99, 3) * 0.55 - Math.sqrt(dx * dx + dy * dy) * 0.62;
    for (const is of islands) e += 0.55 * Math.exp(-((dist(c, r, is.c, is.r) / is.s) ** 2));
    const edge = Math.min(c, r, 50 - 1 - c, 36 - 1 - r);
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
    else if (m < 0.38 && rw * SY > 18) t = T.DESERT;
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
    if (!isPassable(i) || c < 18 || c > WW * 0.5 || r < 18 || r > WH - 20) continue;
    const ocean = WG.neighbors(i).filter((n) => OCEAN[n]);
    if (!ocean.length || hash2(i, 3, seed) > 0.35) continue;   // sample a subset of the coast
    const room = WG.within(i, 7).filter(isPassable).length;
    const score = room + hash2(i, 1, seed) * 8 - Math.abs(r - WH / 2) * 0.35;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) best = WG.idx(36, Math.floor(WH / 2));
  const cap = best;
  S.world.capital = cap;
  S.world.terrain[cap] = T.PLAINS;
  // a buildable heartland: no mountains/swamp right next to the capital
  for (const n of WG.within(cap, 3)) if (terrain[n] === T.MOUNTAIN || (terrain[n] === T.SWAMP && WG.dist(n, cap) < 2)) terrain[n] = T.MEADOW;
  S.world.harbor = WG.neighbors(cap).filter((n) => OCEAN[n]).sort((a, b) => WDEPTH[b] - WDEPTH[a])[0];
  deriveWorld();

  // Mainland = land reachable on foot from the capital.
  const main = new Uint8Array(N), q = [cap];
  main[cap] = 1;
  for (let h = 0; h < q.length; h++) for (const n of WG.neighbors(q[h])) if (!main[n] && isPassable(n)) { main[n] = 1; q.push(n); }

  // --- AI kingdoms ---
  const caps = [];
  for (let pass = 0; pass < 3 && caps.length < 6; pass++) {
    const minP = [27, 21, 15][pass], minK = [21, 18, 12][pass];
    for (let tries = 0; tries < 6000 && caps.length < 6; tries++) {
      const i = Math.floor(rng() * N);
      if (!main[i] || terrain[i] === T.SWAMP || WG.dist(i, cap) < minP || caps.some((k) => WG.dist(k, i) < minK)) continue;
      const c = WG.col(i), r = WG.row(i);
      if (c < 6 || r < 6 || c > WW - 7 || r > WH - 7) continue;
      caps.push(i);
    }
  }
  const pers = Object.keys(PERSONALITIES);
  S.kingdoms = caps.map((ci, k) => {
    const hall = 1 + (k % 3);
    terrain[ci] = terrain[ci] === T.DESERT ? T.DESERT : T.PLAINS;
    for (const n of WG.within(ci, 2)) if (terrain[n] === T.MOUNTAIN) terrain[n] = T.PLAINS;
    const coastal = WG.neighbors(ci).some((n) => OCEAN[n]);
    const kd = { id: k, name: KINGDOM_NAMES[k], ruler: RULERS[k], color: KINGDOM_COLORS[k], capital: ci, hall,
      power: Math.round(140 + hall * 120 + rng() * 90), defense: Math.round(40 * hall + rng() * 40), navy: coastal ? Math.round(80 + rng() * 100 * hall) : 0,
      res: { gold: 800 * hall, iron: 300 * hall, lumber: 700 * hall, food: 600 * hall, diamonds: 10 * hall },
      personality: pers[k % pers.length], relation: Math.round(rng() * 50 - 22), allianceId: null, defeats: 0,
      coastal, treaty: 0, tradePact: false, atWar: false };
    claimAround(ci, k, 3 + hall);
    return kd;
  });
  claimAround(cap, -2, 4);

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
  const tierOf = (i) => clamp(Math.ceil(WG.dist(i, cap) / 27), 1, 3);
  place(land, Math.round(land.length * 0.004), (i) => [T.HILLS, T.DESERT, T.PLAINS].includes(terrain[i]), () => ({ type: 'goldvein' }));
  place(land, 20, (i) => isPassable(i) && (terrain[i] === T.HILLS || WG.neighbors(i).some((n) => terrain[n] === T.MOUNTAIN)) && farFromCapitals(i, 8),
    () => ({ type: 'cave', mineral: weighted({ iron: 5, gold: 3, gems: 2 }), explored: false }));
  // Island gem caves & pirate coves
  const islandLand = land.filter((i) => !main[i] && isPassable(i));
  place(islandLand, 3, () => true, () => ({ type: 'cave', mineral: 'gems', explored: false }));
  place(islandLand, 2, (i) => WG.neighbors(i).some((n) => OCEAN[n]), () => ({ type: 'cove', power: Math.round(380 + rng() * 260), destroyed: false }));
  place(land, 14, (i) => isPassable(i) && farFromCapitals(i, 9), (i) => { const t = tierOf(i); return { type: 'ruins', tier: t, guard: Math.round(50 * t ** 1.7 + rng() * 40), looted: false }; });
  place(land, 5, (i) => isPassable(i) && farFromCapitals(i, 12) && main[i], (i) => { const t = tierOf(i); return { type: 'fort', tier: t, guard: Math.round(160 + 140 * t + rng() * 60), captured: false }; });
  place(water, 14, (i) => OCEAN[i] && WDEPTH[i] >= 2 && WG.dist(i, cap) >= 9, (i) => ({ type: 'wreck', tier: tierOf(i), salvaged: false }));
  reveal(cap, 10);
  deriveWorld();
}

function claimAround(i, who, r = 1) {
  const { owner } = S.world;
  owner[i] = who;
  for (const n of WG.within(i, r)) if (isPassable(n) && owner[n] === -1) owner[n] = who;
}
function reveal(i, r) {
  let n = 0;
  for (const j of WG.within(i, r)) if (!S.world.seen[j]) { S.world.seen[j] = 1; n++; }
  if (n) { UI.panelDirty = true; fogDirty = true; seenCount += n; }
  return n;
}
let fogDirty = true, seenCount = 0;
const isSeen = (i) => i >= 0 && S.world.seen[i] === 1;
const playerTiles = () => S.world.owner.reduce((s, o) => s + (o === -2 ? 1 : 0), 0);
const kingdomTiles = (id) => S.world.owner.reduce((s, o) => s + (o === id ? 1 : 0), 0);
const visionBonus = () => R('cartography');

function distToTerritory(i) {
  let best = 999;
  const { owner } = S.world;
  for (let j = 0; j < owner.length; j++) if (owner[j] === -2) { const d = WG.dist(i, j); if (d < best) best = d; }
  return best;
}
// Claiming takes the clicked hex plus its neutral neighbours (a small piece of land).
function claimCluster(i) {
  return [i].concat(WG.neighbors(i)).filter((j) => S.world.owner[j] === -1 && isPassable(j) && isSeen(j) && !(S.world.feat[j] && ['fort', 'ruins', 'cove'].includes(S.world.feat[j].type) && !(S.world.feat[j].captured || S.world.feat[j].looted || S.world.feat[j].destroyed)));
}
function claimCost(i) {
  const n = Math.max(0, playerTiles() - 60), far = i != null ? Math.max(0, distToTerritory(i) - 1) : 0;
  const hexes = i != null ? Math.max(1, claimCluster(i).length) : 7;
  const m = (1 + 0.06 * far) * Math.pow(1.004, n) * hexes;
  return { gold: Math.round((28 * m) / 5) * 5, food: Math.round((14 * m) / 5) * 5 };
}
function claimError(i) {
  const { terrain, owner } = S.world;
  if (!isSeen(i)) return 'Explore this land first (scouts, fleets or divisions)';
  if (terrain[i] === T.WATER) return 'You cannot claim the open sea';
  if (terrain[i] === T.MOUNTAIN) return 'Mountains cannot be settled';
  if (owner[i] === -2) return 'Already yours';
  if (owner[i] >= 0) return `Owned by ${S.kingdoms[owner[i]].name} — send a division to conquer it`;
  const f = S.world.feat[i];
  if (f && f.type === 'fort' && !f.captured) return 'Capture the fort with a division';
  if (f && f.type === 'ruins' && !f.looted) return 'Explore the ruins with a division first';
  if (f && f.type === 'cove' && !f.destroyed) return 'Destroy the pirate cove first';
  if (playerTiles() + claimCluster(i).length > territoryLimit()) return `Territory limit (${territoryLimit()} hexes) — upgrade the Main Hall or research Administration`;
  if (!canAfford(claimCost(i))) return 'Not enough resources';
  return null;
}
function claimTile(i) {
  const err = claimError(i);
  if (err) { toast(err, 'bad'); return false; }
  const cl = claimCluster(i);
  pay(claimCost(i));
  for (const j of cl) S.world.owner[j] = -2;
  reveal(i, 3);
  log(`Claimed ${cl.length} hexes of ${TERRAIN[S.world.terrain[i]].name} at ${hexName(i)}.`, 'good');
  toast(`🏳️ ${cl.length} hexes claimed!`, 'good');
  worldVersion++;
  UI.panelDirty = true;
  return true;
}

/* ---- Scouting: scout parties are units you move on the map ----
   Every hex they pass through (and a radius around it) is revealed. */
const scoutRadius = () => { const lodge = S.buildings.find((b) => b.type === 'scoutlodge' && b.level > 0); return 5 + (lodge ? lodge.level : 0) + 2 * visionBonus(); };
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
  for (const k of S.kingdoms) if (WG.dist(k.capital, p.at) <= scoutRadius() + 2) { if (!S.intel[k.id] || S.time - S.intel[k.id].t > 60) log(`Scouts gathered intel on ${k.name}.`, 'info'); gatherIntel(k); }
  const o = S.world.owner[p.at];
  if (o >= 0 && Math.random() < 0.015 * (hostileToPlayer(S.kingdoms[o]) ? 2 : 1) * (1 - 0.25 * R('espionage'))) {
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

/* ---- Docks & defense on the one grid ---- */
// Fleets can dock (and disband) next to any Port or Shipyard you own.
function dockAt(water) {
  for (const n of WG.neighbors(water)) { const b = buildingAt(n); if (b && (b.type === 'port' || b.type === 'shipyard') && b.level > 0) return n; }
  return -1;
}
const stationedAt = (i) => S.divisions.filter((d) => WG.dist(d.at, i) <= 2 && !d.path.length && d.status !== 'fighting');
const DEF_TYPES = ['tower', 'cannon', 'spire', 'fortress'];
const defensesNear = (i, r = 3) => S.buildings.filter((b) => DEF_TYPES.includes(b.type) && b.level > 0 && WG.dist(b.hex, i) <= r);
function hexDefense(i) {
  return defensesNear(i).reduce((s2, b) => s2 + BUILDINGS[b.type].def * Math.pow(b.level, 1.25), 0)
    + stationedAt(i).reduce((s2, x) => s2 + armyPower(x.units, x.general), 0)
    + (WG.dist(i, S.world.capital) <= 3 ? armyPower(S.army, S.castellan) : 0);
}
const isDefended = (i) => hexDefense(i) > 0;
