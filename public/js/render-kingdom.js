/* ==========================================================================
   Kingdom map renderer (hex grid around the Main Hall).
   ========================================================================== */
'use strict';

const villagers = [];
const popTimers = {};
const bSize = (b) => (b.type === 'hall' ? K_HEX * 3.1 : K_HEX * 1.75);
const bBox = (b) => { const s = bSize(b), i = b.type === 'hall' ? HALL_HEX : b.hex; return [KG.cx[i] - s / 2, KG.cy[i] - s * 0.62, s]; };

function kingdomLandColor(i) {
  const h = hash2(i, 3, 1);
  let c = inLand(i) ? shade('#74a84c', (h - 0.5) * 0.1) : shade('#58843d', (h - 0.5) * 0.12);
  if (calendar().seasonIdx === 3) c = mix(c, '#e6edf0', 0.45);
  else if (calendar().seasonIdx === 2) c = mix(c, '#b59a45', 0.18);
  return c;
}

function drawKingdom(g, t, dt) {
  const cam = CAM.kingdom;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = DEPTH_COLORS[6]; g.fillRect(0, 0, CW, CH);
  cam.apply(g);
  if (shakeAmt > 0) { g.translate(rand(-shakeAmt, shakeAmt), rand(-shakeAmt, shakeAmt)); shakeAmt *= 0.85; if (shakeAmt < 0.3) shakeAmt = 0; }
  const vis = cam.visible(2);
  drawTerrainBase(g, KG, vis, (i) => KT[i] === 1, KDEPTH, kingdomLandColor, S.seed, t);

  // plaza cobbles
  for (const i of KG.neighbors(HALL_HEX).concat(HALL_HEX)) {
    g.fillStyle = '#b8ab92'; g.beginPath(); KG.hexPath(g, i, 1.01); g.fill();
    g.fillStyle = '#a5987f';
    for (let k = 0; k < 7; k++) { const a = hash2(i, k) * 6.28, r = hash2(k, i) * K_HEX * 0.7; g.beginPath(); g.ellipse(KG.cx[i] + Math.cos(a) * r, KG.cy[i] + Math.sin(a) * r, 4, 3, 0, 0, 7); g.fill(); }
  }
  // grid + hexagonal land border
  if (SETTINGS.showGrid) {
    g.strokeStyle = 'rgba(0,0,0,.09)'; g.lineWidth = 1 / cam.z;
    g.beginPath(); for (const i of vis) if (inLand(i) && KG.dist(i, HALL_HEX) > 1) KG.hexPath(g, i, 0.98); g.stroke();
  }
  const edge = (pred, color, w, dash) => {
    g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []);
    g.beginPath();
    for (const i of vis) {
      if (!pred(i)) continue;
      for (let d = 0; d < 6; d++) {
        const n = KG.nb[i * 6 + d];
        if (n >= 0 && pred(n)) continue;
        if (n >= 0 && KT[n] === 0) continue;
        const [x0, y0] = KG.corner(i, d), [x1, y1] = KG.corner(i, d + 1);
        g.moveTo(x0, y0); g.lineTo(x1, y1);
      }
    }
    g.stroke(); g.setLineDash([]);
  };
  const r = landRadius();
  if (hallLevel() < MAX_HALL) edge((i) => KT[i] === 1 && KG.dist(i, HALL_HEX) <= r + 1, 'rgba(255,255,255,.18)', 1.5, [5, 6]);
  edge(inLand, 'rgba(0,0,0,.25)', 6, null);
  edge(inLand, `rgba(242,193,78,${0.75 + 0.2 * Math.sin(t * 2)})`, 2.5, null);

  // hover / placement highlight
  const h = UI.hover;
  if (UI.placing && h >= 0) {
    const err = placementError(UI.placing, h);
    g.fillStyle = err ? 'rgba(229,83,75,.35)' : 'rgba(87,194,107,.35)'; g.beginPath(); KG.hexPath(g, h, 0.95); g.fill();
    g.strokeStyle = err ? '#e5534b' : '#57c26b'; g.lineWidth = 2; g.stroke();
  } else if (h >= 0 && KT[h] === 1) {
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.5; g.beginPath(); KG.hexPath(g, h, 0.94); g.stroke();
  }
  const sel = S.buildings.find((b) => b.id === UI.selected);
  if (sel) {
    g.strokeStyle = `rgba(242,193,78,${0.6 + 0.4 * Math.sin(t * 5)})`; g.lineWidth = 3;
    g.beginPath(); KG.hexPath(g, sel.type === 'hall' ? HALL_HEX : sel.hex, sel.type === 'hall' ? 1.9 : 0.95); g.stroke();
  }

  // depth-sorted scenery + buildings
  const items = [];
  for (const i of vis) {
    if (KT[i] !== 1) continue;
    const o = obstacleAt(i);
    if (o && inLand(i)) items.push({ y: KG.cy[i], f: () => { if (o === 'tree') { tree(g, KG.cx[i] - 8, KG.cy[i] + 4, 9); tree(g, KG.cx[i] + 7, KG.cy[i] + 9, 8, true); } else { rock(g, KG.cx[i], KG.cy[i] + 6, 12); rock(g, KG.cx[i] + 10, KG.cy[i] - 2, 7); } } });
    else if (!inLand(i) && hash2(i, 9, 2) < 0.62 && KG.dist(i, HALL_HEX) > r + 1) {
      const n = 1 + Math.floor(hash2(i, 4) * 3);
      for (let k = 0; k < n; k++) { const x = KG.cx[i] + (hash2(i, k, 5) - 0.5) * K_HEX * 1.2, y = KG.cy[i] + (hash2(k, i, 6) - 0.5) * K_HEX; items.push({ y, f: () => tree(g, x, y, 8 + hash2(i, k) * 5, k % 2) }); }
    }
  }
  for (const b of S.buildings) {
    const [px, py, s] = bBox(b);
    items.push({ y: py + s * 0.8, f: () => drawBuilding(g, b, px, py, s, t) });
  }
  items.sort((a, b) => a.y - b.y).forEach((it) => it.f());

  if (UI.placing && h >= 0 && !placementError(UI.placing, h)) {
    const s = K_HEX * 1.75;
    g.globalAlpha = 0.65; drawBuilding(g, { id: 0, type: UI.placing, hex: h, level: 1, build: 0 }, KG.cx[h] - s / 2, KG.cy[h] - s * 0.62, s, t, true); g.globalAlpha = 1;
  }
  // production popups
  for (const b of S.buildings) {
    const prod = productionOf(b);
    if (!prod || b.build > 0 || S.res[prod[0]] >= capOf(prod[0])) continue;
    popTimers[b.id] = (popTimers[b.id] ?? hash2(b.id, 1) * 6) - dt;
    if (popTimers[b.id] <= 0) {
      popTimers[b.id] = 6;
      const amt = prod[1] * 6 * prodMult(prod[0]);
      const i = b.type === 'hall' ? HALL_HEX : b.hex;
      floatText(KG.cx[i], KG.cy[i] - 22, `+${amt >= 10 ? fmt(amt) : amt.toFixed(1)} ${RES_META[prod[0]].icon}`, RES_META[prod[0]].color);
    }
  }
  drawVillagers(g, t, dt);
  drawFx(g, dt);

  // screen-space overlays
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const threat = S.aiArmies.find((a) => a.kind === 'raid' && WG.dist(a.at, S.world.capital) <= 4);
  if (threat) {
    const k = S.kingdoms[threat.kid], edgeA = 0.25 + 0.2 * Math.sin(t * 6);
    const grd = g.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * 0.35, CW / 2, CH / 2, Math.max(CW, CH) * 0.7);
    grd.addColorStop(0, 'rgba(229,83,75,0)'); grd.addColorStop(1, `rgba(229,83,75,${edgeA})`);
    g.fillStyle = grd; g.fillRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(10,12,18,.85)'; g.fillRect(CW / 2 - 190, CH - 48, 380, 32);
    g.fillStyle = '#ffb3ad'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center';
    g.fillText(`⚠ ${k.name} army ${WG.dist(threat.at, S.world.capital)} hexes from the capital`, CW / 2, CH - 27); g.textAlign = 'left';
  }
}

function drawVillagers(g, t, dt) {
  if (villagers.length < 9) villagers.push({ x: KG.cx[HALL_HEX], y: KG.cy[HALL_HEX] + 30, tx: KG.cx[HALL_HEX], ty: KG.cy[HALL_HEX], c: pick(['#c0392b', '#2980b9', '#8e44ad', '#16a085', '#d35400']), wait: Math.random() * 3 });
  for (const v of villagers) {
    const d = dist(v.x, v.y, v.tx, v.ty);
    if (d < 1) {
      v.wait -= dt;
      if (v.wait <= 0) {
        const land = KG.within(HALL_HEX, landRadius()).filter((i) => KT[i] === 1);
        const i = pick(land);
        v.tx = KG.cx[i] + rand(-10, 10); v.ty = KG.cy[i] + rand(-8, 8); v.wait = rand(1, 4);
      }
    } else { const sp = Math.min(d, dt * 26); v.x += ((v.tx - v.x) / d) * sp; v.y += ((v.ty - v.y) / d) * sp; }
    const bob = d > 1 ? Math.abs(Math.sin(t * 9 + v.c.length)) * 1.5 : 0;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(v.x, v.y + 1, 3, 1.2, 0, 0, 7); g.fill();
    g.fillStyle = v.c; g.fillRect(v.x - 2, v.y - 6 - bob, 4, 5.5);
    g.fillStyle = '#f1c9a5'; g.beginPath(); g.arc(v.x, v.y - 7.5 - bob, 1.8, 0, 7); g.fill();
  }
}
