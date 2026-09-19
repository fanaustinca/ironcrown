/* ==========================================================================
   Battle simulator (land & naval). Either watched in the viewer or resolved
   instantly. cfg = { kind, title, defend?, left: side, right: side, onEnd(r) }
   side = { name, color, units: {type: n}, stats: (type) => {atk,hp,speed,range},
            towers?, towerHall?, towerHp?, keep?, pirate? }
   Result r = { win, left: survivors, right: survivors, towersLeft, towersStart }
   ========================================================================== */
'use strict';

const BW = 960, BH = 520, BDT = 1 / 30, BATTLE_LIMIT = 120;

const Battle = {
  b: null, speed: 1,

  run(cfg, watch) {
    const b = this.create(cfg);
    if (watch) { this.open(b); return b; }
    let n = 0;
    while (!b.done && n++ < 20000) this.tick(b, BDT);
    return b;
  },

  create(cfg) {
    const naval = cfg.kind === 'naval';
    const b = { cfg, naval, t: 0, units: [], towers: [], shots: [], fx: [], done: false, result: null, start: [{}, {}], seed: Math.floor(Math.random() * 1e6) };
    const table = naval ? SHIPS : UNITS;
    [cfg.left, cfg.right].forEach((side, s) => {
      const types = Object.keys(side.units).filter((k) => table[k] && side.units[k] > 0 && k !== 'scout');
      const total = types.reduce((a, k) => a + side.units[k], 0);
      const g = Math.max(1, Math.ceil(total / 60));
      for (const k of types) {
        b.start[s][k] = side.units[k];
        const st = side.stats(k);
        const lane = naval ? { sloop: 0.35, cog: 0.1, galley: 0.45, frigate: 0.25, galleon: 0.15 }[k] : { archer: 0.12, swordsman: 0.3, pikeman: 0.27, horseman: 0.22, catapult: 0.05 }[k];
        const x0 = s === 0 ? 70 + lane * 700 * 0.45 : BW - 70 - lane * 700 * 0.45;
        for (let left = side.units[k]; left > 0; left -= g) {
          const c = Math.min(g, left);
          b.units.push({ side: s, u: k, naval, count: c, unitHp: st.hp, atk: st.atk, hp: st.hp * c, max: st.hp * c,
            speed: st.speed * (naval ? 30 : 42), range: st.range, x: x0 + rand(-35, 35), y: rand(60, BH - 50), cd: Math.random() * 0.8,
            target: null, retarget: 0, dead: false, face: s ? -1 : 1, walk: Math.random() * 6, r: naval ? 16 : k === 'horseman' || k === 'catapult' ? 10 : 7, hit: 0,
            vs: table[k].vs || {}, splash: table[k].splash });
        }
      }
      const nt = side.towers || 0, th = side.towerHall || 1;
      for (let i = 0; i < nt; i++) {
        const hp = (260 + th * 70) * (side.towerHp || 1) * (s === 0 ? 1 + 0.12 * R('fortification') : 1);
        b.towers.push({ side: s, tower: true, x: s === 0 ? 70 + (i % 2) * 50 : BW - 100 + (i % 2) * 50, y: nt > 1 ? 70 + (i * (BH - 140)) / (nt - 1) : BH / 2,
          hp, max: hp, atk: (10 + th * 3.5) * (s === 0 ? 1 + 0.12 * R('fortification') : 1), range: 170, cd: Math.random(), cannon: th >= 3 && i % 2 === 1, dead: false, r: 16 });
      }
      b['towersStart' + s] = nt;
    });
    return b;
  },

  open(b) {
    this.b = b; this.speed = 1;
    this.bg = this.background(b);
    el('battle-title').textContent = b.cfg.title;
    el('battle-result').hidden = true;
    el('battle').hidden = false;
    document.querySelectorAll('[data-bspeed]').forEach((x) => x.classList.toggle('active', x.dataset.bspeed === '1'));
  },

  alive(b, side) { return b.units.filter((x) => !x.dead && x.side === side); },

  tick(b, dt) {
    if (b.done) return;
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
          const d = dist(a.x, a.y, e.x, e.y) + (e.tower && !a.splash ? 40 : 0);
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
        const sep = a.naval ? 30 : 13;
        for (const o of b.units) {
          if (o === a || o.dead || Math.abs(o.x - a.x) > sep || Math.abs(o.y - a.y) > sep) continue;
          const od = dist(a.x, a.y, o.x, o.y) || 1;
          if (od < sep) { vx += ((a.x - o.x) / od) * sp * 0.6; vy += ((a.y - o.y) / od) * sp * 0.6; }
        }
        a.x = clamp(a.x + vx, 10, BW - 10); a.y = clamp(a.y + vy, 34, BH - 12);
        a.walk += dt * a.speed * 0.25;
      } else {
        a.cd -= dt;
        if (a.cd <= 0) {
          const alive = Math.ceil(a.hp / a.unitHp);
          const mult = t.tower ? a.vs.tower || 1 : a.vs[t.u] || 1;
          const dmg = a.atk * alive * mult * rand(0.8, 1.2);
          if (a.range > 40) {
            a.cd = a.splash ? 2.6 : a.naval ? 1.8 : 1.2;
            const kind = a.splash ? 'rock' : a.naval && a.range > 100 ? 'ball' : 'arrow';
            b.shots.push({ x: a.x, y: a.y - 8, t, dmg, v: kind === 'arrow' ? 420 : 320, kind, side: a.side, splash: a.splash || kind === 'ball' });
          } else { a.cd = 1.0; this.hurt(b, t, dmg); b.fx.push({ kind: 'slash', x: (a.x + t.x) / 2, y: (a.y + t.y) / 2 - 6, life: 0.25, max: 0.25, face: a.face }); a.hit = 0.15; }
        }
      }
      if (a.hit > 0) a.hit -= dt;
    }
    for (const tw of b.towers) {
      if (tw.dead) continue;
      tw.cd -= dt;
      if (tw.cd > 0) continue;
      let best = null, bd = tw.range;
      for (const e of b.units) if (!e.dead && e.side !== tw.side) { const d = dist(tw.x, tw.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
      if (best) {
        tw.cd = tw.cannon ? 2.2 : 1.3;
        b.shots.push({ x: tw.x, y: tw.y - 30, t: best, dmg: tw.atk * (tw.cannon ? 3.2 : 1.6) * (1 + 0.03 * Math.min(20, best.count)), v: tw.cannon ? 300 : 460, kind: tw.cannon ? 'ball' : 'arrow', side: tw.side, splash: tw.cannon });
      }
    }
    for (const s of b.shots) {
      const d = dist(s.x, s.y, s.t.x, s.t.y), stepLen = s.v * dt;
      if (d <= stepLen || s.t.dead) {
        if (!s.t.dead) {
          this.hurt(b, s.t, s.dmg);
          if (s.splash) {
            b.fx.push({ kind: b.naval && !s.t.tower ? 'splash' : 'boom', x: s.t.x, y: s.t.y, life: 0.45, max: 0.45 });
            for (const o of b.units) if (o !== s.t && !o.dead && o.side === s.t.side && dist(o.x, o.y, s.t.x, s.t.y) < 28) this.hurt(b, o, s.dmg * 0.4);
          }
        }
        s.gone = true;
      } else { s.x += ((s.t.x - s.x) / d) * stepLen; s.y += ((s.t.y - s.y) / d) * stepLen; }
    }
    b.shots = b.shots.filter((s) => !s.gone);
    for (const f of b.fx) { f.life -= dt; if (f.vy !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 200 * dt; } }
    b.fx = b.fx.filter((f) => f.life > 0);
    const l = this.alive(b, 0).length + b.towers.filter((t) => !t.dead && t.side === 0).length;
    const r = this.alive(b, 1).length + b.towers.filter((t) => !t.dead && t.side === 1).length;
    if (!l || !r || b.t >= BATTLE_LIMIT) this.finish(b, l > 0 && (r === 0 || (b.cfg.defend && b.t >= BATTLE_LIMIT)));
  },

  hurt(b, t, dmg) {
    t.hp -= dmg; t.flash = 0.12;
    if (Math.random() < 0.3 && b.fx.length < 220) b.fx.push({ kind: 'num', x: t.x + rand(-6, 6), y: t.y - 16, text: Math.round(dmg), life: 0.7, max: 0.7, side: t.side });
    if (t.hp <= 0 && !t.dead) {
      t.dead = true;
      const n = t.tower ? 16 : b.naval ? 12 : 7;
      const col = t.tower ? '#8b8f99' : b.naval ? '#6b4424' : t.side ? b.cfg.right.color : b.cfg.left.color;
      for (let i = 0; i < n; i++) b.fx.push({ kind: 'bit', x: t.x, y: t.y - 6, vx: rand(-70, 70), vy: rand(-140, -40), life: 0.8, max: 0.8, color: col });
    }
  },

  finish(b, win) {
    b.done = true;
    const surv = [{}, {}];
    for (const a of b.units) if (!a.dead) surv[a.side][a.u] = (surv[a.side][a.u] || 0) + Math.min(a.count, Math.ceil(a.hp / a.unitHp));
    b.result = { win, left: surv[0], right: surv[1], towersLeft: b.towers.filter((t) => !t.dead && t.side === 1).length, towersStart: b.towersStart1 };
    try { b.cfg.onEnd && b.cfg.onEnd(b.result); } catch (e) { console.error(e); }
    UI.panelDirty = true;
    save();
    if (this.b === b) this.showResult(b);
  },

  showResult(b) {
    const r = b.result, table = b.naval ? SHIPS : UNITS;
    const cas = (s, surv) => Object.keys(b.start[s]).map((k) => [k, b.start[s][k] - (surv[k] || 0)]).filter(([, n]) => n > 0).map(([k, n]) => `${table[k].icon} ${n}`).join(' · ') || 'none';
    el('battle-result').innerHTML = `<div class="modal-card">
      <p class="big-result ${r.win ? 'win' : 'loss'}">${r.win ? 'Victory!' : 'Defeat'}</p>
      <p class="muted">${esc(b.cfg.title)}</p>
      <div class="result-grid"><div><h3>${esc(b.cfg.left.name)} losses</h3><p class="small">${cas(0, r.left)}</p></div>
      <div><h3>${esc(b.cfg.right.name)} losses</h3><p class="small">${cas(1, r.right)}</p></div></div>
      <p class="small muted">Full report in the 📜 Log.</p>
      <div class="actions" style="justify-content:center"><button class="btn" id="battle-close">Continue</button></div></div>`;
    el('battle-result').hidden = false;
  },

  skip() { let n = 0; while (this.b && !this.b.done && n++ < 20000) this.tick(this.b, BDT); },
  close() { this.b = null; el('battle').hidden = true; UI.panelDirty = true; },

  frame(realDt) {
    if (!this.b) return;
    if (!this.b.done) {
      const steps = Math.min(12, Math.round((realDt / BDT) * this.speed)) || 1;
      for (let i = 0; i < steps && !this.b.done; i++) this.tick(this.b, BDT);
    }
    this.draw(this.b);
  },

  background(b) {
    const c = document.createElement('canvas'); c.width = BW; c.height = BH;
    const g = c.getContext('2d'), rng = mulberry32(b.seed);
    if (b.naval) {
      const grd = g.createLinearGradient(0, 0, 0, BH); grd.addColorStop(0, '#2a6f9e'); grd.addColorStop(1, '#1b4f78');
      g.fillStyle = grd; g.fillRect(0, 0, BW, BH);
      for (let i = 0; i < 500; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)'; g.fillRect(rng() * BW, rng() * BH, 6 + rng() * 14, 2); }
      if (b.cfg.right.towers || b.cfg.right.pirate) {   // enemy coastline
        g.fillStyle = '#d9c38e'; g.beginPath(); g.moveTo(BW, 0);
        for (let y = 0; y <= BH; y += 20) g.lineTo(BW - 70 - Math.sin(y / 60) * 16 - rng() * 6, y);
        g.lineTo(BW, BH); g.fill();
        g.fillStyle = b.cfg.right.pirate ? '#5f7a4e' : '#7ea24f'; g.beginPath(); g.moveTo(BW, 0);
        for (let y = 0; y <= BH; y += 20) g.lineTo(BW - 52 - Math.sin(y / 60) * 16, y);
        g.lineTo(BW, BH); g.fill();
      }
    } else {
      const winter = calendar().seasonIdx === 3;
      const grd = g.createLinearGradient(0, 0, 0, BH); grd.addColorStop(0, winter ? '#8ea58a' : '#5a8a3a'); grd.addColorStop(1, winter ? '#7b9378' : '#46712d');
      g.fillStyle = grd; g.fillRect(0, 0, BW, BH);
      for (let i = 0; i < 1400; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)'; g.fillRect(rng() * BW, rng() * BH, 2 + rng() * 3, 2 + rng() * 3); }
      g.fillStyle = 'rgba(120,95,60,0.35)'; g.beginPath(); g.moveTo(0, BH * 0.45);
      for (let x = 0; x <= BW; x += 40) g.lineTo(x, BH * 0.45 + Math.sin(x / 90) * 18);
      for (let x = BW; x >= 0; x -= 40) g.lineTo(x, BH * 0.55 + Math.sin(x / 90) * 18);
      g.fill();
      for (let i = 0; i < 26; i++) {
        const x = rng() * BW, y = rng() < 0.5 ? 30 + rng() * 20 : BH - rng() * 24;
        g.fillStyle = '#2d4a1f'; g.beginPath(); g.arc(x, y, 12 + rng() * 10, 0, 7); g.fill();
        g.fillStyle = '#3b5f27'; g.beginPath(); g.arc(x - 3, y - 4, 8 + rng() * 6, 0, 7); g.fill();
      }
      [[b.cfg.left, 0], [b.cfg.right, 1]].forEach(([side, s]) => {
        if (!side.keep) return;
        const x = s ? BW - 70 : 0;
        g.fillStyle = '#7d808a'; g.fillRect(x, BH / 2 - 70, 70, 120);
        g.fillStyle = '#5d6069'; g.fillRect(x, BH / 2 + 30, 70, 20);
        for (let i = 0; i < 5; i++) { g.fillStyle = '#8e919b'; g.fillRect(x + i * 15, BH / 2 - 80, 9, 10); }
        g.fillStyle = side.color; g.fillRect(x + 32, BH / 2 - 118, 3, 40);
        g.beginPath(); g.moveTo(x + 35, BH / 2 - 118); g.lineTo(x + 60, BH / 2 - 110); g.lineTo(x + 35, BH / 2 - 100); g.fill();
      });
    }
    return c;
  },

  draw(b) {
    const cv = el('battle-canvas'), g = cv.getContext('2d'), now = performance.now() / 1000;
    g.drawImage(this.bg, 0, 0);
    if (b.naval) {
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1.5;
      for (let i = 0; i < 40; i++) { const x = (hash2(i, 1) * BW + now * 12) % BW, y = hash2(i, 2) * BH; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 4, x + 16, y); g.stroke(); }
    }
    const colors = [b.cfg.left.color, b.cfg.right.color];
    for (const d of b.units) if (d.dead && !b.naval) { g.fillStyle = 'rgba(60,20,20,.25)'; g.beginPath(); g.ellipse(d.x, d.y + 2, 6, 3, 0, 0, 7); g.fill(); }
    const ents = b.units.filter((u) => !u.dead).concat(b.towers.filter((t) => !t.dead)).sort((a, c) => a.y - c.y);
    for (const e of ents) {
      if (e.tower) drawTowerSprite(g, e.x, e.y, e.cannon, e.flash > 0);
      else if (e.naval) drawShip(g, e.x, e.y, e.u, colors[e.side], e.face, now + e.walk, e.flash > 0, b.cfg[e.side ? 'right' : 'left'].pirate);
      else drawSoldier(g, e.x, e.y, e.u, colors[e.side], e.face, e.walk, e.hit > 0, e.flash > 0);
      if (e.flash > 0) e.flash -= 1 / 60;
      if (e.hp < e.max) {
        const w = e.tower || e.naval ? 34 : 18, yy = e.y - (e.tower ? 58 : e.naval ? 44 : 26);
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(e.x - w / 2, yy, w, 4);
        g.fillStyle = e.side ? '#e5534b' : '#57c26b'; g.fillRect(e.x - w / 2, yy, (w * e.hp) / e.max, 4);
      }
      if (e.count > 1) { g.fillStyle = 'rgba(255,255,255,.7)'; g.font = 'bold 9px sans-serif'; g.fillText('×' + Math.ceil(e.hp / e.unitHp), e.x + 8, e.y + 4); }
    }
    for (const s of b.shots) {
      if (s.kind === 'ball' || s.kind === 'rock') { g.fillStyle = s.kind === 'rock' ? '#6b6258' : '#222'; g.beginPath(); g.arc(s.x, s.y, s.kind === 'rock' ? 5 : 4, 0, 7); g.fill(); }
      else { const a = Math.atan2(s.t.y - s.y, s.t.x - s.x); g.strokeStyle = s.side ? '#ddd' : '#fff3c4'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - Math.cos(a) * 10, s.y - Math.sin(a) * 10); g.stroke(); }
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
    const count = (s) => this.alive(b, s).reduce((a, u) => a + Math.ceil(u.hp / u.unitHp), 0);
    const tw = (s) => b.towers.filter((t) => !t.dead && t.side === s).length;
    g.fillStyle = 'rgba(10,12,18,.75)'; g.fillRect(0, 0, BW, 26);
    g.font = 'bold 13px sans-serif';
    g.fillStyle = colors[0] === '#222' ? '#ccc' : colors[0]; g.fillText(`${b.cfg.left.name}: ${count(0)} ${b.naval ? 'ships' : 'troops'}${tw(0) ? `, ${tw(0)} towers` : ''}`, 12, 18);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(fmtTime(BATTLE_LIMIT - b.t), BW / 2, 18);
    g.fillStyle = colors[1] === '#222' ? '#ccc' : colors[1]; g.textAlign = 'right'; g.fillText(`${b.cfg.right.name}: ${count(1)}${tw(1) ? `, ${tw(1)} towers` : ''}`, BW - 12, 18);
    g.textAlign = 'left';
  },
};

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
  const sz = { sloop: 0.75, cog: 0.9, galley: 1, frigate: 1.1, galleon: 1.3 }[type] || 1;
  const L = 22 * sz * scale, bob = Math.sin(t * 2) * 1.2 * scale;
  g.save(); g.translate(x, y + bob); g.scale(face, 1);
  g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.ellipse(-L * 0.9, 3 * scale, L * 0.6, 2.5 * scale, 0, 0, 7); g.fill();
  g.fillStyle = flash ? '#fff' : pirate ? '#2b2118' : '#6b4424';
  g.beginPath(); g.moveTo(-L, -4 * scale); g.lineTo(L, -5 * scale); g.lineTo(L * 0.7, 4 * scale); g.lineTo(-L * 0.8, 4 * scale); g.closePath(); g.fill();
  g.fillStyle = pirate ? '#1a140e' : '#4a2f18'; g.fillRect(-L * 0.85, -4 * scale, L * 1.75, 2 * scale);
  if (type === 'galley') { g.strokeStyle = '#3a2716'; g.lineWidth = scale; for (let i = -3; i <= 3; i++) { const a = Math.sin(t * 4 + i) * 2; g.beginPath(); g.moveTo(i * L * 0.2, 2 * scale); g.lineTo(i * L * 0.2 + a * scale, 8 * scale); g.stroke(); } }
  const masts = type === 'galleon' ? 3 : type === 'frigate' ? 2 : 1;
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
