/* ==========================================================================
   Battles are fought ON the world map, around the contested hex.
   Each side is made of groups (one per division/fleet, the garrison, allies…)
   that keep a formation; the player can change every group's formation,
   stance and target priority while the fight runs.

   cfg = { kind: 'land'|'naval', title, hex, defend?, onEnd(r),
           left:  { groups: [{ key, name, units, stats(type), formation, stance, target, ref }], towers?, towerHall?, towerHp? },
           right: { name, color, units, stats(type), towers?, towerHall?, pirate? } }
   r   = { win, groups: [{ key, survivors }], right: survivors, towersLeft, towersStart }
   ========================================================================== */
'use strict';

const BW = 960, BH = 520, BDT = 1 / 30, BATTLE_LIMIT = 150;
const BSC = (7 * W_HEX * SQ3) / BW;        // battlefield units → world pixels

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
    rows(by(['melee']), 30, 22, 16, 22); rows(by(['ranged']), -34, 22, 16, 20); rows(by(['siege']), -100, 30, 10, 26);
    const cav = by(['cavalry']), half = Math.min(16, Math.max(by(['melee']).length, by(['ranged']).length)) * 11 + 34;
    cav.forEach((q, k) => out.set(q, [20 - Math.floor(k / 2 / 6) * 24, (k % 2 ? 1 : -1) * (half + (Math.floor(k / 2) % 6) * 20)]));
  } else if (form === 'wedge') {
    const order = by(['cavalry']).concat(by(['melee']), by(['ranged']), by(['siege']));
    order.forEach((q, k) => { const r = Math.floor((Math.sqrt(8 * k + 1) - 1) / 2), p = k - (r * (r + 1)) / 2; out.set(q, [50 - r * 22, (p - r / 2) * 24]); });
  } else if (form === 'square') {
    const n = squads.length, side = Math.ceil(Math.sqrt(n)), cells = [];
    for (let i = 0; i < side * side; i++) cells.push([((i % side) - (side - 1) / 2) * 19, (Math.floor(i / side) - (side - 1) / 2) * 19]);
    cells.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    const inner = by(['ranged', 'siege']), outer = by(['melee', 'cavalry']);
    inner.concat(outer).forEach((q, k) => out.set(q, cells[k]));
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

const Battles = {
  list: [], focus: null, nextId: 1,

  start(cfg, watch) {
    const b = this.create(cfg);
    if (!watch) { let n = 0; while (!b.done && n++ < 30000) this.tick(b, BDT); return b; }
    b.watch = true;
    this.list.push(b);
    this.focus = b.id;
    if (SETTINGS.focusBattles) { if (UI.view !== 'world') setView('world'); this.focusCam(b); }
    toast(`⚔️ ${b.cfg.title} — command your troops on the map!`, 'bad');
    UI.panelDirty = true;
    return b;
  },
  focusCam(b) {
    const c = CAM.world;
    c.x = WG.cx[b.cfg.hex]; c.y = WG.cy[b.cfg.hex];
    c.z = clamp(CW / (BW * BSC * 1.08), c.minZ, c.maxZ);
    c.clamp();
  },
  get(id) { return this.list.find((b) => b.id === id); },

  create(cfg) {
    const naval = cfg.kind === 'naval', table = naval ? SHIPS : UNITS;
    const b = { id: this.nextId++, cfg, naval, t: 0, units: [], towers: [], shots: [], fx: [], groups: [], done: false, result: null, linger: 3, seed: Math.floor(Math.random() * 1e6) };
    const leftGroups = cfg.left.groups.filter((gr) => Object.keys(gr.units).some((k) => table[k] && gr.units[k] > 0 && k !== 'scout' && k !== 'seaman'));
    const rightUnits = cfg.right.units;
    const allLeft = {};
    leftGroups.forEach((gr) => { for (const [k, v] of Object.entries(gr.units)) allLeft[k] = (allLeft[k] || 0) + v; });
    const rightForm = cfg.right.formation || aiFormation(rightUnits, allLeft);
    const specs = leftGroups.map((gr) => ({ side: 0, ...gr })).concat([{ side: 1, key: 'enemy', name: cfg.right.name, units: rightUnits, stats: cfg.right.stats, formation: rightForm, stance: cfg.right.towers && !cfg.right.attacking ? 'hold' : 'advance', target: 'nearest' }]);
    const leftTotal = leftGroups.reduce((s, gr) => s + Object.values(gr.units).reduce((a, v) => a + v, 0), 0);
    specs.forEach((sp, gi) => {
      const G = { gi, side: sp.side, key: sp.key, name: sp.name, formation: sp.formation || 'line', stance: sp.stance || 'advance', target: sp.target || 'nearest', ref: sp.ref || null,
        ax: sp.side ? BW - 190 : 190, ay: BH / 2, start: {} };
      if (sp.side === 0) G.ay = BH / 2 + (gi - (leftGroups.length - 1) / 2) * Math.min(150, (BH - 120) / Math.max(1, leftGroups.length));
      const types = Object.keys(sp.units).filter((k) => table[k] && sp.units[k] > 0 && k !== 'scout' && k !== 'seaman');
      const total = types.reduce((a, k) => a + sp.units[k], 0);
      const gsz = Math.max(1, Math.ceil((sp.side ? total : leftTotal) / (sp.side ? 60 : 64)));
      const squads = [];
      for (const k of types) {
        G.start[k] = sp.units[k];
        const st = sp.stats(k);
        for (let left = sp.units[k]; left > 0; left -= gsz) {
          const c = Math.min(gsz, left);
          squads.push({ side: sp.side, g: gi, u: k, role: ROLE(k, naval), naval, count: c, unitHp: st.hp, atk: st.atk, hp: st.hp * c, max: st.hp * c,
            speed: st.speed * (naval ? 30 : 42), range: st.range, cd: Math.random() * 0.8, target: null, retarget: 0, dead: false, escaped: false,
            face: sp.side ? -1 : 1, walk: Math.random() * 6, r: naval ? 16 : k === 'horseman' || k === 'catapult' ? 10 : 7, hit: 0, vs: table[k].vs || {}, splash: table[k].splash });
        }
      }
      G.slots = formationSlots(G.formation, squads);
      for (const q of squads) { const [dx, dy] = G.slots.get(q) || [0, 0]; q.x = clamp(G.ax + dx * (sp.side ? -1 : 1), 10, BW - 10); q.y = clamp(G.ay + dy, 20, BH - 12); }
      b.units.push(...squads);
      b.groups.push(G);
    });
    [[cfg.left, 0], [cfg.right, 1]].forEach(([side, s]) => {
      const nt = side.towers || 0, th = side.towerHall || 1;
      for (let i = 0; i < nt; i++) {
        const hp = (260 + th * 70) * (side.towerHp || 1) * (s === 0 ? 1 + 0.12 * R('fortification') : 1);
        b.towers.push({ side: s, tower: true, x: s === 0 ? 60 + (i % 2) * 45 : BW - 105 + (i % 2) * 45, y: nt > 1 ? 80 + (i * (BH - 160)) / (nt - 1) : BH / 2,
          hp, max: hp, atk: (10 + th * 3.5) * (s === 0 ? 1 + 0.12 * R('fortification') : 1), range: 170, cd: Math.random(), cannon: th >= 3 && i % 2 === 1, dead: false, r: 16 });
      }
      b['towersStart' + s] = nt;
    });
    for (const G of b.groups) if (G.ref) G.ref.status = 'fighting';
    return b;
  },

  setFormation(b, gi, f) {
    const G = b.groups[gi];
    G.formation = f;
    G.slots = formationSlots(f, b.units.filter((q) => q.g === gi && !q.dead && !q.escaped));
    if (G.ref) G.ref.formation = f;
  },
  setStance(b, gi, st) { const G = b.groups[gi]; G.stance = st; if (G.ref) G.ref.stance = st; },
  setTarget(b, gi, t) { const G = b.groups[gi]; G.target = t; if (G.ref) G.ref.target = t; b.units.forEach((q) => { if (q.g === gi) q.retarget = 0; }); },

  active(b, side) { return b.units.filter((x) => !x.dead && !x.escaped && x.side === side); },

  pickTarget(b, a, G, radius) {
    let best = null, bs = 1e9;
    const pri = G.target;
    for (const e of b.units) {
      if (e.dead || e.escaped || e.side === a.side) continue;
      const d = dist(a.x, a.y, e.x, e.y);
      if (d > radius) continue;
      let sc = d;
      if (pri === 'weakest') sc = e.hp + d * 0.5;
      else if (pri === 'ranged' && (e.role === 'ranged' || e.role === 'siege')) sc = d - 400;
      else if (pri === 'cavalry' && e.role === 'cavalry') sc = d - 400;
      if (sc < bs) { bs = sc; best = e; }
    }
    for (const t of b.towers) {
      if (t.dead || t.side === a.side) continue;
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
    // group anchors
    for (const G of b.groups) {
      const mine = b.units.filter((q) => q.g === G.gi && !q.dead && !q.escaped);
      if (!mine.length) continue;
      const F = FORMATIONS[G.formation], spd = Math.min(...mine.map((q) => q.speed)) * F.speed * 0.85;
      if (G.stance === 'retreat') { G.ax += (G.side ? 1 : -1) * spd * 1.15 * dt; continue; }
      if (G.stance !== 'advance') continue;
      const foes = b.units.filter((q) => !q.dead && !q.escaped && q.side !== G.side).concat(b.towers.filter((t) => !t.dead && t.side !== G.side));
      if (!foes.length) continue;
      let nearest = 1e9, cx = 0, cy = 0;
      for (const e of foes) { cx += e.x; cy += e.y; nearest = Math.min(nearest, dist(G.ax, G.ay, e.x, e.y)); }
      cx /= foes.length; cy /= foes.length;
      if (nearest > 100) { const d = dist(G.ax, G.ay, cx, cy) || 1; G.ax += ((cx - G.ax) / d) * spd * dt; G.ay += ((cy - G.ay) / d) * spd * dt; }
    }
    const all = b.units;
    for (const a of all) {
      if (a.dead || a.escaped) continue;
      const G = b.groups[a.g], F = FORMATIONS[G.formation];
      const [sx, sy] = G.slots.get(a) || [0, 0];
      const slotX = G.ax + sx * (a.side ? -1 : 1), slotY = G.ay + sy;
      let goalX = slotX, goalY = slotY, t = null;
      if (G.stance === 'retreat') {
        if ((a.side === 0 && a.x < 12) || (a.side === 1 && a.x > BW - 12)) { a.escaped = true; continue; }
        goalX = a.side ? BW + 40 : -40;
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
              b.shots.push({ x: a.x, y: a.y - 8, t, dmg, v: kind === 'arrow' ? 420 : 320, kind, side: a.side, splash: a.splash || kind === 'ball' });
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
        for (const o of all) {
          if (o === a || o.dead || o.escaped || Math.abs(o.x - a.x) > sep || Math.abs(o.y - a.y) > sep) continue;
          const od = dist(a.x, a.y, o.x, o.y) || 1;
          if (od < sep) { vx += ((a.x - o.x) / od) * sp * 0.5; vy += ((a.y - o.y) / od) * sp * 0.5; }
        }
        a.x = clamp(a.x + vx, -60, BW + 60); a.y = clamp(a.y + vy, 16, BH - 10);
        a.walk += dt * a.speed * 0.25;
      }
      if (a.hit > 0) a.hit -= dt;
    }
    for (const tw of b.towers) {
      if (tw.dead) continue;
      tw.cd -= dt;
      if (tw.cd > 0) continue;
      let best = null, bd = tw.range;
      for (const e of all) if (!e.dead && !e.escaped && e.side !== tw.side) { const d = dist(tw.x, tw.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
      if (best) { tw.cd = tw.cannon ? 2.2 : 1.3; b.shots.push({ x: tw.x, y: tw.y - 30, t: best, dmg: tw.atk * (tw.cannon ? 3.2 : 1.6) * (1 + 0.03 * Math.min(20, best.count)) * FORMATIONS[b.groups[best.g].formation].takeRanged, v: tw.cannon ? 300 : 460, kind: tw.cannon ? 'ball' : 'arrow', side: tw.side, splash: tw.cannon }); }
    }
    for (const s of b.shots) {
      const d = dist(s.x, s.y, s.t.x, s.t.y), stepLen = s.v * dt;
      if (d <= stepLen || s.t.dead || s.t.escaped) {
        if (!s.t.dead && !s.t.escaped) {
          this.hurt(b, s.t, s.dmg);
          if (s.splash) {
            if (b.watch) b.fx.push({ kind: b.naval && !s.t.tower ? 'splash' : 'boom', x: s.t.x, y: s.t.y, life: 0.45, max: 0.45 });
            for (const o of all) if (o !== s.t && !o.dead && !o.escaped && o.side === s.t.side && dist(o.x, o.y, s.t.x, s.t.y) < 28) this.hurt(b, o, s.dmg * 0.4 * FORMATIONS[b.groups[o.g].formation].takeRanged);
          }
        }
        s.gone = true;
      } else { s.x += ((s.t.x - s.x) / d) * stepLen; s.y += ((s.t.y - s.y) / d) * stepLen; }
    }
    b.shots = b.shots.filter((s) => !s.gone);
    if (b.watch) { for (const f of b.fx) { f.life -= dt; if (f.vy !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 200 * dt; } } b.fx = b.fx.filter((f) => f.life > 0); }
    const l = this.active(b, 0).length + b.towers.filter((t) => !t.dead && t.side === 0).length;
    const r = this.active(b, 1).length + b.towers.filter((t) => !t.dead && t.side === 1).length;
    if (!l || !r || b.t >= BATTLE_LIMIT) this.finish(b, l > 0 && (r === 0 || (b.cfg.defend && b.t >= BATTLE_LIMIT)));
  },

  hurt(b, t, dmg) {
    t.hp -= dmg; t.flash = 0.12;
    if (b.watch && Math.random() < 0.25 && b.fx.length < 220) b.fx.push({ kind: 'num', x: t.x + rand(-6, 6), y: t.y - 16, text: Math.round(dmg), life: 0.7, max: 0.7, side: t.side });
    if (t.hp <= 0 && !t.dead) {
      t.dead = true;
      if (b.watch) {
        const col = t.tower ? '#8b8f99' : b.naval ? '#6b4424' : t.side ? b.cfg.right.color : '#f2c14e';
        for (let i = 0; i < (t.tower ? 16 : 7); i++) b.fx.push({ kind: 'bit', x: t.x, y: t.y - 6, vx: rand(-70, 70), vy: rand(-140, -40), life: 0.8, max: 0.8, color: col });
      }
    }
  },

  finish(b, win) {
    b.done = true;
    const surv = (pred) => { const o = {}; for (const a of b.units) if (pred(a) && !a.dead) o[a.u] = (o[a.u] || 0) + Math.min(a.count, Math.ceil(a.hp / a.unitHp)); return o; };
    b.result = { win, groups: b.groups.filter((G) => G.side === 0).map((G) => ({ key: G.key, survivors: surv((a) => a.g === G.gi) })),
      right: surv((a) => a.side === 1), towersLeft: b.towers.filter((t) => !t.dead && t.side === 1).length, towersStart: b.towersStart1 };
    for (const G of b.groups) if (G.ref && G.ref.status === 'fighting') G.ref.status = G.ref.path && G.ref.path.length ? 'moving' : 'idle';
    try { b.cfg.onEnd && b.cfg.onEnd(b.result); } catch (e) { console.error(e); }
    UI.panelDirty = true;
    if (b.watch) save();
  },

  resolve(id) { const b = this.get(id); if (!b) return; let n = 0; while (!b.done && n++ < 30000) this.tick(b, BDT); b.linger = 0.5; },

  frame(dt) {
    for (const b of this.list) {
      if (!b.done) { const steps = Math.min(15, Math.max(1, Math.round((dt * UI.gameSpeed) / BDT))); for (let i = 0; i < steps && !b.done; i++) this.tick(b, BDT); }
      else b.linger -= dt;
    }
    const before = this.list.length;
    this.list = this.list.filter((b) => !b.done || b.linger > 0);
    if (this.list.length !== before) { if (!this.get(this.focus)) this.focus = this.list.length ? this.list[this.list.length - 1].id : null; UI.panelDirty = true; }
  },

  /* ---- drawn inside the world camera transform ---- */
  draw(g, t) {
    for (const b of this.list) {
      const hx = WG.cx[b.cfg.hex], hy = WG.cy[b.cfg.hex];
      g.save();
      g.translate(hx - (BW / 2) * BSC, hy - (BH / 2) * BSC);
      g.scale(BSC, BSC);
      // trampled battlefield
      const grd = g.createRadialGradient(BW / 2, BH / 2, 60, BW / 2, BH / 2, BW * 0.56);
      grd.addColorStop(0, b.naval ? 'rgba(255,255,255,.08)' : 'rgba(110,86,50,.32)'); grd.addColorStop(1, 'rgba(110,86,50,0)');
      g.fillStyle = grd; g.beginPath(); g.ellipse(BW / 2, BH / 2, BW * 0.56, BH * 0.62, 0, 0, 7); g.fill();
      g.strokeStyle = b.done ? 'rgba(255,255,255,.2)' : `rgba(229,83,75,${0.35 + 0.2 * Math.sin(t * 4)})`; g.lineWidth = 3; g.setLineDash([14, 10]);
      g.beginPath(); g.ellipse(BW / 2, BH / 2, BW * 0.55, BH * 0.6, 0, 0, 7); g.stroke(); g.setLineDash([]);
      for (const d of b.units) if (d.dead && !b.naval) { g.fillStyle = 'rgba(60,20,20,.35)'; g.beginPath(); g.ellipse(d.x, d.y + 2, 6, 3, 0, 0, 7); g.fill(); }
      const colors = ['#f2c14e', b.cfg.right.color];
      const ents = b.units.filter((u) => !u.dead && !u.escaped).concat(b.towers.filter((x) => !x.dead)).sort((a, c) => a.y - c.y);
      for (const e of ents) {
        if (e.tower) drawTowerSprite(g, e.x, e.y, e.cannon, e.flash > 0);
        else if (e.naval) drawShip(g, e.x, e.y, e.u, colors[e.side], e.face, t + e.walk, e.flash > 0, e.side && b.cfg.right.pirate);
        else drawSoldier(g, e.x, e.y, e.u, colors[e.side], e.face, e.walk, e.hit > 0, e.flash > 0);
        if (e.flash > 0) e.flash -= 1 / 60;
        if (e.hp < e.max) {
          const w = e.tower || e.naval ? 34 : 18, yy = e.y - (e.tower ? 58 : e.naval ? 44 : 26);
          g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(e.x - w / 2, yy, w, 4);
          g.fillStyle = e.side ? '#e5534b' : '#57c26b'; g.fillRect(e.x - w / 2, yy, (w * e.hp) / e.max, 4);
        }
      }
      for (const s of b.shots) {
        if (s.kind === 'ball' || s.kind === 'rock') { g.fillStyle = s.kind === 'rock' ? '#6b6258' : '#222'; g.beginPath(); g.arc(s.x, s.y, s.kind === 'rock' ? 5 : 4, 0, 7); g.fill(); }
        else { const a = Math.atan2(s.t.y - s.y, s.t.x - s.x); g.strokeStyle = s.side ? '#eee' : '#fff3c4'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - Math.cos(a) * 10, s.y - Math.sin(a) * 10); g.stroke(); }
      }
      for (const f of b.fx) {
        const p = f.life / f.max;
        g.globalAlpha = clamp(p, 0, 1);
        if (f.kind === 'num') { g.fillStyle = f.side ? '#ffd2cf' : '#fff'; g.font = 'bold 11px sans-serif'; g.fillText(f.text, f.x, f.y - (1 - p) * 18); }
        else if (f.kind === 'slash') { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(f.x, f.y, 9, -1.2 * f.face, 0.6 * f.face, f.face < 0); g.stroke(); }
        else if (f.kind === 'boom') { g.fillStyle = '#ffb347'; g.beginPath(); g.arc(f.x, f.y, 26 * (1 - p) + 6, 0, 7); g.fill(); }
        else if (f.kind === 'splash') { g.strokeStyle = '#e6f6ff'; g.lineWidth = 2; g.beginPath(); g.arc(f.x, f.y, 24 * (1 - p) + 4, 0, 7); g.stroke(); }
        else if (f.kind === 'bit') { g.fillStyle = f.color; g.fillRect(f.x, f.y, 3, 3); }
        g.globalAlpha = 1;
      }
      // formation banners at each group's anchor
      for (const G of b.groups) {
        if (!this.active(b, G.side).some((q) => q.g === G.gi)) continue;
        const x = clamp(G.ax, 20, BW - 20), y = clamp(G.ay - 40, 20, BH - 20), c = G.side ? b.cfg.right.color : '#f2c14e';
        g.fillStyle = 'rgba(12,14,20,.8)'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
        const label = `${FORMATIONS[G.formation].icon} ${G.name} · ${STANCES[G.stance].name}`;
        const w = g.measureText(label).width + 12;
        g.fillRect(x - w / 2, y - 14, w, 19); g.fillStyle = c === '#222' ? '#ccc' : c; g.fillText(label, x, y); g.textAlign = 'left';
      }
      if (b.done) {
        g.font = 'bold 64px Georgia, serif'; g.textAlign = 'center';
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(b.result.win ? 'Victory!' : 'Defeat', BW / 2 + 3, BH / 2 + 3);
        g.fillStyle = b.result.win ? '#f2c14e' : '#e5534b'; g.fillText(b.result.win ? 'Victory!' : 'Defeat', BW / 2, BH / 2); g.textAlign = 'left';
      }
      g.restore();
    }
  },
};
// Back-compat alias used by older call sites.
const Battle = { get b() { return Battles.list.find((b) => !b.done) || null; } };

function drawSoldier(g, x, y, u, color, face, walk, attacking, flash) {
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
