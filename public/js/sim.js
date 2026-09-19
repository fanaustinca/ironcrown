/* ==========================================================================
   World simulation: movement & orders for divisions/fleets, AI kingdoms and
   their armies/fleets, pirates, raids, diplomacy, and the master step().
   ========================================================================== */
'use strict';

const HEX_TIME_LAND = 4, HEX_TIME_SEA = 3;

/* ---------- path costs ---------- */
const canEmbark = (d) => transportCapacity() >= armyHousing(d.units);
function divisionCost(d) {
  const embark = canEmbark(d);
  return (i) => { const t = S.world.terrain[i]; if (t === T.WATER) return embark ? 1.3 : Infinity; return TERRAIN[t].cost; };
}
const fleetCost = (i) => (S.world.terrain[i] === T.WATER ? 1 : Infinity);
const aiLandCost = (i) => { const t = S.world.terrain[i]; return t === T.WATER ? Infinity : TERRAIN[t].cost; };
const isFleet = (e) => !!e.ships;

function nearestWaterTo(hex, from) {
  const c = WG.neighbors(hex).filter((n) => isWater(n));
  if (isWater(hex)) return hex;
  return c.sort((a, b) => WG.dist(a, from) - WG.dist(b, from))[0] ?? -1;
}
function planPath(ent, goal) {
  if (isFleet(ent)) { const g = nearestWaterTo(goal, ent.at); return g < 0 ? null : findPath(WG, ent.at, g, fleetCost); }
  return findPath(WG, ent.at, goal, divisionCost(ent));
}
function giveOrder(ent, type, hex, extra = {}) {
  const path = planPath(ent, hex);
  if (path === null) { toast(isFleet(ent) ? 'No sea route there' : (isWater(hex) ? 'Divisions need transport ships (Cogs) to cross water' : 'No route there — mountains or sea block the way'), 'bad'); return false; }
  ent.path = path; ent.prog = 0; ent.order = { type, hex, ...extra }; ent.status = path.length ? 'moving' : 'idle';
  if (!path.length) arrive(ent);
  UI.panelDirty = true;
  return true;
}
function etaOf(ent) {
  if (!ent.path.length) return 0;
  const speed = isFleet(ent) ? fleetSpeed(ent) : divisionSpeed(ent);
  const cost = isFleet(ent) ? fleetCost : divisionCost(ent);
  const per = isFleet(ent) ? HEX_TIME_SEA : HEX_TIME_LAND;
  return ent.path.reduce((s, i, k) => s + per * cost(i) * (k === 0 ? 1 - ent.prog : 1), 0) / speed;
}

// Advance one entity along its path. Returns true when it just arrived.
function advance(ent, dt, speed, cost, per, onEnter) {
  if (!ent.path || !ent.path.length || ent.status === 'fighting') return false;
  let budget = dt * speed;
  while (budget > 0 && ent.path.length) {
    const c = cost(ent.path[0]);
    if (!isFinite(c)) { ent.path = []; ent.prog = 0; return true; }
    const need = (1 - ent.prog) * per * c;
    if (budget >= need) { budget -= need; ent.at = ent.path.shift(); ent.prog = 0; if (onEnter) onEnter(ent); }
    else { ent.prog += budget / (per * c); budget = 0; }
  }
  return !ent.path.length;
}

/* ---------- enemy forces ---------- */
function enemyUnitStats(u, hall) {
  const m = (1 + 0.12 * (hall - 1)) * (1 + 0.08 * hall);
  return { atk: UNITS[u].atk * m, hp: UNITS[u].hp * m, speed: UNITS[u].speed, range: UNITS[u].range };
}
function enemyShipStats(t, hall) {
  const m = 1 + 0.12 * (hall - 1);
  return { atk: SHIPS[t].atk * m, hp: SHIPS[t].hp * m, speed: SHIPS[t].speed, range: SHIPS[t].range };
}
function armyFromPower(power, hall, personality) {
  const shares = { aggressive: { archer: 0.25, swordsman: 0.3, pikeman: 0.15, horseman: 0.3 }, builder: { archer: 0.45, swordsman: 0.3, pikeman: 0.2, horseman: 0.05 } }[personality]
    || { archer: 0.3, swordsman: 0.3, pikeman: 0.15, horseman: 0.25 };
  if (hall >= 3) { shares.catapult = 0.08; }
  const units = emptyArmy();
  for (const [u, s] of Object.entries(shares)) units[u] = Math.max(0, Math.round((power * s) / unitPower(enemyUnitStats(u, hall))));
  if (!armyHousing(units)) units.swordsman = 2;
  return units;
}
function fleetFromPower(power, hall) {
  const shares = hall >= 4 ? { sloop: 0.15, galley: 0.35, frigate: 0.4, galleon: 0.1 } : hall >= 2 ? { sloop: 0.3, galley: 0.5, frigate: 0.2 } : { sloop: 0.5, galley: 0.5 };
  const ships = emptyFleet();
  for (const [t, s] of Object.entries(shares)) ships[t] = Math.max(0, Math.round((power * s) / unitPower(enemyShipStats(t, hall))));
  if (!shipCount(ships)) ships.sloop = 1;
  return ships;
}
const enemyArmyPower = (units, hall) => COMBAT_UNITS.reduce((s, u) => s + unitPower(enemyUnitStats(u, hall)) * (units[u] || 0), 0);
const enemyFleetPower = (ships, hall) => SHIP_TYPES.reduce((s, t) => s + unitPower(enemyShipStats(t, hall)) * (ships[t] || 0), 0);

/* ---------- battles ---------- */
// Wraps Battle.run with the player's settings; watch=true opens the viewer.
function fight(cfg, offline) {
  const watch = !offline && SETTINGS.battleMode === 'watch' && !Battle.b && S.started;
  return Battle.run(cfg, watch);
}
const playerSide = (name, color, units, gid, naval) => ({
  name, color: '#f2c14e', units: { ...units }, general: gid,   // player troops always wear gold in battle
  stats: naval ? (t) => shipStats(t, gid, S.boosts) : (u) => unitStats(u, gid, S.boosts),
});
function consumeBoosts() { S.boosts = { warhorn: false, salve: false }; }
function applyCasualties(units, survivors, keys) {
  const lost = {};
  for (const k of keys) {
    const before = units[k] || 0, after = Math.min(before, survivors[k] || 0);
    let l = before - after;
    const saved = Math.floor(l * 0.1 * R('medicine') * (UNITS[k] ? 1 : 0));
    l -= saved;
    units[k] = before - l;
    if (l > 0) lost[k] = l;
  }
  return lost;
}
const lostText = (lost, table) => Object.entries(lost).map(([k, n]) => `${n} ${table[k].name}${n > 1 ? 's' : ''}`).join(', ') || 'none';
function removeDivisionIfEmpty(d) {
  if (armyHousing(d.units) > 0) return false;
  if (d.general) unassignGeneral(d.general);
  S.divisions = S.divisions.filter((x) => x !== d);
  if (UI.selEntity && UI.selEntity.id === d.id) UI.selEntity = null;
  log(`${d.name} was wiped out.`, 'bad');
  return true;
}
function removeFleetIfEmpty(f) {
  if (shipCount(f.ships) > 0) return false;
  if (f.general) unassignGeneral(f.general);
  S.fleets = S.fleets.filter((x) => x !== f);
  if (UI.selEntity && UI.selEntity.id === f.id) UI.selEntity = null;
  log(`${f.name} was sunk.`, 'bad');
  return true;
}
function lootTier(tier, mult = 1) {
  const loot = { gold: Math.round(rand(200, 400) * tier ** 1.5 * mult), lumber: Math.round(rand(100, 300) * tier * mult), iron: Math.round(rand(80, 220) * tier * mult) };
  if (Math.random() < 0.3 * tier) loot.diamonds = Math.round(rand(3, 8) * tier);
  return loot;
}
function bonusDrop(tier) {
  const r = Math.random();
  if (r < 0.06 * tier) { const g = pick(GENERALS.filter((x) => x.rarity === (tier >= 3 ? 'epic' : 'rare'))); const res = grantGeneral(g.id); return `General ${g.name}${res.dup ? ' (duplicate → stars)' : ''} joined you!`; }
  if (r < 0.3) { const k = pick(Object.keys(ITEMS)); S.items[k]++; return `Found a ${ITEMS[k].name}.`; }
  return '';
}

/* ---------- player order arrivals ---------- */
function arrive(ent) {
  const o = ent.order || { type: 'move' };
  ent.status = 'idle';
  const i = ent.at, f = S.world.feat[o.hex], owner = S.world.owner[o.hex];
  if (isFleet(ent)) return arriveFleet(ent, o, f);
  const d = ent;
  if (o.type === 'claim') { claimTile(o.hex, true); }
  else if (o.type === 'explore' && f && f.type === 'ruins' && !f.looted) {
    fight({ kind: 'land', title: `🏛️ ${d.name} explores the ruins`, left: playerSide(d.name, d.color, d.units, d.general),
      right: { name: 'Bandits', color: '#6b5a44', units: armyFromPower(f.guard, f.tier, 'balanced'), stats: (u) => enemyUnitStats(u, f.tier) },
      onEnd: (r) => {
        consumeBoosts();
        const lost = applyCasualties(d.units, r.left, COMBAT_UNITS);
        if (r.win) {
          f.looted = true; S.stats.ruinsExplored++;
          const loot = lootTier(f.tier); gain(loot, true);
          const extra = bonusDrop(f.tier);
          report(`🏛️ ${d.name} cleared the ruins: ${costText(loot)}. ${extra}`, 'good', lost);
        } else report(`🏛️ ${d.name} was driven off by the bandits guarding the ruins.`, 'bad', lost);
        removeDivisionIfEmpty(d);
      } });
  } else if (o.type === 'explore' && f && f.type === 'cave') {
    const was = f.explored; f.explored = true;
    const loot = { [Object.keys(MINERALS[f.mineral].bonus)[0]]: f.mineral === 'gems' ? 12 : 150 };
    if (!was) { gain(loot, true); log(`${d.name} explored a cave: ${MINERALS[f.mineral].name}! Claim the hex to mine it.`, 'good'); toast(`🕳️ Cave holds ${MINERALS[f.mineral].name} (+${costText(loot)})`, 'good'); }
  } else if (o.type === 'capture' && f && f.type === 'fort' && !f.captured) {
    fight({ kind: 'land', title: `🏯 ${d.name} storms the abandoned fort`, left: playerSide(d.name, d.color, d.units, d.general),
      right: { name: 'Deserters', color: '#5a5a66', units: armyFromPower(f.guard * 0.7, f.tier + 1, 'builder'), stats: (u) => enemyUnitStats(u, f.tier + 1), towers: 2, towerHall: f.tier },
      onEnd: (r) => {
        consumeBoosts();
        const lost = applyCasualties(d.units, r.left, COMBAT_UNITS);
        if (r.win) {
          f.captured = true; S.world.owner[o.hex] = -2; worldVersion++;
          reveal(o.hex, 3);
          report(`🏯 ${d.name} captured the fort! It is now your outpost — claim land within 2 hexes of it.`, 'good', lost);
        } else report(`🏯 The fort's defenders repelled ${d.name}.`, 'bad', lost);
        removeDivisionIfEmpty(d);
      } });
  } else if (o.type === 'attack' && owner >= 0) {
    const k = S.kingdoms[owner];
    if (S.allianceId && k.allianceId === S.allianceId) { toast(`${k.name} is your ally`, 'bad'); return; }
    if (o.hex === k.capital) assaultCapital(d, k);
    else skirmish(d, k, o.hex);
  } else if (o.type === 'return' || i === S.world.capital) {
    if (i === S.world.capital) toast(`${d.name} is home`, '');
  } else toast(`${d.name} arrived`, '');
  UI.panelDirty = true;
}
function costText(c) { return Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${RES_META[k].icon}${fmt(v)}`).join(' '); }
function report(msg, kind, lost) {
  const txt = msg + (lost && Object.keys(lost).length ? ` Losses: ${lostText(lost, { ...UNITS, ...SHIPS })}.` : '');
  log(txt, kind); toast(txt, kind);
}

function assaultCapital(d, k) {
  if (!S.intel[k.id]) gatherIntel(k);
  const army = armyFromPower(k.power, k.hall, k.personality);
  fight({ kind: 'land', title: `⚔️ ${d.name} assaults ${k.name}`, left: playerSide(d.name, d.color, d.units, d.general),
    right: { name: k.name, color: k.color, units: army, stats: (u) => enemyUnitStats(u, k.hall), towers: clamp(Math.round(k.defense / 70), 1, 8), towerHall: k.hall, keep: true },
    onEnd: (r) => {
      consumeBoosts();
      const lost = applyCasualties(d.units, r.left, COMBAT_UNITS);
      k.power = Math.max(60, enemyArmyPower(r.right, k.hall) + k.power * 0.15);
      k.defense = Math.max(20, k.defense * (0.4 + 0.6 * r.towersLeft / Math.max(1, r.towersStart)));
      k.relation -= r.win ? 30 : 15;
      S.kingdoms.forEach((o) => { if (o !== k && o.allianceId && o.allianceId === k.allianceId) o.relation -= 10; });
      if (r.win) {
        const loot = {};
        for (const res of RES) { const v = Math.floor(k.res[res] * 0.3 + (res === 'diamonds' ? 3 : 150) * k.hall); loot[res] = v; k.res[res] = Math.max(0, k.res[res] - v); }
        gain(loot);
        k.defeats++;
        let tiles = 0;
        for (let n = 0; n < 2; n++) if (playerTiles() < territoryLimit() && transferBorderTile(k.id, -2) >= 0) tiles++;
        S.stats.battlesWon++;
        gatherIntel(k);
        report(`⚔️ Victory over ${k.name}! Loot ${costText(loot)}${tiles ? `, ${tiles} hex${tiles > 1 ? 'es' : ''} seized` : ''}.`, 'good', lost);
      } else { S.stats.battlesLost++; report(`⚔️ ${d.name} failed to take ${k.name}.`, 'bad', lost); }
      if (!removeDivisionIfEmpty(d)) giveOrder(d, 'move', neighborsFree(d.at, k.capital));
    } });
}
function neighborsFree(at, cap) { return at === cap ? (WG.neighbors(cap).find((n) => isPassable(n) && S.world.owner[n] !== S.world.owner[cap]) ?? at) : at; }
function skirmish(d, k, hex) {
  const g = k.power * 0.12 + 30 * k.hall;
  fight({ kind: 'land', title: `🏳️ ${d.name} invades ${k.name}'s land`, left: playerSide(d.name, d.color, d.units, d.general),
    right: { name: `${k.name} garrison`, color: k.color, units: armyFromPower(g, k.hall, k.personality), stats: (u) => enemyUnitStats(u, k.hall) },
    onEnd: (r) => {
      consumeBoosts();
      const lost = applyCasualties(d.units, r.left, COMBAT_UNITS);
      k.relation -= 10; k.power = Math.max(60, k.power - g * 0.5);
      if (r.win) {
        const room = playerTiles() < territoryLimit();
        S.world.owner[hex] = room ? -2 : -1; worldVersion++;
        S.stats.battlesWon++;
        report(`🏳️ ${d.name} ${room ? 'conquered' : 'razed'} a ${TERRAIN[S.world.terrain[hex]].name} hex of ${k.name}.`, 'good', lost);
      } else { S.stats.battlesLost++; report(`🏳️ ${d.name} was repelled by ${k.name}.`, 'bad', lost); }
      removeDivisionIfEmpty(d);
    } });
}

function arriveFleet(fl, o, f) {
  if (o.type === 'salvage' && f && f.type === 'wreck' && !f.salvaged) {
    f.salvaged = true; S.stats.wrecksSalvaged++;
    const loot = lootTier(f.tier, 0.8); gain(loot, true);
    report(`⚓ ${fl.name} salvaged the wreck: ${costText(loot)}. ${bonusDrop(f.tier)}`, 'good');
  } else if (o.type === 'cove' && f && f.type === 'cove' && !f.destroyed) {
    fight({ kind: 'naval', title: `🏴‍☠️ ${fl.name} attacks the pirate cove`, left: playerSide(fl.name, '#f2c14e', fl.ships, fl.general, true),
      right: { name: 'Pirates', color: '#222', units: fleetFromPower(f.power, 3), stats: (t) => enemyShipStats(t, 3), towers: 2, towerHall: 3, pirate: true },
      onEnd: (r) => {
        consumeBoosts();
        const lost = applyCasualties(fl.ships, r.left, SHIP_TYPES);
        if (r.win) {
          f.destroyed = true; S.stats.navalWon++;
          const loot = lootTier(3, 1.6); gain(loot, true);
          report(`🏴‍☠️ ${fl.name} burned the pirate cove! Treasure: ${costText(loot)}. ${bonusDrop(3)}`, 'good', lost);
        } else { S.stats.navalLost++; report(`🏴‍☠️ The pirates drove ${fl.name} off.`, 'bad', lost); }
        removeFleetIfEmpty(fl);
      } });
  } else if (o.type === 'blockade') {
    const k = S.kingdoms[o.kid];
    const ships = fleetFromPower(Math.max(40, k.navy), k.hall);
    fight({ kind: 'naval', title: `⚓ ${fl.name} blockades ${k.name}`, left: playerSide(fl.name, '#f2c14e', fl.ships, fl.general, true),
      right: { name: `${k.name} navy`, color: k.color, units: ships, stats: (t) => enemyShipStats(t, k.hall), towers: clamp(Math.round(k.defense / 150), 1, 4), towerHall: k.hall },
      onEnd: (r) => {
        consumeBoosts();
        const lost = applyCasualties(fl.ships, r.left, SHIP_TYPES);
        k.navy = Math.max(0, enemyFleetPower(r.right, k.hall));
        k.relation -= 20;
        if (r.win) {
          const loot = { gold: Math.floor(k.res.gold * 0.25 + 200 * k.hall), food: Math.floor(k.res.food * 0.2) };
          k.res.gold -= loot.gold; k.res.food -= loot.food; gain(loot);
          S.stats.navalWon++;
          report(`⚓ ${fl.name} broke ${k.name}'s navy and plundered their harbour: ${costText(loot)}.`, 'good', lost);
        } else { S.stats.navalLost++; report(`⚓ ${k.name}'s navy drove ${fl.name} away.`, 'bad', lost); }
        removeFleetIfEmpty(fl);
      } });
  } else if (o.type !== 'hunt') toast(`${fl.name} ${fl.at === S.world.harbor ? 'is back in harbour' : 'arrived'}`);
  UI.panelDirty = true;
}

/* ---------- AI kingdoms ---------- */
const hostileToPlayer = (k) => k && !(S.allianceId && k.allianceId === S.allianceId) && k.treaty <= 0 && (k.atWar || k.relation < -35);
function aiTurn(offline) {
  const pp = totalPower();
  for (const k of S.kingdoms) {
    for (const r of Object.keys(k.res)) k.res[r] += (r === 'diamonds' ? 1 : 70) * k.hall;
    const w = { ...PERSONALITIES[k.personality].w };
    if (k.power < pp * 0.5) w.train += 3;
    if (k.hall >= MAX_HALL) w.upgrade = 0;
    const action = weighted(w), visible = isSeen(k.capital);
    if (action === 'expand') {
      const limit = 6 + 4 * k.hall;
      if (kingdomTiles(k.id) < limit) {
        const cand = [];
        const { owner } = S.world;
        for (let i = 0; i < owner.length; i++) if (owner[i] === k.id) for (const n of WG.neighbors(i)) if (owner[n] === -1 && isPassable(n) && !(S.world.feat[n] && ['fort', 'ruins'].includes(S.world.feat[n].type))) cand.push(n);
        if (cand.length) {
          cand.sort((a, b) => WG.dist(a, k.capital) - WG.dist(b, k.capital));
          S.world.owner[cand[Math.floor(Math.random() * Math.min(3, cand.length))]] = k.id; worldVersion++;
        } else k.power += 10 + k.hall * 8;
      } else k.defense += 10;
    } else if (action === 'upgrade') {
      const need = 600 * Math.pow(2.2, k.hall);
      if (k.res.gold >= need && k.res.lumber >= need * 0.8) {
        k.res.gold -= need; k.res.lumber -= need * 0.8; k.hall++; k.power *= 1.1; k.defense *= 1.1;
        if (visible && !offline) log(`${k.name} upgraded its keep to level ${k.hall}.`, 'info');
      } else k.defense += 6;
    } else if (action === 'build') k.defense += 12 + k.hall * 6;
    else k.power += 15 + k.hall * 10;
    if (k.coastal) k.navy += 6 + k.hall * 4;
    if (k.treaty > 0) k.relation += 0.5;
    k.relation += k.relation > 0 ? -0.3 : 0.4;
    if (k.atWar) k.relation = Math.min(k.relation, -60);
    if (k.tradePact && k.relation < 10) { k.tradePact = false; log(`${k.name} cancelled your trade pact.`, 'bad'); }
    k.relation = clamp(k.relation, -100, 100);
    // Coastal kingdoms keep a patrol fleet at sea.
    if (k.coastal && k.navy > 60 && !S.aiFleets.some((f) => f.owner === k.id) && Math.random() < 0.3) spawnAiFleet(k);
  }
  // Wars between AI kingdoms — marching armies you can watch on the map.
  if (Math.random() < 0.15 && S.aiArmies.length < 6) {
    const a = pick(S.kingdoms.filter((k) => k.personality === 'aggressive' || k.personality === 'expansionist'));
    const targets = a ? S.kingdoms.filter((k) => k !== a && (k.allianceId == null || k.allianceId !== a.allianceId) && WG.dist(k.capital, a.capital) < 18) : [];
    if (targets.length) spawnAiArmy(a, pick(targets).capital, 'war', a.power * 0.4);
  }
  allianceTurn(offline);
  UI.panelDirty = true;
}
function spawnAiArmy(k, targetHex, kind, power) {
  const path = findPath(WG, k.capital, targetHex, aiLandCost, 5000);
  if (!path || !path.length) return null;
  power = Math.max(60, power);
  k.power = Math.max(40, k.power - power);
  const a = { id: 'a' + uid(), kid: k.id, kind, units: armyFromPower(power, k.hall, k.personality), hall: k.hall, at: k.capital, path, prog: 0, target: targetHex, status: 'moving' };
  S.aiArmies.push(a);
  return a;
}
function spawnAiFleet(k) {
  const start = nearestWaterTo(k.capital, k.capital);
  if (start < 0 || !OCEAN[start]) return;
  const power = k.navy * 0.6;
  k.navy -= power;
  S.aiFleets.push({ id: 'n' + uid(), owner: k.id, ships: fleetFromPower(power, k.hall), hall: k.hall, at: start, home: start, path: [], prog: 0, life: rand(240, 480), status: 'moving' });
}
function spawnPirates() {
  const coves = Object.entries(S.world.feat).filter(([, f]) => f.type === 'cove' && !f.destroyed);
  if (!coves.length || S.aiFleets.filter((f) => f.owner === 'pirate').length >= 2) return;
  const [ci, cf] = pick(coves);
  const start = nearestWaterTo(+ci, +ci);
  if (start < 0) return;
  S.aiFleets.push({ id: 'p' + uid(), owner: 'pirate', ships: fleetFromPower(cf.power * 0.5 + S.time * 0.02, 2), hall: 2, at: start, home: start, path: [], prog: 0, life: 360, status: 'moving', hunt: true });
  if (isSeen(start)) log('🏴‍☠️ A pirate fleet has put to sea!', 'bad');
}
const aiFleetHostile = (f) => f.owner === 'pirate' || hostileToPlayer(S.kingdoms[f.owner]);

function stepAiArmies(dt, offline) {
  for (const a of [...S.aiArmies]) {
    const k = S.kingdoms[a.kid];
    const done = advance(a, dt, Math.min(...COMBAT_UNITS.filter((u) => a.units[u] > 0).map((u) => UNITS[u].speed), 1.2), aiLandCost, HEX_TIME_LAND);
    if (!done) continue;
    S.aiArmies = S.aiArmies.filter((x) => x !== a);
    if (a.kind === 'home') { k.power += enemyArmyPower(a.units, a.hall); continue; }
    if (a.kind === 'raid') { resolveRaid(a, offline); continue; }
    // AI-vs-AI war
    const target = S.kingdoms.find((x) => x.capital === a.target);
    if (!target) continue;
    const ap = enemyArmyPower(a.units, a.hall), win = Math.random() < ap / (ap + target.power + target.defense * 0.5);
    if (win) { target.power *= 0.7; const t = transferBorderTile(target.id, k.id); if (!offline && (isSeen(k.capital) || isSeen(target.capital))) log(`⚔️ ${k.name} defeated ${target.name}${t >= 0 ? ' and seized land' : ''}.`, 'info'); }
    else { target.power *= 0.85; if (!offline && (isSeen(k.capital) || isSeen(target.capital))) log(`⚔️ ${target.name} repelled an invasion by ${k.name}.`, 'info'); }
    k.power += ap * (win ? 0.6 : 0.2);
  }
}
function stepAiFleets(dt) {
  for (const f of [...S.aiFleets]) {
    f.life -= dt;
    if (f.life <= 0 && !f.path.length) {
      S.aiFleets = S.aiFleets.filter((x) => x !== f);
      if (f.owner !== 'pirate') S.kingdoms[f.owner].navy += enemyFleetPower(f.ships, f.hall);
      continue;
    }
    if (!f.path.length || (f.hunt && Math.random() < dt * 0.3)) {
      let goal = -1;
      const hostile = aiFleetHostile(f);
      if (hostile) {
        const prey = S.fleets.filter((pf) => WG.dist(pf.at, f.at) <= (f.owner === 'pirate' ? 10 : 5)).sort((a, b) => WG.dist(a.at, f.at) - WG.dist(b.at, f.at))[0];
        if (prey) goal = prey.at;
        else if (f.owner === 'pirate' && WG.dist(f.at, S.world.harbor) < 18 && Math.random() < 0.5) goal = S.world.harbor;
      }
      if (f.life <= 0) goal = f.home;
      if (goal < 0) {
        const opts = WG.within(f.home, 7).filter((i) => OCEAN[i]);
        goal = pick(opts);
      }
      f.path = findPath(WG, f.at, goal, fleetCost, 3000) || [];
    }
    advance(f, dt, Math.min(...SHIP_TYPES.filter((t) => f.ships[t] > 0).map((t) => SHIPS[t].speed), 1.6) * 0.8, fleetCost, HEX_TIME_SEA);
    if (f.owner === 'pirate' && f.at === S.world.harbor) piratesAtHarbor(f);
  }
}
function piratesAtHarbor(p) {
  const defenders = shipCount(S.harbor) > 0;
  if (defenders && S.started) {
    fight({ kind: 'naval', title: '🏴‍☠️ Pirates attack your harbour!', left: playerSide('Harbour guard', '#f2c14e', S.harbor, null, true),
      right: { name: 'Pirates', color: '#222', units: p.ships, stats: (t) => enemyShipStats(t, p.hall), pirate: true },
      onEnd: (r) => {
        consumeBoosts();
        const lost = applyCasualties(S.harbor, r.left, SHIP_TYPES);
        S.aiFleets = S.aiFleets.filter((x) => x !== p);
        if (r.win) { gain({ gold: 300 }); S.stats.navalWon++; report('🏴‍☠️ Your harbour guard sank the pirates! +🪙300 bounty.', 'good', lost); }
        else { S.pirateBlockade = 180; S.stats.navalLost++; report('🏴‍☠️ Pirates overwhelmed the harbour and blockade your port (-50% port income for 3 min).', 'bad', lost); }
      } }, false);
  } else {
    const stolen = Math.floor(S.res.gold * 0.08);
    S.res.gold -= stolen; S.pirateBlockade = 180;
    S.aiFleets = S.aiFleets.filter((x) => x !== p);
    report(`🏴‍☠️ Pirates raided your undefended harbour, stole 🪙${fmt(stolen)} and blockade your port for 3 minutes. Build warships!`, 'bad');
  }
}

/* ---------- raids on the player ---------- */
function raidCandidates() {
  return S.kingdoms.filter((k) => !(S.allianceId && k.allianceId === S.allianceId) && k.treaty <= 0 && (k.atWar || k.relation < 0 || k.personality === 'aggressive'));
}
function scheduleRaid() { S.raidTimer = rand(300, 540) / (1 + 0.08 * hallLevel()) * (S.kingdoms.some((k) => k.atWar) ? 0.6 : 1); }
function launchRaid(k) {
  if (S.shield > 0) { log(`${k.name} considered raiding you but your Peace Shield deters them.`, 'info'); return; }
  const a = spawnAiArmy(k, S.world.capital, 'raid', k.power * rand(0.4, 0.6));
  if (!a) return;
  const eta = etaAi(a);
  log(`⚠️ ${k.name} has sent an army against you! ETA ${fmtTime(eta)}. Intercept it with a division or prepare your defenses.`, 'bad');
  toast(`⚠️ ${k.name} army marching on your capital — ETA ${fmtTime(eta)}`, 'bad');
}
function etaAi(a) {
  const sp = Math.min(...COMBAT_UNITS.filter((u) => a.units[u] > 0).map((u) => UNITS[u].speed), 1.2);
  return a.path.reduce((s, i) => s + HEX_TIME_LAND * aiLandCost(i), 0) / sp;
}
function homeDefenders() {
  const units = { ...S.army };
  for (const d of S.divisions) if (d.at === S.world.capital && !d.path.length) for (const u of COMBAT_UNITS) units[u] += d.units[u];
  return units;
}
function playerTowers() {
  const defs = S.buildings.filter((b) => ['tower', 'cannon', 'spire'].includes(b.type) && b.level > 0);
  const lvl = defs.length ? defs.reduce((s, b) => s + b.level, 0) / defs.length : 1;
  return { n: Math.min(8, defs.length), hall: lvl + 0.5 * defs.filter((b) => b.type !== 'tower').length, hpMult: 1 + Math.min(0.4, countOf('wall') * 0.01) };
}
function resolveRaid(a, offline) {
  const k = S.kingdoms[a.kid];
  const units = homeDefenders();
  const help = S.allianceId ? S.kingdoms.filter((x) => x.allianceId === S.allianceId).reduce((s, x) => s + x.power * 0.12, 0) : 0;
  if (help > 0) { const hu = armyFromPower(help, 2, 'balanced'); for (const u of COMBAT_UNITS) units[u] += hu[u]; }
  const tw = playerTowers();
  fight({ kind: 'land', defend: true, title: `🛡️ ${k.name} attacks your capital!`, left: { ...playerSide(S.name, '#f2c14e', units, S.castellan), towers: tw.n, towerHall: tw.hall, towerHp: tw.hpMult, keep: true },
    right: { name: k.name, color: k.color, units: a.units, stats: (u) => enemyUnitStats(u, a.hall) },
    onEnd: (r) => {
      consumeBoosts();
      // Distribute casualties: garrison first, then divisions at home (allied help absorbs its share).
      const survivors = { ...r.left };
      const lost = {};
      for (const u of COMBAT_UNITS) {
        let dead = Math.max(0, units[u] - (survivors[u] || 0));
        const take = (obj) => { const n = Math.min(obj[u], dead); obj[u] -= n; dead -= n; lost[u] = (lost[u] || 0) + n; };
        take(S.army);
        for (const d of S.divisions) if (d.at === S.world.capital && !d.path.length) take(d.units);
      }
      Object.keys(lost).forEach((u) => { if (!lost[u]) delete lost[u]; });
      S.divisions.slice().forEach(removeDivisionIfEmpty);
      k.relation -= 5;
      if (r.win) {
        const loot = { gold: Math.round(k.res.gold * 0.05 + 100) };
        k.res.gold -= loot.gold; gain(loot); S.stats.raidsRepelled++;
        report(`🛡️ ${k.name}'s raid was repelled${help ? ' with help from your allies' : ''}! +🪙${fmt(loot.gold)}.`, 'good', lost);
        const rest = r.right;
        if (armyHousing(rest) > 0) S.aiArmies.push({ ...a, kind: 'home', units: rest, path: findPath(WG, S.world.capital, k.capital, aiLandCost) || [], prog: 0 });
      } else {
        const stolen = {};
        for (const res of RES) { const f = res === 'diamonds' ? 0.05 : rand(0.12, 0.22); stolen[res] = Math.floor(S.res[res] * f); S.res[res] -= stolen[res]; k.res[res] = (k.res[res] || 0) + stolen[res]; }
        const tile = Math.random() < 0.5 && transferBorderTile(-2, k.id) >= 0;
        S.stats.raidsLost++;
        report(`🔥 ${k.name} broke through! They plundered ${costText(stolen)}${tile ? ' and seized a border hex' : ''}.`, 'bad', lost);
        k.power += enemyArmyPower(r.right, a.hall);
        shake(12);
      }
    } }, offline);
}

/* ---------- diplomacy ---------- */
const DIPLO = {
  gift(k) { if (!pay({ gold: 200 })) return toast('Not enough gold', 'bad'); k.relation = Math.min(100, k.relation + 8 * (1 + 0.5 * R('diplomacy'))); toast(`${k.ruler} appreciates your gift`, 'good'); },
  treaty(k) {
    if (k.atWar) return toast('Make peace first', 'bad');
    if (k.relation < 10) return toast(`${k.ruler} does not trust you enough (relation 10+)`, 'bad');
    if (!pay({ gold: 400 })) return toast('A treaty costs 🪙400', 'bad');
    k.treaty = 1200; k.relation += 5; log(`Non-aggression treaty signed with ${k.name} (20 min).`, 'good'); toast(`🕊️ Treaty signed with ${k.name}`, 'good');
  },
  pact(k) {
    if (k.relation < 35) return toast(`${k.ruler} wants better relations first (35+)`, 'bad');
    k.tradePact = !k.tradePact; toast(k.tradePact ? `⚖️ Trade pact with ${k.name}: +5% gold` : `Trade pact with ${k.name} ended`, k.tradePact ? 'good' : '');
    if (!k.tradePact) k.relation -= 10;
  },
  tribute(k) {
    if (totalPower() > 1.4 * (k.power + k.defense)) {
      const g = Math.floor(k.res.gold * 0.2); k.res.gold -= g; gain({ gold: g }); k.relation -= 20;
      log(`${k.name} paid you 🪙${fmt(g)} in tribute.`, 'good'); toast(`${k.ruler} grudgingly pays 🪙${fmt(g)}`, 'good');
    } else { k.relation -= 10; toast(`${k.ruler} laughs at your demand`, 'bad'); if (k.personality === 'aggressive' && Math.random() < 0.4) DIPLO.war(k, true); }
  },
  war(k, theyDeclared) {
    k.atWar = true; k.treaty = 0; k.tradePact = false; k.relation = -80;
    S.kingdoms.forEach((o) => { if (o !== k && o.allianceId && o.allianceId === k.allianceId) o.relation -= 15; });
    log(theyDeclared ? `${k.name} declared war on you!` : `You declared war on ${k.name}.`, 'bad'); toast(`⚔️ War with ${k.name}!`, 'bad');
  },
  peace(k) {
    const cost = { gold: 400 * k.hall };
    if (!pay(cost)) return toast(`Peace costs 🪙${cost.gold}`, 'bad');
    k.atWar = false; k.relation = -20; log(`Peace made with ${k.name}.`, 'good'); toast(`🕊️ Peace with ${k.name}`, 'good');
  },
};

/* ---------- collisions between hostile forces ---------- */
const crossing = (a, b) => a.path.length && b.path.length && a.path[0] === b.at && b.path[0] === a.at;
function checkEncounters(offline) {
  for (const a of [...S.aiArmies]) {
    const hostile = a.kind === 'raid' || hostileToPlayer(S.kingdoms[a.kid]);
    if (!hostile || a.kind === 'home') continue;
    const d = S.divisions.find((x) => x.status !== 'fighting' && (x.at === a.at || crossing(x, a)) && !(x.at === S.world.capital && a.at === S.world.capital));
    if (!d) continue;
    const k = S.kingdoms[a.kid];
    S.aiArmies = S.aiArmies.filter((x) => x !== a);
    d.status = 'fighting';
    fight({ kind: 'land', title: `⚔️ ${d.name} intercepts ${k.name}'s army`, left: playerSide(d.name, d.color, d.units, d.general),
      right: { name: k.name, color: k.color, units: a.units, stats: (u) => enemyUnitStats(u, a.hall) },
      onEnd: (r) => {
        consumeBoosts();
        d.status = d.path.length ? 'moving' : 'idle';
        const lost = applyCasualties(d.units, r.left, COMBAT_UNITS);
        k.relation -= 5;
        if (r.win) { S.stats.battlesWon++; gain({ gold: 150 * a.hall }); report(`⚔️ ${d.name} destroyed ${k.name}'s army in the field!`, 'good', lost); }
        else {
          S.stats.battlesLost++;
          report(`⚔️ ${k.name}'s army broke through ${d.name}.`, 'bad', lost);
          if (armyHousing(r.right) > 0) S.aiArmies.push({ ...a, units: r.right });
        }
        removeDivisionIfEmpty(d);
      } }, offline);
  }
  for (const e of [...S.aiFleets]) {
    if (!aiFleetHostile(e)) continue;
    const f = S.fleets.find((x) => x.status !== 'fighting' && WG.dist(x.at, e.at) <= 1);
    if (!f) continue;
    const pirate = e.owner === 'pirate', name = pirate ? 'Pirates' : `${S.kingdoms[e.owner].name} navy`;
    S.aiFleets = S.aiFleets.filter((x) => x !== e);
    f.status = 'fighting';
    fight({ kind: 'naval', title: `⚓ ${f.name} engages ${name}`, left: playerSide(f.name, '#f2c14e', f.ships, f.general, true),
      right: { name, color: pirate ? '#222' : S.kingdoms[e.owner].color, units: e.ships, stats: (t) => enemyShipStats(t, e.hall), pirate },
      onEnd: (r) => {
        consumeBoosts();
        f.status = f.path.length ? 'moving' : 'idle';
        const lost = applyCasualties(f.ships, r.left, SHIP_TYPES);
        if (!pirate) S.kingdoms[e.owner].relation -= 10;
        if (r.win) { S.stats.navalWon++; const loot = { gold: Math.round(enemyFleetPower(e.ships, e.hall) * 1.5) }; gain(loot); report(`⚓ ${f.name} defeated the ${name}! +${costText(loot)}.`, 'good', lost); }
        else { S.stats.navalLost++; report(`⚓ ${f.name} lost to the ${name}.`, 'bad', lost); if (shipCount(r.right)) S.aiFleets.push({ ...e, ships: r.right }); }
        removeFleetIfEmpty(f);
      } }, offline);
  }
}

/* ---------- the master step ---------- */
function onPlayerEnter(ent) {
  reveal(ent.at, (isFleet(ent) ? 2 : ent.units.scout > 0 ? 2 : 1) + visionBonus());
  // Interception/hunt orders re-target a moving enemy each hex.
  const o = ent.order;
  if (o && (o.type === 'intercept' || o.type === 'hunt')) {
    const tgt = (o.type === 'intercept' ? S.aiArmies : S.aiFleets).find((x) => x.id === o.target);
    if (!tgt) { ent.path = []; return; }
    const p = planPath(ent, tgt.at);
    if (p) ent.path = p;
  }
}
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
    if (b.queue) stepQueue(b, dt);
    if (b.research) stepResearch(b, dt);
  }
  for (const m of S.missions) { m.left -= dt; if (m.left <= 0) completeScout(m); }
  S.missions = S.missions.filter((m) => m.left > 0);
  S.shield = Math.max(0, S.shield - dt);
  S.winds = Math.max(0, S.winds - dt);
  S.pirateBlockade = Math.max(0, (S.pirateBlockade || 0) - dt);
  for (const k of S.kingdoms) if (k.treaty > 0) k.treaty = Math.max(0, k.treaty - dt);

  for (const d of [...S.divisions]) if (advance(d, dt, divisionSpeed(d), divisionCost(d), HEX_TIME_LAND, onPlayerEnter)) arrive(d);
  for (const f of [...S.fleets]) if (advance(f, dt, fleetSpeed(f), fleetCost, HEX_TIME_SEA, onPlayerEnter)) arrive(f);
  stepAiArmies(dt, offline);
  stepAiFleets(dt);
  checkEncounters(offline);

  S.aiTimer -= dt;
  while (S.aiTimer <= 0) { aiTurn(offline); S.aiTimer += AI_TICK; }
  if (!offline && S.started) {
    S.raidTimer -= dt;
    if (S.raidTimer <= 0) {
      scheduleRaid();
      const c = raidCandidates();
      if (c.length && (hallLevel() >= 2 || S.time > 900) && !S.aiArmies.some((a) => a.kind === 'raid')) {
        const k = S.kingdoms[+weighted(Object.fromEntries(c.map((x) => [x.id, x.power * (1 + Math.max(0, -x.relation) / 25) * (x.atWar ? 3 : 1)])))];
        launchRaid(k);
      }
    }
    S.pirateTimer -= dt;
    if (S.pirateTimer <= 0) { S.pirateTimer = rand(360, 600); spawnPirates(); }
  }
}
