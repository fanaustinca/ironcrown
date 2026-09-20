/* ==========================================================================
   Battles are fought ON the world map, around the contested hex, between any
   number of TEAMS (the player + allies, each AI kingdom or alliance, pirates…).
   A hostility matrix decides who fights whom, so 3-way battles and coalitions
   work naturally. Each team has groups (divisions, armies, garrisons) that keep
   a formation; the player commands their own groups live.

   cfg = { kind: 'land'|'naval', title, hex, holder?: teamId (wins on timeout), onEnd(r),
           teams: [{ id, name, color, player?, pirate?, groups: [{ key, name, units, stats, formation, stance, target, ref, ally? }],
                     towers?: [{ type, level, hex?, hpMult?, res? }] }],
           hostile(idA, idB) → bool }
   Towers are the real buildings standing on the map: each one keeps its type and its
   hex, so a battle is fought across the actual landscape and towers can duel towers.
   r   = { win, teams: { [id]: { alive, groups: [{ key, survivors }], towersLeft, towersStart } } }
   ========================================================================== */
'use strict';

const BW = 960, BH = 520, BDT = 1 / 30, BATTLE_LIMIT = 150;
const BSC = (7 * 30 * SQ3) / BW;           // battlefield units → world pixels (≈ 19 map hexes wide)
const TEAM_SPOTS = { 1: [[480, 260]], 2: [[190, 260], [770, 260]], 3: [[190, 260], [760, 110], [760, 410]], 4: [[190, 260], [770, 260], [480, 70], [480, 450]] };

const ROLE = (u, naval) => (naval ? (SHIPS[u].range > 100 ? 'ranged' : 'melee') : u === 'archer' ? 'ranged' : u === 'catapult' ? 'siege' : u === 'horseman' ? 'cavalry' : 'melee');
// Formation slot offsets (facing +x) for a list of squads.
function formationSlots(form, squads) {
  const out = new Map();
  const by = (roles) => squads.filter((q) => roles.includes(q.role));
  const rows = (list, x0, sp, perRow, back) => list.forEach((q, k) => {
    const r = Math.floor(k / perRow), n = Math.min(perRow, list.length - r * perRow), p = k % perRow;
    out.set(q, [x0 - r * back, (p - (n - 1) / 2) * sp]);
  });
  if (form === 'line') {
    rows(by(['melee']), 30, 22, 14, 22); rows(by(['ranged']), -34, 22, 14, 20); rows(by(['siege']), -100, 30, 10, 26);
    const cav = by(['cavalry']), half = Math.min(14, Math.max(by(['melee']).length, by(['ranged']).length)) * 11 + 34;
    cav.forEach((q, k) => out.set(q, [20 - Math.floor(k / 2 / 6) * 24, (k % 2 ? 1 : -1) * (half + (Math.floor(k / 2) % 6) * 20)]));
  } else if (form === 'wedge') {
    const order = by(['cavalry']).concat(by(['melee']), by(['ranged']), by(['siege']));
    order.forEach((q, k) => { const r = Math.floor((Math.sqrt(8 * k + 1) - 1) / 2), p = k - (r * (r + 1)) / 2; out.set(q, [50 - r * 22, (p - r / 2) * 24]); });
  } else if (form === 'square') {
    const n = squads.length, side = Math.ceil(Math.sqrt(n)), cells = [];
    for (let i = 0; i < side * side; i++) cells.push([((i % side) - (side - 1) / 2) * 19, (Math.floor(i / side) - (side - 1) / 2) * 19]);
    cells.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    by(['ranged', 'siege']).concat(by(['melee', 'cavalry'])).forEach((q, k) => out.set(q, cells[k]));
  } else {
    const cols = Math.ceil(Math.sqrt(squads.length * 1.4));
    squads.forEach((q, k) => out.set(q, [((k % cols) - (cols - 1) / 2) * 44 + (hash2(k, 3) - 0.5) * 16, (Math.floor(k / cols) - (Math.ceil(squads.length / cols) - 1) / 2) * 44 + (hash2(k, 4) - 0.5) * 16]));
  }
  return out;
}
function aiFormation(mine, theirs) {
  const sumOf = (u, ks) => ks.reduce((s, k) => s + (u[k] || 0), 0);
  if (sumOf(theirs, ['horseman']) > sumOf(theirs, ['archer', 'swordsman', 'pikeman']) * 0.5) return 'square';
  if (sumOf(theirs, ['archer', 'catapult', 'frigate', 'galleon', 'manowar']) > sumOf(theirs, ['swordsman', 'pikeman', 'horseman', 'galley', 'sloop']) * 1.2) return 'skirmish';
  if (sumOf(mine, ['horseman']) > sumOf(mine, ['archer', 'swordsman', 'pikeman']) * 0.4) return 'wedge';
  return 'line';
}
const rot = (dx, dy, th) => [dx * Math.cos(th) - dy * Math.sin(th), dx * Math.sin(th) + dy * Math.cos(th)];

/* ---- the battlefield IS the map ----
   Battlefield coordinates map straight onto world pixels around the contested
   hex, so a force fights from the ground it is standing on and nothing is ever
   shuffled into position. `groundOk` keeps foot soldiers out of the water and
   ships out of the fields, at deployment and while they manoeuvre. */
const toBattle = (cfg, hex) => [BW / 2 + (WG.cx[hex] - WG.cx[cfg.hex]) / BSC, BH / 2 + (WG.cy[hex] - WG.cy[cfg.hex]) / BSC];
const battleHexAt = (b, x, y) => WG.at(WG.cx[b.cfg.hex] + (x - BW / 2) * BSC, WG.cy[b.cfg.hex] + (y - BH / 2) * BSC);
function groundOk(b, x, y) {
  const h = battleHexAt(b, x, y);
  if (h < 0) return false;
  return b.naval ? isWater(h) : isPassable(h);
}
// The closest spot to (x,y) this side can actually stand on.
function nearestGround(b, x, y) {
  if (groundOk(b, x, y)) return [x, y];
  for (let r = 22; r <= 300; r += 22) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + r * 0.7;
    const px = clamp(x + Math.cos(a) * r, 26, BW - 26), py = clamp(y + Math.sin(a) * r, 30, BH - 26);
    if (groundOk(b, px, py)) return [px, py];
  }
  return [x, y];
}
// Pull a position back towards `ax,ay` until it stands on ground this side can hold.
function settleOnGround(b, x, y, ax, ay) {
  if (groundOk(b, x, y)) return [x, y];
  for (let k = 0.75; k > 0.05; k -= 0.25) {
    const sx = ax + (x - ax) * k, sy = ay + (y - ay) * k;
    if (groundOk(b, sx, sy)) return [sx, sy];
  }
  return nearestGround(b, x, y);
}

/* ---- towers ----
   A team's `towers` is a list of the real buildings defending the place. A Fortress
   mans two turrets; anything with a `hex` is placed at that hex's true spot on the
   map, so the fight happens across the landscape as it actually stands. */
function towerSpecs(T) {
  const src = Array.isArray(T.towers) ? T.towers : Array.from({ length: T.towers || 0 }, () => ({ type: 'tower', level: T.towerHall || 1, hpMult: T.towerHp }));
  const out = [];
  for (const sp of src) {
    const st = TOWER_STATS[sp.type] || TOWER_STATS.tower;
    for (let k = 0; k < (st.count || 1); k++) out.push({ ...sp, type: TOWER_STATS[sp.type] ? sp.type : 'tower', turret: k });
  }
  return out;
}
// Battlefield coordinates for each tower, spread out when several share a hex.
function towerPlaces(cfg, specs) {
  const byHex = new Map();
  for (const sp of specs) { const k = sp.hex == null ? 'x' : sp.hex; if (!byHex.has(k)) byHex.set(k, []); byHex.get(k).push(sp); }
  const out = [];
  for (const [k, list] of byHex) {
    if (k === 'x' || cfg.hex == null) { for (const sp of list) out.push({ spec: sp, x: BW / 2, y: BH / 2, real: false }); continue; }
    const cx = BW / 2 + (WG.cx[k] - WG.cx[cfg.hex]) / BSC, cy = BH / 2 + (WG.cy[k] - WG.cy[cfg.hex]) / BSC;
    list.forEach((sp, i) => {
      const a = (i / Math.max(1, list.length)) * Math.PI * 2 + hash2(k, 5) * 6.283, rr = list.length > 1 ? 16 : 0;
      out.push({ spec: sp, x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, real: true });
    });
  }
  return out;
}

const Battles = {
  list: [], focus: null, nextId: 1,

  start(cfg, watch) {
    const b = this.create(cfg);
    if (!watch) { let n = 0; while (!b.done && n++ < 30000) this.tick(b, BDT); return b; }
    b.watch = true;
    this.list.push(b);
    this.focus = b.id;
    if (SETTINGS.focusBattles) this.focusCam(b);
    toast(`⚔️ ${b.cfg.title} — command your troops on the map!`, 'bad');
    UI.panelDirty = true;
    return b;
  },
  focusCam(b) { const c = CAM; c.x = WG.cx[b.cfg.hex]; c.y = WG.cy[b.cfg.hex]; c.z = clamp(CW / (BW * BSC * 1.08), c.minZ, c.maxZ); c.clamp(); },
  get(id) { return this.list.find((b) => b.id === id); },
  playerTeam(b) { return b.teams.findIndex((t) => t.player); },

  create(cfg) {
    const naval = cfg.kind === 'naval', table = naval ? SHIPS : UNITS;
    const usable = (u) => Object.keys(u).some((k) => table[k] && u[k] > 0 && k !== 'scout' && k !== 'seaman');
    // player team first so it takes the left side
    const teams = cfg.teams.map((t) => ({ ...t, towers: towerSpecs(t), groups: t.groups.filter((g) => usable(g.units)) })).filter((t) => t.groups.length || t.towers.length)
      .sort((a, c) => (c.player ? 1 : 0) - (a.player ? 1 : 0));
    const b = { id: this.nextId++, cfg, naval, t: 0, units: [], towers: [], shots: [], fx: [], groups: [], teams, done: false, result: null, linger: 3 };
    const n = Math.min(4, teams.length), spots = TEAM_SPOTS[Math.max(1, n)] || TEAM_SPOTS[4];
    b.H = teams.map((a, i) => teams.map((c, j) => i !== j && !!cfg.hostile(a.id, c.id)));
    // Towers stand where their buildings stand; every other force stands where it
    // already is. Only a side with no position at all is given a spot.
    for (const T of teams) T.towerPos = towerPlaces(cfg, T.towers);
    const byHex = new Map();
    for (const T of teams) for (const sp of T.groups) {
      if (sp.hex == null) continue;
      const list = byHex.get(sp.hex) || byHex.set(sp.hex, []).get(sp.hex);
      list.push(sp);
    }
    for (const [hex, list] of byHex) {      // several forces on one hex fan out a little
      const [cx, cy] = toBattle(cfg, hex);
      list.forEach((sp, i) => {
        const a = (i / list.length) * Math.PI * 2, r = list.length > 1 ? 26 : 0;
        sp.bx = clamp(cx + Math.cos(a) * r, 40, BW - 40); sp.by = clamp(cy + Math.sin(a) * r, 40, BH - 40);
      });
    }
    const pool = spots.slice();
    for (const T of teams) {
      const placed = T.groups.filter((sp) => sp.bx !== undefined).map((sp) => [sp.bx, sp.by]).concat(T.towerPos.map((p) => [p.x, p.y]));
      if (placed.length) { T.ax = placed.reduce((a, p) => a + p[0], 0) / placed.length; T.ay = placed.reduce((a, p) => a + p[1], 0) / placed.length; }
      else { const [x, y] = pool.shift() || [BW / 2, BH / 2]; [T.ax, T.ay] = nearestGround(b, x, y); }
      T.ax = clamp(T.ax, 60, BW - 60); T.ay = clamp(T.ay, 60, BH - 60);
      [T.ax, T.ay] = nearestGround(b, T.ax, T.ay);
    }
    teams.forEach((T, ti) => {        // each side faces the enemies it can see
      let hx = 0, hy = 0, c = 0;
      teams.forEach((o, oi) => { if (b.H[ti][oi]) { hx += o.ax; hy += o.ay; c++; } });
      T.face = (c ? Math.atan2(hy / c - T.ay, hx / c - T.ax) : Math.atan2(BH / 2 - T.ay, BW / 2 - T.ax)) || 0;
      if (n === 1) T.face = 0;
    });
    teams.forEach((T, ti) => {
      const perp = T.face + Math.PI / 2, G = T.groups.length, spacing = Math.min(150, (BH - 120) / Math.max(1, G));
      const allFoe = {};
      teams.forEach((o, oi) => { if (b.H[ti][oi]) o.groups.forEach((g) => { for (const [k, v] of Object.entries(g.units)) allFoe[k] = (allFoe[k] || 0) + v; }); });
      const total = T.groups.reduce((s2, g) => s2 + Object.entries(g.units).reduce((a, [k, v]) => a + (table[k] ? v : 0), 0), 0);
      const gsz = Math.max(1, Math.ceil(total / 64));
      T.groups.forEach((sp, gidx) => {
        const off = (gidx - (G - 1) / 2) * spacing;
        const gx = sp.bx !== undefined ? sp.bx : T.ax + Math.cos(perp) * off;
        const gy = sp.by !== undefined ? sp.by : T.ay + Math.sin(perp) * off;
        const mine = T.player && !sp.ally;
        const Gr = { gi: b.groups.length, team: ti, key: sp.key, name: sp.name, ref: sp.ref || null, ally: !!sp.ally,
          formation: sp.formation || (mine ? 'line' : aiFormation(sp.units, allFoe)), stance: sp.stance || (T.towerPos.length ? 'hold' : 'advance'), target: sp.target || 'nearest',
          ax: gx, ay: gy, face: T.face, start: {} };
        const squads = [];
        for (const k of Object.keys(sp.units)) {
          if (!table[k] || !(sp.units[k] > 0) || k === 'scout' || k === 'seaman') continue;
          Gr.start[k] = sp.units[k];
          const st = sp.stats(k);
          for (let left = sp.units[k]; left > 0; left -= gsz) {
            const c = Math.min(gsz, left);
            squads.push({ team: ti, g: Gr.gi, u: k, role: ROLE(k, naval), naval, count: c, unitHp: st.hp, atk: st.atk, hp: st.hp * c, max: st.hp * c,
              speed: st.speed * (naval ? 30 : 42), range: st.range, cd: Math.random() * 0.8, target: null, retarget: 0, dead: false, escaped: false,
              face: Math.cos(T.face) >= 0 ? 1 : -1, walk: Math.random() * 6, r: naval ? 16 : k === 'horseman' || k === 'catapult' ? 10 : 7, hit: 0, vs: table[k].vs || {}, splash: table[k].splash });
          }
        }
        Gr.slots = formationSlots(Gr.formation, squads);
        for (const q of squads) {
          const [dx, dy] = rot(...(Gr.slots.get(q) || [0, 0]), Gr.face);
          const [sx, sy] = settleOnGround(b, clamp(Gr.ax + dx, 10, BW - 10), clamp(Gr.ay + dy, 20, BH - 12), Gr.ax, Gr.ay);
          q.x = sx; q.y = sy;
        }
        b.units.push(...squads);
        b.groups.push(Gr);
      });
      T.towerPos.forEach((p, i) => {
        const sp = p.spec, st = TOWER_STATS[sp.type] || TOWER_STATS.tower, lvl = Math.max(1, sp.level || 1);
        const forti = T.player ? 1 + 0.12 * R('fortification') : 1;
        const hp = st.hp * (1 + 0.35 * (lvl - 1)) * (sp.hpMult || 1) * forti;
        let x = p.x, y = p.y;
        if (!p.real) { const back = 95, spread = T.towerPos.length > 1 ? (i / (T.towerPos.length - 1) - 0.5) * (BH - 180) : 0; x = T.ax - Math.cos(T.face) * back + Math.cos(perp) * spread; y = T.ay - Math.sin(T.face) * back + Math.sin(perp) * spread; }
        b.towers.push({ team: ti, tower: true, type: sp.type, level: lvl, hex: sp.hex, real: p.real, x: clamp(x, 24, BW - 24), y: clamp(y, 50, BH - 16),
          hp, max: hp, atk: st.atk * (1 + 0.3 * (lvl - 1)) * forti, range: st.range, rate: st.rate, shot: st.shot, splash: !!st.splash, siege: !!st.siege,
          cd: Math.random(), cannon: st.shot !== 'arrow', dead: false, r: 16 });
      });
      T.towersStart = T.towerPos.length;
    });
    for (const G of b.groups) if (G.ref) G.ref.status = 'fighting';
    return b;
  },

  setFormation(b, gi, f) { const G = b.groups[gi]; G.formation = f; G.slots = formationSlots(f, b.units.filter((q) => q.g === gi && !q.dead && !q.escaped)); if (G.ref) G.ref.formation = f; },
  setStance(b, gi, st) { const G = b.groups[gi]; G.stance = st; if (G.ref) G.ref.stance = st; },
  setTarget(b, gi, t) { const G = b.groups[gi]; G.target = t; if (G.ref) G.ref.target = t; b.units.forEach((q) => { if (q.g === gi) q.retarget = 0; }); },
  active(b, team) { return b.units.filter((x) => !x.dead && !x.escaped && x.team === team); },
  foesOf(b, team) { return b.units.filter((e) => !e.dead && !e.escaped && b.H[team][e.team]); },

  pickTarget(b, a, G, radius) {
    let best = null, bs = 1e9;
    const pri = G.target;
    for (const e of b.units) {
      if (e.dead || e.escaped || !b.H[a.team][e.team]) continue;
      const d = dist(a.x, a.y, e.x, e.y);
      if (d > radius) continue;
      let sc = d;
      if (pri === 'weakest') sc = e.hp + d * 0.5;
      else if (pri === 'ranged' && (e.role === 'ranged' || e.role === 'siege')) sc = d - 400;
      else if (pri === 'cavalry' && e.role === 'cavalry') sc = d - 400;
      if (sc < bs) { bs = sc; best = e; }
    }
    for (const t of b.towers) {
      if (t.dead || !b.H[a.team][t.team]) continue;
      const d = dist(a.x, a.y, t.x, t.y);
      if (d > radius) continue;
      const sc = pri === 'towers' || a.splash ? d - 500 : d + 60;
      if (sc < bs) { bs = sc; best = t; }
    }
    return best;
  },

  tick(b, dt) {
    if (b.done) return;
    b.t += dt;
    for (const G of b.groups) {
      const mine = b.units.filter((q) => q.g === G.gi && !q.dead && !q.escaped);
      if (!mine.length) continue;
      const F = FORMATIONS[G.formation], spd = Math.min(...mine.map((q) => q.speed)) * F.speed * 0.85;
      if (G.stance === 'retreat') { const rx = G.ax - Math.cos(G.face) * spd * 1.15 * dt, ry = G.ay - Math.sin(G.face) * spd * 1.15 * dt; if (groundOk(b, rx, ry)) { G.ax = rx; G.ay = ry; } continue; }
      if (G.stance !== 'advance') continue;
      const foes = this.foesOf(b, G.team).concat(b.towers.filter((t) => !t.dead && b.H[G.team][t.team]));
      if (!foes.length) continue;
      let nearest = 1e9, cx = 0, cy = 0;
      for (const e of foes) { cx += e.x; cy += e.y; nearest = Math.min(nearest, dist(G.ax, G.ay, e.x, e.y)); }
      cx /= foes.length; cy /= foes.length;
      G.face = Math.atan2(cy - G.ay, cx - G.ax);
      if (nearest > 100) {
        const d = dist(G.ax, G.ay, cx, cy) || 1, nx = G.ax + ((cx - G.ax) / d) * spd * dt, ny = G.ay + ((cy - G.ay) / d) * spd * dt;
        if (groundOk(b, nx, ny)) { G.ax = nx; G.ay = ny; }               // never advance into the sea
        else if (groundOk(b, nx, G.ay)) G.ax = nx;
        else if (groundOk(b, G.ax, ny)) G.ay = ny;
      }
    }
    const all = b.units;
    // spatial grid for cheap neighbour (separation) lookups
    const grid = new Map(), cell = 32, keyOf = (x, y) => ((x / cell) | 0) * 4096 + ((y / cell) | 0);
    for (const o of all) { if (o.dead || o.escaped) continue; const k = keyOf(o.x + 100, o.y + 100); let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(o); }
    const near = (a) => { const out = [], cx = ((a.x + 100) / cell) | 0, cy = ((a.y + 100) / cell) | 0; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const c = grid.get((cx + dx) * 4096 + cy + dy); if (c) out.push(...c); } return out; };
    for (const a of all) {
      if (a.dead || a.escaped) continue;
      const G = b.groups[a.g], F = FORMATIONS[G.formation];
      const [sx, sy] = rot(...(G.slots.get(a) || [0, 0]), G.face);
      let goalX = G.ax + sx, goalY = G.ay + sy, t = null;
      if (G.stance === 'retreat') {
        if (a.x < 4 || a.x > BW - 4 || a.y < 8 || a.y > BH - 4) { a.escaped = true; continue; }
        goalX = a.x - Math.cos(G.face) * 200; goalY = a.y - Math.sin(G.face) * 200;
      } else {
        const radius = G.stance === 'charge' ? 2000 : G.stance === 'hold' ? a.range + (a.range > 40 ? 10 : 34) : a.range + 110;
        a.retarget -= dt;
        if (!a.target || a.target.dead || a.target.escaped || a.retarget <= 0 || dist(a.x, a.y, a.target.x, a.target.y) > radius + 40) { a.retarget = 0.4; a.target = this.pickTarget(b, a, G, radius); }
        t = a.target;
      }
      if (t) {
        const d = dist(a.x, a.y, t.x, t.y);
        a.face = t.x >= a.x ? 1 : -1;
        if (d <= a.range + t.r) {
          a.cd -= dt;
          if (a.cd <= 0) {
            const alive = Math.ceil(a.hp / a.unitHp), ranged = a.range > 40;
            const tf = t.tower ? null : FORMATIONS[b.groups[t.g].formation];
            let mult = (t.tower ? a.vs.tower || 1 : a.vs[t.u] || 1) * (ranged ? F.ranged : F.melee);
            if (tf) mult *= ranged || a.splash ? tf.takeRanged : tf.takeMelee * (b.groups[t.g].formation === 'square' && a.u === 'horseman' ? 0.8 : 1);
            const dmg = a.atk * alive * mult * rand(0.8, 1.2);
            if (ranged) {
              a.cd = a.splash ? 2.6 : a.naval ? 1.8 : 1.2;
              const kind = a.splash ? 'rock' : a.naval && a.range > 100 ? 'ball' : 'arrow';
              b.shots.push({ x: a.x, y: a.y - 8, t, dmg, v: kind === 'arrow' ? 420 : 320, kind, team: a.team, splash: a.splash || kind === 'ball' });
            } else { a.cd = 1.0; this.hurt(b, t, dmg); if (b.watch) b.fx.push({ kind: 'slash', x: (a.x + t.x) / 2, y: (a.y + t.y) / 2 - 6, life: 0.25, max: 0.25, face: a.face }); a.hit = 0.15; }
          }
          continue;
        }
        goalX = t.x; goalY = t.y;
      }
      const d = dist(a.x, a.y, goalX, goalY);
      if (d > 2) {
        const sp = a.speed * F.speed * dt * (G.stance === 'retreat' ? 1.15 : 1);
        let vx = ((goalX - a.x) / d) * Math.min(sp, d), vy = ((goalY - a.y) / d) * Math.min(sp, d);
        const sep = a.naval ? 28 : 12;
        for (const o of near(a)) {
          if (o === a || o.dead || o.escaped || Math.abs(o.x - a.x) > sep || Math.abs(o.y - a.y) > sep) continue;
          const od = dist(a.x, a.y, o.x, o.y) || 1;
          if (od < sep) { vx += ((a.x - o.x) / od) * sp * 0.5; vy += ((a.y - o.y) / od) * sp * 0.5; }
        }
        const nx = clamp(a.x + vx, -60, BW + 60), ny = clamp(a.y + vy, -40, BH + 40);
        // Soldiers keep their feet on land and ships stay afloat, whatever the order.
        if (G.stance === 'retreat' || groundOk(b, nx, ny)) { a.x = nx; a.y = ny; }
        else if (groundOk(b, nx, a.y)) a.x = nx;
        else if (groundOk(b, a.x, ny)) a.y = ny;
        a.walk += dt * a.speed * 0.25;
      }
      if (a.hit > 0) a.hit -= dt;
    }
    for (const tw of b.towers) {
      if (tw.dead) continue;
      tw.cd -= dt;
      if (tw.cd > 0) continue;
      // Towers shoot at whatever is in range — enemy troops, and enemy towers. Cannons and
      // spires prefer to knock the other side's stonework down first.
      let best = null, bs = 1e9;
      for (const e of all) { if (e.dead || e.escaped || !b.H[tw.team][e.team]) continue; const d = dist(tw.x, tw.y, e.x, e.y); if (d <= tw.range && d < bs) { bs = d; best = e; } }
      for (const o of b.towers) {
        if (o === tw || o.dead || !b.H[tw.team][o.team]) continue;
        const d = dist(tw.x, tw.y, o.x, o.y);
        if (d > tw.range) continue;
        const sc = tw.siege ? d - 400 : d + 90;
        if (sc < bs) { bs = sc; best = o; }
      }
      if (!best) continue;
      tw.cd = tw.rate;
      const soft = best.tower ? 1.15 : (1 + 0.03 * Math.min(20, best.count)) * FORMATIONS[b.groups[best.g].formation].takeRanged;
      b.shots.push({ x: tw.x, y: tw.y - 30, t: best, dmg: tw.atk * soft, v: tw.shot === 'arrow' ? 460 : tw.shot === 'bolt' ? 620 : 300, kind: tw.shot, team: tw.team, splash: tw.splash });
    }
    for (const s of b.shots) {
      const d = dist(s.x, s.y, s.t.x, s.t.y), stepLen = s.v * dt;
      if (d <= stepLen || s.t.dead || s.t.escaped) {
        if (!s.t.dead && !s.t.escaped) {
          this.hurt(b, s.t, s.dmg);
          if (s.splash) {
            if (b.watch) b.fx.push({ kind: b.naval && !s.t.tower ? 'splash' : 'boom', x: s.t.x, y: s.t.y, life: 0.45, max: 0.45 });
            for (const o of all) if (o !== s.t && !o.dead && !o.escaped && o.team === s.t.team && dist(o.x, o.y, s.t.x, s.t.y) < 28) this.hurt(b, o, s.dmg * 0.4 * FORMATIONS[b.groups[o.g].formation].takeRanged);
            for (const o of b.towers) if (o !== s.t && !o.dead && o.team === s.t.team && dist(o.x, o.y, s.t.x, s.t.y) < 26) this.hurt(b, o, s.dmg * 0.3);
          }
        }
        s.gone = true;
      } else { s.x += ((s.t.x - s.x) / d) * stepLen; s.y += ((s.t.y - s.y) / d) * stepLen; }
    }
    b.shots = b.shots.filter((s) => !s.gone);
    if (b.watch) { for (const f of b.fx) { f.life -= dt; if (f.vy !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 200 * dt; } } b.fx = b.fx.filter((f) => f.life > 0); }
    const alive = b.teams.map((T, ti) => this.active(b, ti).length + b.towers.filter((x) => !x.dead && x.team === ti).length > 0);
    let fighting = false;
    for (let i = 0; i < alive.length && !fighting; i++) for (let j = 0; j < alive.length; j++) if (alive[i] && alive[j] && b.H[i][j]) { fighting = true; break; }
    if (!fighting || b.t >= BATTLE_LIMIT) this.finish(b, alive, !fighting);
  },

  hurt(b, t, dmg) {
    t.hp -= dmg; t.flash = 0.12;
    if (b.watch && Math.random() < 0.25 && b.fx.length < 220) b.fx.push({ kind: 'num', x: t.x + rand(-6, 6), y: t.y - 16, text: Math.round(dmg), life: 0.7, max: 0.7, team: t.team });
    if (t.hp <= 0 && !t.dead) {
      t.dead = true;
      if (b.watch) {
        const col = t.tower ? '#8b8f99' : b.naval ? '#6b4424' : b.teams[t.team].color;
        for (let i = 0; i < (t.tower ? 16 : 7); i++) b.fx.push({ kind: 'bit', x: t.x, y: t.y - 6, vx: rand(-70, 70), vy: rand(-140, -40), life: 0.8, max: 0.8, color: col });
      }
    }
  },

  finish(b, alive, decisive) {
    b.done = true;
    const surv = (pred) => { const o = {}; for (const a of b.units) if (pred(a) && !a.dead) o[a.u] = (o[a.u] || 0) + Math.min(a.count, Math.ceil(a.hp / a.unitHp)); return o; };
    const teams = {};
    b.teams.forEach((T, ti) => {
      const strong = this.active(b, ti).length > 0 || b.towers.some((x) => !x.dead && x.team === ti);
      teams[T.id] = { alive: strong, groups: b.groups.filter((G) => G.team === ti).map((G) => ({ key: G.key, survivors: surv((a) => a.g === G.gi) })),
        towersLeft: b.towers.filter((x) => !x.dead && x.team === ti).length, towersStart: T.towersStart, held: !decisive && b.cfg.holder === T.id };
    });
    // A team "won" if it's standing and no hostile team is — or it held the field on timeout.
    for (const [ti, T] of b.teams.entries()) {
      const r = teams[T.id];
      r.won = r.alive && (decisive ? !b.teams.some((o, oi) => b.H[ti][oi] && teams[o.id].alive) : b.cfg.holder === T.id || (b.cfg.holder == null && false));
    }
    const pt = b.teams.find((T) => T.player);
    b.result = { teams, win: pt ? teams[pt.id].won : false };
    for (const G of b.groups) if (G.ref && G.ref.status === 'fighting') G.ref.status = G.ref.path && G.ref.path.length ? 'moving' : 'idle';
    try { b.cfg.onEnd && b.cfg.onEnd(b.result); } catch (e) { console.error(e); }
    UI.panelDirty = true;
    if (b.watch) save();
  },

  resolve(id) { const b = this.get(id); if (!b) return; let n = 0; while (!b.done && n++ < 30000) this.tick(b, BDT); b.linger = 0.5; },

  // Hexes whose building is currently standing in a battle — the map layer leaves those to us.
  towerHexes() {
    const out = new Set();
    for (const b of this.list) for (const tw of b.towers) if (tw.real && tw.hex != null && !tw.dead) out.add(tw.hex);
    return out;
  },

  frame(dt) {
    for (const b of this.list) {
      if (!b.done && UI.gameSpeed > 0) { const steps = Math.min(15, Math.max(1, Math.round((dt * UI.gameSpeed) / BDT))); for (let i = 0; i < steps && !b.done; i++) this.tick(b, BDT); }
      else b.linger -= dt;
    }
    const before = this.list.length;
    this.list = this.list.filter((b) => !b.done || b.linger > 0);
    if (this.list.length !== before) { if (!this.get(this.focus)) this.focus = this.list.length ? this.list[this.list.length - 1].id : null; UI.panelDirty = true; }
  },

  draw(g, t) {
    for (const b of this.list) {
      const hx = WG.cx[b.cfg.hex], hy = WG.cy[b.cfg.hex];
      g.save();
      g.translate(hx - (BW / 2) * BSC, hy - (BH / 2) * BSC);
      g.scale(BSC, BSC);
      const grd = g.createRadialGradient(BW / 2, BH / 2, 60, BW / 2, BH / 2, BW * 0.56);
      grd.addColorStop(0, b.naval ? 'rgba(255,255,255,.06)' : 'rgba(110,86,50,.12)'); grd.addColorStop(1, 'rgba(110,86,50,0)');
      g.fillStyle = grd; g.beginPath(); g.ellipse(BW / 2, BH / 2, BW * 0.56, BH * 0.62, 0, 0, 7); g.fill();
      g.strokeStyle = b.done ? 'rgba(255,255,255,.2)' : `rgba(229,83,75,${0.35 + 0.2 * Math.sin(t * 4)})`; g.lineWidth = 3; g.setLineDash([14, 10]);
      g.beginPath(); g.ellipse(BW / 2, BH / 2, BW * 0.55, BH * 0.6, 0, 0, 7); g.stroke(); g.setLineDash([]);
      for (const d of b.units) if (d.dead && !b.naval) { g.fillStyle = 'rgba(60,20,20,.35)'; g.beginPath(); g.ellipse(d.x, d.y + 2, 6, 3, 0, 0, 7); g.fill(); }
      const ents = b.units.filter((u) => !u.dead && !u.escaped).concat(b.towers.filter((x) => !x.dead)).sort((a, c) => a.y - c.y);
      for (const e of ents) {
        const T = b.teams[e.team];
        if (e.tower) { const ty = towerTop(e); drawBattleTower(g, e, t); g.fillStyle = T.color; g.fillRect(e.x - 1, e.y + ty - 14, 2, 14); g.fillRect(e.x + 1, e.y + ty - 14, 8, 5); }
        else if (e.naval) drawShip(g, e.x, e.y, e.u, T.color, e.face, t + e.walk, e.flash > 0, T.pirate);
        else drawSoldier(g, e.x, e.y, e.u, T.color, e.face, e.walk, e.hit > 0, e.flash > 0);
        if (e.flash > 0) e.flash -= 1 / 60;
        if (e.hp < e.max) {
          const w = e.tower || e.naval ? 34 : 18, yy = e.y + (e.tower ? towerTop(e) - 22 : e.naval ? -44 : -26);
          g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(e.x - w / 2, yy, w, 4);
          g.fillStyle = T.player ? '#57c26b' : '#e5534b'; g.fillRect(e.x - w / 2, yy, (w * e.hp) / e.max, 4);
        }
      }
      for (const s of b.shots) {
        if (s.kind === 'ball' || s.kind === 'rock') { g.fillStyle = s.kind === 'rock' ? '#6b6258' : '#222'; g.beginPath(); g.arc(s.x, s.y, s.kind === 'rock' ? 5 : 4, 0, 7); g.fill(); }
        else { const a = Math.atan2(s.t.y - s.y, s.t.x - s.x); g.strokeStyle = b.teams[s.team].player ? '#fff3c4' : '#eee'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - Math.cos(a) * 10, s.y - Math.sin(a) * 10); g.stroke(); }
      }
      for (const f of b.fx) {
        const p = f.life / f.max;
        g.globalAlpha = clamp(p, 0, 1);
        if (f.kind === 'num') { g.fillStyle = b.teams[f.team] && b.teams[f.team].player ? '#fff' : '#ffd2cf'; g.font = 'bold 11px sans-serif'; g.fillText(f.text, f.x, f.y - (1 - p) * 18); }
        else if (f.kind === 'slash') { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(f.x, f.y, 9, -1.2 * f.face, 0.6 * f.face, f.face < 0); g.stroke(); }
        else if (f.kind === 'boom') { g.fillStyle = '#ffb347'; g.beginPath(); g.arc(f.x, f.y, 26 * (1 - p) + 6, 0, 7); g.fill(); }
        else if (f.kind === 'splash') { g.strokeStyle = '#e6f6ff'; g.lineWidth = 2; g.beginPath(); g.arc(f.x, f.y, 24 * (1 - p) + 4, 0, 7); g.stroke(); }
        else if (f.kind === 'bit') { g.fillStyle = f.color; g.fillRect(f.x, f.y, 3, 3); }
        g.globalAlpha = 1;
      }
      // labels: one per player division, one per enemy side (placed at its centre)
      const labels = [];
      for (const G of b.groups) {
        const alive = b.units.filter((q) => q.g === G.gi && !q.dead && !q.escaped);
        if (!alive.length) continue;
        const T = b.teams[G.team];
        if (T.player && !G.ally) labels.push([`${FORMATIONS[G.formation].icon} ${G.name} · ${STANCES[G.stance].name}`, G.ax, G.ay - 40, '#f2c14e']);
        else if (T.player) labels.push([`🤝 ${G.name}`, G.ax, G.ay - 40, '#9fd6a0']);
      }
      b.teams.forEach((T, ti) => {
        if (T.player) return;
        const alive = b.units.filter((q) => q.team === ti && !q.dead && !q.escaped);
        if (!alive.length) return;
        const cx = alive.reduce((a, q) => a + q.x, 0) / alive.length, cy = Math.min(...alive.map((q) => q.y));
        labels.push([`${T.name} (${alive.reduce((a, q) => a + Math.ceil(q.hp / q.unitHp), 0)})`, cx, cy - 34, T.color === '#222' ? '#ccc' : T.color]);
      });
      g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
      for (const [text, lx, ly, col] of labels) {
        const x = clamp(lx, 70, BW - 70), y = clamp(ly, 20, BH - 20), w = g.measureText(text).width + 12;
        g.fillStyle = 'rgba(12,14,20,.8)'; g.fillRect(x - w / 2, y - 14, w, 19); g.fillStyle = col; g.fillText(text, x, y);
      }
      g.textAlign = 'left';
      if (b.done) {
        const pt = b.teams.find((T) => T.player);
        const text = pt ? (b.result.win ? 'Victory!' : 'Defeat') : 'Battle over';
        g.font = 'bold 64px Georgia, serif'; g.textAlign = 'center';
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(text, BW / 2 + 3, BH / 2 + 3);
        g.fillStyle = !pt || b.result.win ? '#f2c14e' : '#e5534b'; g.fillText(text, BW / 2, BH / 2); g.textAlign = 'left';
      }
      g.restore();
    }
  },
};

// Figures are drawn at about half the size they once were: at world scale the
// old ones dwarfed the hexes they stood on.
const SOLDIER_SCALE = 0.5;
function drawSoldier(g, x, y, u, color, face, walk, attacking, flash) {
  if (SOLDIER_SCALE !== 1) {
    g.save(); g.translate(x, y); g.scale(SOLDIER_SCALE, SOLDIER_SCALE);
    drawSoldierArt(g, 0, 0, u, color, face, walk, attacking, flash);
    g.restore();
    return;
  }
  drawSoldierArt(g, x, y, u, color, face, walk, attacking, flash);
}
function drawSoldierArt(g, x, y, u, color, face, walk, attacking, flash) {
  const bob = Math.sin(walk * 6) * 1.2;
  g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(x, y + 2, u === 'horseman' || u === 'catapult' ? 11 : 6, 3, 0, 0, 7); g.fill();
  if (u === 'catapult') {
    g.fillStyle = flash ? '#fff' : '#7a5230'; g.fillRect(x - 10, y - 6, 20, 5);
    g.fillStyle = '#3a2716'; g.beginPath(); g.arc(x - 6, y, 3, 0, 7); g.arc(x + 6, y, 3, 0, 7); g.fill();
    g.strokeStyle = '#5b3d22'; g.lineWidth = 2.5;
    const arm = attacking ? -1.2 : -0.4 + Math.sin(walk) * 0.1;
    g.beginPath(); g.moveTo(x - face * 4, y - 6); g.lineTo(x - face * 4 + Math.cos(arm) * 14 * face, y - 6 + Math.sin(arm) * 14); g.stroke();
    g.fillStyle = color; g.fillRect(x - 2, y - 10, 4, 4);
    return;
  }
  if (u === 'horseman') {
    g.fillStyle = flash ? '#fff' : '#6b4a2f';
    g.beginPath(); g.ellipse(x, y - 6 + bob * 0.5, 11, 5, 0, 0, 7); g.fill();
    g.fillRect(x + face * 8, y - 13 + bob * 0.5, face * 5, 7);
    g.strokeStyle = '#4a321f'; g.lineWidth = 2;
    const l = Math.sin(walk * 10) * 3;
    g.beginPath(); g.moveTo(x - 7, y - 3); g.lineTo(x - 7 + l, y + 2); g.moveTo(x + 7, y - 3); g.lineTo(x + 7 - l, y + 2); g.stroke();
    y -= 8;
  }
  g.fillStyle = flash ? '#fff' : color; g.fillRect(x - 3.5, y - 12 + bob, 7, 9);
  g.fillStyle = flash ? '#fff' : '#f1c9a5'; g.beginPath(); g.arc(x, y - 15 + bob, 3.2, 0, 7); g.fill();
  g.fillStyle = shade(color === '#222' ? '#555555' : color, -0.35); g.fillRect(x - 3.5, y - 18.5 + bob, 7, 2.2);
  g.lineWidth = 1.5; g.strokeStyle = '#ddd'; g.beginPath();
  if (u === 'archer') { g.strokeStyle = '#8b5a2b'; g.arc(x + face * 5, y - 9 + bob, 5, face > 0 ? -1.2 : Math.PI - 1.2, face > 0 ? 1.2 : Math.PI + 1.2); }
  else if (u === 'swordsman') { const sw = attacking ? -0.9 : 0; g.moveTo(x + face * 4, y - 8 + bob); g.lineTo(x + face * (4 + 9 * Math.cos(sw)), y - 12 + bob + 9 * Math.sin(sw)); }
  else if (u === 'pikeman') { g.strokeStyle = '#b9a07a'; g.moveTo(x - face * 6, y - 2 + bob); g.lineTo(x + face * (attacking ? 22 : 18), y - 16 + bob); }
  else { g.moveTo(x + face * 2, y - 6 + bob); g.lineTo(x + face * 16, y - 12 + bob); }
  g.stroke();
  if (u === 'swordsman' || u === 'pikeman') { g.fillStyle = shade(color === '#222' ? '#555555' : color, -0.2); g.fillRect(x - face * 5 - 2, y - 11 + bob, 4, 7); }
}
// How far above its centre a tower's art reaches, so flags and health bars sit on top of it.
const towerTop = (e) => (BUILDINGS[e.type] ? -K_HEX * 1.75 * 0.62 * (ART / BSC) : -48);
// A tower in a battle is drawn as the building it actually is, at the size it has on the map.
function drawBattleTower(g, e, t) {
  if (!BUILDINGS[e.type]) return drawTowerSprite(g, e.x, e.y, e.cannon, e.flash > 0);
  const sc = ART / BSC, sz = K_HEX * 1.75;
  g.save(); g.translate(e.x, e.y); g.scale(sc, sc);
  drawBuilding(g, { id: (e.hex || 1) * 7 + e.level, type: e.type, level: e.level, build: 0 }, -sz / 2, -sz * 0.62, sz, t);
  if (e.flash > 0) { g.globalAlpha = 0.45; g.fillStyle = '#fff'; g.fillRect(-sz / 2, -sz * 0.62, sz, sz * 0.95); g.globalAlpha = 1; }
  g.restore();
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
// Ships for battles and the world map. type decides size & rig.
function drawShip(g, x, y, type, color, face, t, flash, pirate, scale = 1) {
  const sz = { sloop: 0.75, cog: 0.9, galley: 1, frigate: 1.1, galleon: 1.3, manowar: 1.55 }[type] || 1;
  const L = 22 * sz * scale, bob = Math.sin(t * 2) * 1.2 * scale;
  g.save(); g.translate(x, y + bob); g.scale(face, 1);
  g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.ellipse(-L * 0.9, 3 * scale, L * 0.6, 2.5 * scale, 0, 0, 7); g.fill();
  g.fillStyle = flash ? '#fff' : pirate ? '#2b2118' : '#6b4424';
  g.beginPath(); g.moveTo(-L, -4 * scale); g.lineTo(L, -5 * scale); g.lineTo(L * 0.7, 4 * scale); g.lineTo(-L * 0.8, 4 * scale); g.closePath(); g.fill();
  g.fillStyle = pirate ? '#1a140e' : '#4a2f18'; g.fillRect(-L * 0.85, -4 * scale, L * 1.75, 2 * scale);
  if (type === 'galley') { g.strokeStyle = '#3a2716'; g.lineWidth = scale; for (let i = -3; i <= 3; i++) { const a = Math.sin(t * 4 + i) * 2; g.beginPath(); g.moveTo(i * L * 0.2, 2 * scale); g.lineTo(i * L * 0.2 + a * scale, 8 * scale); g.stroke(); } }
  const masts = type === 'galleon' || type === 'manowar' ? 3 : type === 'frigate' ? 2 : 1;
  if (type === 'manowar') { g.fillStyle = '#d9b44a'; g.fillRect(-L * 0.8, -1.5 * scale, L * 1.55, 1.2 * scale); g.fillStyle = '#1a1a1a'; for (let k = -4; k <= 4; k++) { g.fillRect(k * L * 0.17 - scale, -3.2 * scale, 2 * scale, 1.4 * scale); g.fillRect(k * L * 0.17 - scale, 0.4 * scale, 2 * scale, 1.4 * scale); } }
  for (let m = 0; m < masts; m++) {
    const mx = masts === 1 ? 0 : -L * 0.45 + (m * L * 0.9) / (masts - 1), mh = (type === 'sloop' ? 20 : 26) * sz * scale;
    g.fillStyle = '#3a2716'; g.fillRect(mx - 0.8 * scale, -4 * scale - mh, 1.6 * scale, mh);
    g.fillStyle = pirate ? '#1f1f1f' : '#efe6d2';
    g.beginPath(); g.moveTo(mx + scale, -4 * scale - mh + 2 * scale); g.quadraticCurveTo(mx + mh * 0.55 + Math.sin(t * 2) * scale, -4 * scale - mh * 0.55, mx + scale, -6 * scale); g.fill();
    if (m === masts - 1) { g.fillStyle = color === '#222' ? '#111' : color; g.fillRect(mx, -4 * scale - mh - 5 * scale, 7 * scale, 4 * scale); }
  }
  if (pirate) { g.fillStyle = '#fff'; g.beginPath(); g.arc(4 * scale, -18 * sz * scale, 2 * scale, 0, 7); g.fill(); }
  g.restore();
}
