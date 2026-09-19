/* ==========================================================================
   Kingdom economy: hex land, coast, obstacles, construction, production,
   storage, research bonuses.
   ========================================================================== */
'use strict';

let KT = new Uint8Array(KG.N);       // 1 = land, 0 = water (kingdom map)
let KDEPTH = new Int16Array(KG.N);    // water depth in hexes from shore
let KCLEARED = new Set();

function deriveKingdom() {
  const seed = S.seed;
  const hx = KG.cx[HALL_HEX], hy = KG.cy[HALL_HEX], w = K_HEX * SQ3;
  for (let i = 0; i < KG.N; i++) {
    const x = KG.cx[i], y = KG.cy[i];
    // Irregular eastern coastline with a bay and a headland.
    const shore = hx + w * (5.4 + 2.2 * (fbm(y * 0.006, 3.3, seed + 11, 3) - 0.5) * 2 - 1.3 * Math.exp(-(((y - hy - 150) / 90) ** 2)));
    let land = x < shore;
    // A little islet offshore
    if (!land && dist(x, y, hx + w * 8.2, hy - K_HEX * 7) < K_HEX * (1.2 + fbm(x * 0.02, y * 0.02, seed, 2))) land = true;
    KT[i] = land ? 1 : 0;
  }
  KT[HALL_HEX] = 1;
  KG.neighbors(HALL_HEX).forEach((n) => { KT[n] = 1; });
  KDEPTH = KG.distanceField((i) => KT[i] === 1, 6);
  KCLEARED = new Set(S.cleared);
}

const hallLevel = () => (S.buildings.find((b) => b.type === 'hall') || { level: 1 }).level;
const R = (id) => (S.research && S.research[id]) || 0;
const countOf = (type) => S.buildings.filter((b) => b.type === type).length;
const limitOf = (type, hl = hallLevel()) => BUILDINGS[type].limit[hl - 1] || 0;
const builderCount = () => [2, 2, 3, 3, 4, 4][hallLevel() - 1] + R('engineering');
const buildersBusy = () => S.buildings.filter((b) => b.build > 0).length;
const landRadius = () => 3 + hallLevel();
const isPlaza = (i) => i !== HALL_HEX && KG.dist(i, HALL_HEX) === 1;
const inLand = (i) => i >= 0 && KT[i] === 1 && KG.dist(i, HALL_HEX) <= landRadius();
const isCoastal = (i) => KT[i] === 1 && KG.neighbors(i).some((n) => KT[n] === 0);

// Trees & rocks dot the land; clear them for a little lumber / iron.
function obstacleAt(i) {
  if (i < 0 || KT[i] !== 1 || KG.dist(i, HALL_HEX) < 2 || KCLEARED.has(i)) return null;
  const h = hash2(i, 77, S.seed);
  if (h > 0.14) return null;
  return h < 0.09 ? 'tree' : 'rock';
}
function clearObstacle(i) {
  const o = obstacleAt(i);
  if (!o) return false;
  if (!inLand(i)) { toast('Expand your land to reach this', 'bad'); return false; }
  if (!pay({ gold: 25 })) { toast('Clearing costs 🪙25', 'bad'); return false; }
  S.cleared.push(i); KCLEARED.add(i);
  const loot = o === 'tree' ? { lumber: 60 } : Math.random() < 0.15 ? { iron: 40, diamonds: 2 } : { iron: 40 };
  gain(loot);
  floatText(KG.cx[i], KG.cy[i], Object.entries(loot).map(([k, v]) => `+${v}${RES_META[k].icon}`).join(' '), '#fff');
  spawnDust(i);
  UI.panelDirty = true;
  return true;
}
function kingdomStartSpots() {
  const ring = KG.within(HALL_HEX, 3).filter((i) => KG.dist(i, HALL_HEX) >= 2 && KT[i] === 1);
  ring.sort((a, b) => hash2(a, 5, S.seed) - hash2(b, 5, S.seed));
  const out = ring.slice(0, 3);
  out.forEach((i) => { if (obstacleAt(i)) { S.cleared.push(i); KCLEARED.add(i); } });
  return out;
}

function storageMult() {
  const wh = S.buildings.filter((b) => b.type === 'warehouse').reduce((s, b) => s + BUILDINGS.warehouse.storage * b.level, 0);
  return 1 + 0.2 * R('banking') + wh;
}
function capOf(k) {
  const hl = hallLevel();
  const base = k === 'diamonds' ? 150 + 120 * (hl - 1) : 3000 * Math.pow(2, hl - 1);
  return Math.round(base * storageMult());
}

function costFor(type, targetLevel) {
  const d = BUILDINGS[type];
  const exp = type === 'hall' ? targetLevel - 2 : targetLevel - 1;
  const c = {};
  for (const [k, v] of Object.entries(d.base)) c[k] = Math.round((v * Math.pow(d.mult, exp)) / 5) * 5;
  return c;
}
const buildTime = (type, lvl) => Math.max(1, Math.round(BUILDINGS[type].time * Math.pow(lvl, 1.5) * (1 - 0.12 * R('architecture'))));
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
  if (typeof bumpRes === 'function') bumpRes(Object.keys(res));
}
const scaleCost = (c, m) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v * m)]));

function buildingAt(i) {
  if (i === HALL_HEX || isPlaza(i)) return S.buildings.find((b) => b.type === 'hall');
  return S.buildings.find((b) => b.hex === i);
}
function placementError(type, i) {
  if (i < 0) return 'Outside the map';
  if (KT[i] === 0) return 'You cannot build on water';
  if (!inLand(i)) return 'Outside your land — upgrade the Main Hall to expand';
  if (i === HALL_HEX || isPlaza(i)) return 'The plaza around the Main Hall must stay clear';
  if (buildingAt(i)) return 'Hex occupied';
  const o = obstacleAt(i);
  if (o) return `Clear the ${o === 'tree' ? 'trees' : 'rocks'} first (click them)`;
  if (BUILDINGS[type].coastal && !isCoastal(i)) return 'Must be built on the coast, next to water';
  return null;
}
function buildLockReason(type) {
  const d = BUILDINGS[type], hl = hallLevel();
  if (d.hall && hl < d.hall) return `Requires Main Hall ${d.hall}`;
  if (countOf(type) >= limitOf(type)) {
    const next = d.limit.findIndex((v, i) => i >= hl && v > countOf(type));
    return next >= 0 ? `Limit reached — Main Hall ${next + 1} allows more` : 'Limit reached';
  }
  if (buildersBusy() >= builderCount()) return 'All builders are busy';
  return null;
}
function addBuilding(type, hex, level = 0) {
  const b = { id: S.nextId++, type, hex, level, build: 0, buildTotal: 0 };
  if (BUILDINGS[type].trains || BUILDINGS[type].builds) { b.queue = []; b.trainLeft = 0; }
  if (BUILDINGS[type].research) b.research = null;
  S.buildings.push(b);
  return b;
}
function placeBuilding(type, i) {
  const lock = buildLockReason(type);
  if (lock) { toast(lock, 'bad'); return null; }
  const err = placementError(type, i);
  if (err) { toast(err, 'bad'); return null; }
  if (!pay(costFor(type, 1))) { toast('Not enough resources', 'bad'); return null; }
  const b = addBuilding(type, i, 0);
  b.build = b.buildTotal = buildTime(type, 1);
  spawnDust(i);
  UI.panelDirty = true;
  return b;
}
function upgradeError(b) {
  const d = BUILDINGS[b.type];
  if (b.build > 0) return 'Already under construction';
  if (b.type === 'hall' && b.level >= MAX_HALL) return 'Max level';
  if (b.type !== 'hall' && b.level >= hallLevel()) return 'Upgrade the Main Hall first (level cap = hall level)';
  if (d.hall && hallLevel() < d.hall) return `Requires Main Hall ${d.hall}`;
  if (buildersBusy() >= builderCount()) return 'All builders are busy';
  if (b.research) return 'Wait for the current research to finish';
  if (!canAfford(costFor(b.type, b.level + 1))) return 'Not enough resources';
  return null;
}
function upgradeBuilding(b) {
  const err = upgradeError(b);
  if (err) { toast(err, 'bad'); return false; }
  pay(costFor(b.type, b.level + 1));
  b.build = b.buildTotal = buildTime(b.type, b.level + 1);
  spawnDust(b.hex);
  UI.panelDirty = true;
  return true;
}
function demolish(b) {
  if (!b || b.type === 'hall') return;
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
  if (b.type === 'hall') { toast(`Main Hall ${b.level}! Your land grows and new buildings unlock.`, 'good'); celebrate(); }
  spawnSparkles(b.hex);
  UI.panelDirty = true;
}

/* ---- Bonuses ---- */
function allianceBonus() {
  const a = S.alliances.find((x) => x.id === S.allianceId);
  if (!a) return { prod: 0, atk: 0, def: 0, train: 0 };
  return { prod: 0.03 * a.level + 0.01 * a.members.length, atk: 0.02 * a.level, def: 0.04 * a.level, train: 0.05 * a.level };
}
function prodMult(res) {
  let m = (1 + 0.08 * R('tools')) * (1 + allianceBonus().prod);
  if (res === 'food') m *= (1 + 0.15 * R('crops')) * calendar().season.food;
  if (res === 'gold') m *= 1 + 0.05 * S.kingdoms.filter((k) => k.tradePact).length;
  return m;
}
function productionOf(b) {
  const d = BUILDINGS[b.type];
  if (b.level < 1) return null;
  const lv = b.level * (1 + 0.25 * (b.level - 1));
  if (d.produces) return [d.produces, d.rate * lv * (['goldmine', 'ironmine', 'diamondmine'].includes(b.type) ? 1 + 0.15 * R('mining') : 1)];
  if (b.type === 'port') return ['gold', d.rate * lv * (1 + 0.25 * R('trade')) * (S.pirateBlockade > 0 ? 0.5 : 1)];
  if (b.type === 'hall') return ['gold', 0.5 * b.level];
  return null;
}
function territoryBonus() {
  const r = Object.fromEntries(RES.map((k) => [k, 0]));
  if (!S.world) return r;
  const { owner, terrain, feat } = S.world;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== -2) continue;
    const b = TERRAIN[terrain[i]].bonus;
    if (b) for (const [k, v] of Object.entries(b)) r[k] += v;
    const f = feat[i];
    if (f && f.type === 'goldvein') r.gold += 0.6;
    if (f && f.type === 'cave' && f.explored) for (const [k, v] of Object.entries(MINERALS[f.mineral].bonus)) r[k] += v;
    const tp = S.world.bld && tbProduction(i);
    if (tp) for (const [k, v] of Object.entries(tp)) r[k] += v;
  }
  return r;
}
function upkeep() {
  let food = armyHousing(S.army);
  for (const d of S.divisions) food += armyHousing(d.units);
  let gold = 0;
  const ships = allShips();
  for (const t of SHIP_TYPES) gold += SHIPS[t].upkeep * ships[t];
  return { food: food * 0.015, gold };
}
function rates() {
  const r = Object.fromEntries(RES.map((k) => [k, 0]));
  for (const b of S.buildings) { const p = productionOf(b); if (p) r[p[0]] += p[1]; }
  const tb = territoryBonus();
  for (const k of RES) r[k] = (r[k] + tb[k]) * prodMult(k);
  const u = upkeep();
  r.food -= u.food; r.gold -= u.gold;
  return r;
}
function defenseRating() {
  let d = 0;
  for (const b of S.buildings) if (BUILDINGS[b.type].def && b.level > 0) d += BUILDINGS[b.type].def * Math.pow(b.level, 1.25);
  return d * (1 + 0.1 * R('masonry')) * (1 + 0.12 * R('fortification')) * (1 + allianceBonus().def);
}
const territoryLimit = () => 6 + 5 * hallLevel() + 3 * R('administration');
