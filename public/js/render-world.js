/* ==========================================================================
   World map renderer: hex terrain with organic coasts, features, territory,
   armies/fleets, fog of war, minimap.
   ========================================================================== */
'use strict';

function worldLandColor(i) {
  const t = S.world.terrain[i], h = hash2(i, 21, 3);
  let c = shade(TERRAIN[t].color, (h - 0.5) * 0.12);
  const season = calendar().seasonIdx;
  if (season === 3 && t !== T.DESERT) c = mix(c, '#e8eef1', WG.row(i) < WH * 0.55 ? 0.5 : 0.25);
  else if (season === 2 && (t === T.FOREST || t === T.PLAINS || t === T.MEADOW)) c = mix(c, '#b8883a', 0.2);
  return c;
}
const entPos = (e) => {
  const a = e.at, n = e.path && e.path.length ? e.path[0] : a, p = e.prog || 0;
  // divisions resting at the capital line up beside the plaza instead of covering the Main Hall
  if (e.units && !e.ships && a === S.world.capital && !(e.path && e.path.length)) {
    const k = S.divisions.filter((d) => d.at === a && !d.path.length).indexOf(e);
    return [WG.cx[a] + W_HEX * (2.6 + 1.3 * k), WG.cy[a] + W_HEX * 2.1];
  }
  return [lerp(WG.cx[a], WG.cx[n], p), lerp(WG.cy[a], WG.cy[n], p)];
};

const DS = W_HEX / 30;   // detail art was authored for 30px hexes
function drawTerrainDetail(g, i, t) {
  g.save(); g.translate(WG.cx[i], WG.cy[i]); g.scale(DS, DS);
  try { detailArt(g, i, t); } finally { g.restore(); }
}
function detailArt(g, i, t) {
  const tt = S.world.terrain[i], x = 0, y = 0, s = 30, h = (k) => hash2(i, k, 9);
  const winter = calendar().seasonIdx === 3;
  if (tt === T.FOREST) {
    for (let k = 0; k < 4; k++) tree(g, x + (h(k) - 0.5) * s * 1.1, y + (h(k + 4) - 0.5) * s * 0.9 + 4, 5 + h(k + 8) * 3, k % 2);
  } else if (tt === T.HILLS) {
    for (let k = 0; k < 2; k++) { const hx = x + (k ? 8 : -7), hy = y + (k ? 6 : -2); g.fillStyle = '#8a7a52'; g.beginPath(); g.ellipse(hx, hy, 11, 7, 0, Math.PI, 0); g.fill(); g.fillStyle = '#b3a276'; g.beginPath(); g.ellipse(hx - 3, hy - 2, 5, 3, 0, Math.PI, 0); g.fill(); }
  } else if (tt === T.MOUNTAIN) {
    const peaks = [[-8, 6, 11, 22], [7, 8, 12, 26], [0, -2, 9, 18]];
    for (const [dx, dy, w, hh] of peaks) {
      const px = x + dx, py = y + dy;
      g.fillStyle = '#6e685e'; g.beginPath(); g.moveTo(px - w, py); g.lineTo(px, py - hh); g.lineTo(px + w, py); g.fill();
      g.fillStyle = '#948d80'; g.beginPath(); g.moveTo(px - w, py); g.lineTo(px, py - hh); g.lineTo(px - w * 0.1, py); g.fill();
      g.fillStyle = '#f4f6f8'; g.beginPath(); g.moveTo(px - w * (winter ? 0.7 : 0.35), py - hh * (winter ? 0.3 : 0.65)); g.lineTo(px, py - hh); g.lineTo(px + w * (winter ? 0.7 : 0.35), py - hh * (winter ? 0.3 : 0.65)); g.fill();
    }
  } else if (tt === T.DESERT) {
    g.strokeStyle = 'rgba(160,120,60,.45)'; g.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) { const dy = (k - 1) * 8; g.beginPath(); g.moveTo(x - 12, y + dy); g.quadraticCurveTo(x, y + dy - 6, x + 12, y + dy); g.stroke(); }
    if (h(3) > 0.7) { g.fillStyle = '#4f8a3a'; g.fillRect(x + 6, y - 6, 2.5, 10); g.fillRect(x + 3, y - 3, 3, 2); g.fillRect(x + 8, y - 2, 3, 2); }
  } else if (tt === T.SWAMP) {
    g.fillStyle = 'rgba(60,90,80,.7)'; g.beginPath(); g.ellipse(x - 5, y + 3, 9, 4, 0.2, 0, 7); g.ellipse(x + 8, y - 5, 6, 3, -0.3, 0, 7); g.fill();
    g.strokeStyle = '#3b5a2a'; g.lineWidth = 1; for (let k = 0; k < 5; k++) { const rx = x + (h(k) - 0.5) * 22; g.beginPath(); g.moveTo(rx, y + 10); g.lineTo(rx + 1, y + 3); g.stroke(); }
  } else if (tt === T.MEADOW) {
    for (let k = 0; k < 6; k++) { g.fillStyle = ['#f5e663', '#ffffff', '#e58ab0'][k % 3]; g.fillRect(x + (h(k) - 0.5) * s * 1.2, y + (h(k + 6) - 0.5) * s, 2, 2); }
  } else if (tt === T.PLAINS) {
    g.strokeStyle = 'rgba(70,110,40,.5)'; g.lineWidth = 1;
    for (let k = 0; k < 4; k++) { const gx = x + (h(k) - 0.5) * s * 1.1, gy = y + (h(k + 5) - 0.5) * s * 0.9; g.beginPath(); g.moveTo(gx - 2, gy); g.lineTo(gx, gy - 4); g.lineTo(gx + 2, gy); g.stroke(); }
  }
}

function drawFeature(g, i, f, t) {
  g.save(); g.translate(WG.cx[i], WG.cy[i]); g.scale(DS * 1.4, DS * 1.4);
  try { featureArt(g, i, f, t); } finally { g.restore(); }
}
function featureArt(g, i, f, t) {
  const x = 0, y = 0;
  if (f.type === 'goldvein') {
    for (let k = 0; k < 3; k++) { const on = Math.sin(t * 3 + k * 2 + i) > 0.3; g.fillStyle = on ? '#fff6c2' : '#f2c14e'; const sx = x + (k - 1) * 8, sy = y + (k % 2) * 6 - 2; g.fillRect(sx - 3, sy - 0.5, 6, 1.5); g.fillRect(sx - 0.7, sy - 3, 1.5, 6); }
  } else if (f.type === 'cave') {
    g.fillStyle = '#6e685e'; g.beginPath(); g.ellipse(x, y + 4, 14, 11, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#17120e'; g.beginPath(); g.ellipse(x, y + 4, 6, 7, 0, Math.PI, 0); g.fill();
    if (f.explored) { g.fillStyle = f.mineral === 'gems' ? '#c8a8ff' : f.mineral === 'gold' ? '#f2c14e' : '#c6d2de'; g.beginPath(); g.arc(x + 9, y - 3, 3.5, 0, 7); g.fill(); }
    else { g.fillStyle = '#fff'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillText('?', x, y - 8); g.textAlign = 'left'; }
  } else if (f.type === 'ruins') {
    g.fillStyle = f.looted ? '#8d8a82' : '#cfc7b4';
    [[-9, 12], [-2, 18], [6, 9], [12, 14]].forEach(([dx, hh], k) => { if (f.looted && k % 2) return; g.fillRect(x + dx, y + 6 - hh, 4, hh); });
    g.fillRect(x - 11, y + 6, 26, 3);
    if (!f.looted) { g.fillStyle = '#e8dcc0'; g.fillRect(x - 10, y - 13, 12, 3); }
  } else if (f.type === 'fort') {
    const c = f.captured ? '#f2c14e' : '#7a7a86';
    g.fillStyle = '#8f9199'; g.fillRect(x - 12, y - 6, 24, 14);
    for (let k = 0; k < 4; k++) g.fillRect(x - 12 + k * 7, y - 10, 4, 4);
    g.fillStyle = '#5d5f66'; g.fillRect(x - 3, y + 1, 6, 7);
    g.fillStyle = '#4a3522'; g.fillRect(x + 8, y - 22, 1.5, 14);
    g.fillStyle = c; g.fillRect(x + 9.5, y - 22, 8, 5);
  } else if (f.type === 'wreck') {
    if (f.salvaged) return;
    const bob = Math.sin(t * 1.5 + i) * 1.2;
    g.fillStyle = '#4a2f18'; g.beginPath(); g.moveTo(x - 10, y + 4 + bob); g.lineTo(x + 8, y + 1 + bob); g.lineTo(x + 5, y + 6 + bob); g.fill();
    g.fillStyle = '#3a2716'; g.save(); g.translate(x - 2, y + 2 + bob); g.rotate(0.4); g.fillRect(-1, -16, 2, 16); g.restore();
    g.fillStyle = 'rgba(239,230,210,.7)'; g.beginPath(); g.moveTo(x + 2, y - 10 + bob); g.lineTo(x + 8, y - 4 + bob); g.lineTo(x + 1, y - 3 + bob); g.fill();
  } else if (f.type === 'cove') {
    if (f.destroyed) { g.fillStyle = '#3a2716'; g.fillRect(x - 8, y + 2, 16, 3); return; }
    g.fillStyle = '#6b4424'; g.fillRect(x - 10, y - 2, 14, 10);
    g.fillStyle = '#4a2f18'; g.beginPath(); g.moveTo(x - 12, y - 2); g.lineTo(x - 3, y - 10); g.lineTo(x + 6, y - 2); g.fill();
    g.fillStyle = '#222'; g.fillRect(x + 8, y - 20, 1.5, 22);
    g.fillStyle = '#111'; g.fillRect(x + 9.5, y - 20, 11, 7);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 15, y - 17, 1.8, 0, 7); g.fill();
  }
}

function drawCastle(g, cx, cy, s, color, big) {
  shadow(g, cx, cy + s * 0.32, s * 0.45, s * 0.12);
  g.fillStyle = '#b7bac2'; g.fillRect(cx - s * 0.35, cy - s * 0.15, s * 0.7, s * 0.45);
  for (let k = 0; k < 4; k++) g.fillRect(cx - s * 0.35 + k * s * 0.2, cy - s * 0.22, s * 0.1, s * 0.08);
  g.fillStyle = '#d0d3da'; g.fillRect(cx - s * 0.18, cy - s * 0.42, s * 0.36, s * 0.35);
  g.fillStyle = color; g.beginPath(); g.moveTo(cx - s * 0.24, cy - s * 0.42); g.lineTo(cx + s * 0.24, cy - s * 0.42); g.lineTo(cx, cy - s * 0.72); g.fill();
  if (big) { g.fillStyle = color; g.fillRect(cx + s * 0.28, cy - s * 0.52, s * 0.08, s * 0.4); }
  g.fillStyle = '#3a2b1a'; g.fillRect(cx - s * 0.07, cy + s * 0.1, s * 0.14, s * 0.2);
}
function drawBanner(g, x, y, color, icon, count, t, selected, enemy) {
  shadow(g, x, y + 8, 10, 3);
  if (selected) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y + 2, 16 + Math.sin(t * 5) * 1.5, 0, 7); g.stroke(); }
  g.fillStyle = '#3a2716'; g.fillRect(x - 1, y - 20, 2, 28);
  g.fillStyle = enemy ? color : color;
  g.beginPath(); g.moveTo(x + 1, y - 20); g.lineTo(x + 17 + Math.sin(t * 4) * 1.5, y - 17); g.lineTo(x + 17 + Math.sin(t * 4 + 1) * 1.5, y - 6); g.lineTo(x + 1, y - 9); g.fill();
  if (enemy) { g.strokeStyle = '#300'; g.lineWidth = 1; g.stroke(); }
  g.fillStyle = 'rgba(12,14,20,.85)'; const w = 14 + String(count).length * 6; g.fillRect(x - w / 2, y + 6, w, 12);
  g.fillStyle = enemy ? '#ffb3ad' : '#fff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillText(`${icon}${count}`, x, y + 15); g.textAlign = 'left';
}

let fogCache = null, fogVersion = -1;
const FOG_SCALE = 0.25;
let fogBuiltAt = -1e9;
function fogLayer() {
  if (fogCache && (!fogDirty || performance.now() - fogBuiltAt < 500)) return fogCache;
  fogDirty = false; fogBuiltAt = performance.now();
  const w = Math.ceil(WG.pw * FOG_SCALE), h = Math.ceil(WG.ph * FOG_SCALE);
  const tiles = document.createElement('canvas'); tiles.width = w + 40; tiles.height = h + 40;
  const tg = tiles.getContext('2d');
  tg.translate(20, 20); tg.scale(FOG_SCALE, FOG_SCALE);
  tg.fillStyle = '#0c0f15';
  tg.beginPath();
  for (let i = 0; i < WG.N; i++) if (!S.world.seen[i]) WG.hexPath(tg, i, 1.12);
  tg.fill();
  tg.globalCompositeOperation = 'source-atop';
  const rng = mulberry32(S.seed + 5);
  for (let k = 0; k < 110; k++) {
    const x = rng() * WG.pw, y = rng() * WG.ph, r = 30 * (1.5 + rng() * 3.5);
    const grd = tg.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, 'rgba(70,78,98,.45)'); grd.addColorStop(1, 'rgba(70,78,98,0)');
    tg.fillStyle = grd; tg.fillRect(x - r, y - r, r * 2, r * 2);
  }
  fogCache = document.createElement('canvas'); fogCache.width = tiles.width; fogCache.height = tiles.height;
  const fg = fogCache.getContext('2d');
  fg.filter = 'blur(3px)'; fg.drawImage(tiles, 0, 0); fg.filter = 'none';
  fg.globalAlpha = 0.55; fg.drawImage(tiles, 0, 0);
  return fogCache;
}

/* ---- zoomed-out LOD: the whole 16k-hex terrain cached as one image ---- */
const LIVE_Z = 1.8;                   // at or above this zoom the terrain is drawn live, hex by hex
let terrainBmp = null, terrainBmpKey = '', ownerBmp = null, ownerBmpVer = -1, ownerBmpAt = -1e9;
function terrainBitmap() {
  const key = `${calendar().seasonIdx}|${SETTINGS.graphics}|${S.seed}`;
  if (terrainBmp && key === terrainBmpKey) return terrainBmp;
  terrainBmpKey = key;
  const c = terrainBmp || document.createElement('canvas');
  c.width = Math.ceil(WG.pw); c.height = Math.ceil(WG.ph);
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = DEPTH_COLORS[6]; g.fillRect(0, 0, c.width, c.height);
  const all = Array.from({ length: WG.N }, (_, i) => i), terrain = S.world.terrain, isLandW = (i) => terrain[i] !== T.WATER;
  GFX.pat.clear(); GFX.ctx = null;
  drawTerrainBase(g, WG, all, isLandW, WDEPTH, worldLandColor, S.seed + 1, 0, (i) => WORLD_TEX[terrain[i]], worldShade);
  for (const i of all) if (isLandW(i)) drawTerrainDetail(g, i, 0);
  GFX.pat.clear(); GFX.ctx = null;
  terrainBmp = c;
  return c;
}
function ownerBitmap() {
  if (ownerBmp && (ownerBmpVer === worldVersion || performance.now() - ownerBmpAt < 1000)) return ownerBmp;
  ownerBmpVer = worldVersion; ownerBmpAt = performance.now();
  const c = ownerBmp || document.createElement('canvas');
  c.width = Math.ceil(WG.pw / 2); c.height = Math.ceil(WG.ph / 2);
  const g = c.getContext('2d');
  g.setTransform(0.5, 0, 0, 0.5, 0, 0); g.clearRect(0, 0, WG.pw, WG.ph);
  drawTerritory(g, Array.from({ length: WG.N }, (_, i) => i), 1.2);
  ownerBmp = c;
  return c;
}
function drawTerritory(g, list, z) {
  const owner = S.world.owner, colOf = (o) => (o === -2 ? '#f2c14e' : S.kingdoms[o].color);
  for (const i of list) { const o = owner[i]; if (o === -1) continue; g.fillStyle = colOf(o) + '30'; g.beginPath(); WG.hexPath(g, i, 1.02); g.fill(); }
  g.lineCap = 'round';
  const byOwner = new Map();
  for (const i of list) {
    const o = owner[i];
    if (o === -1) continue;
    for (let d = 0; d < 6; d++) {
      const n = WG.nb[i * 6 + d];
      if (n >= 0 && owner[n] === o) continue;
      if (!byOwner.has(o)) byOwner.set(o, []);
      byOwner.get(o).push(i, d);
    }
  }
  for (const [o, segs] of byOwner) {
    g.strokeStyle = colOf(o); g.lineWidth = Math.max(1.6, 2.6 / z);
    g.beginPath();
    for (let k = 0; k < segs.length; k += 2) { const [x0, y0] = WG.corner(segs[k], segs[k + 1], 0.94), [x1, y1] = WG.corner(segs[k], segs[k + 1] + 1, 0.94); g.moveTo(x0, y0); g.lineTo(x1, y1); }
    g.stroke();
  }
}

function drawWorld(g, t, dt) {
  const cam = CAM, z = cam.z, { terrain, feat } = S.world;
  const es = clamp(1.3 / z, 0.22, 1.2);   // map icons keep a steady on-screen size
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = DEPTH_COLORS[6]; g.fillRect(0, 0, CW, CH);
  cam.apply(g);
  if (shakeAmt > 0) { g.translate(rand(-shakeAmt, shakeAmt) / z, rand(-shakeAmt, shakeAmt) / z); shakeAmt *= 0.85; if (shakeAmt < 0.3) shakeAmt = 0; }
  const vis = cam.visible(1), isLandW = (i) => terrain[i] !== T.WATER, live = z >= LIVE_Z;
  const cap = S.world.capital;
  const occupied = new Set(S.buildings.map((b) => b.hex));
  for (const k of S.kingdoms) if (isSeen(k.capital)) for (const b of aiCity(k).buildings) occupied.add(b.hex);
  if (live) {
    drawTerrainBase(g, WG, vis, isLandW, WDEPTH, worldLandColor, S.seed + 1, t, (i) => WORLD_TEX[terrain[i]], worldShade);
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 0.6;
    g.beginPath();
    for (const i of vis) { if (isLandW(i) || hash2(i, 4) < 0.55) continue; const o = Math.sin(t + i * 0.7) * 2, x = WG.cx[i], y = WG.cy[i]; g.moveTo(x - 3 + o, y); g.quadraticCurveTo(x + o, y - 1.2, x + 3 + o, y); }
    g.stroke();
    if (SETTINGS.showGrid) { g.strokeStyle = 'rgba(0,0,0,.09)'; g.lineWidth = 1 / z; g.beginPath(); for (const i of vis) if (isLandW(i)) WG.hexPath(g, i, 0.99); g.stroke(); }
    drawTerritory(g, vis, z);
    const sorted = vis.slice().sort((a, b) => a - b);
    for (const i of sorted) {
      if (!isLandW(i) || occupied.has(i) || WG.dist(i, cap) <= 1 || (cleared(i) && S.world.owner[i] === -2)) continue;
      drawTerrainDetail(g, i, t);
    }
  } else {
    g.drawImage(terrainBitmap(), 0, 0, WG.pw, WG.ph);
    if (SETTINGS.showGrid && z > 0.8) { g.strokeStyle = 'rgba(0,0,0,.07)'; g.lineWidth = 1 / z; g.beginPath(); for (const i of vis) if (isLandW(i)) WG.hexPath(g, i, 0.99); g.stroke(); }
    g.drawImage(ownerBitmap(), 0, 0, WG.pw, WG.ph);
  }
  for (const i of vis) { const f = feat[i]; if (f && isSeen(i) && !occupied.has(i)) drawFeature(g, i, f, t); }
  drawCityLayer(g, t, dt, vis);
  const icon = (x, y, fn) => { g.save(); g.translate(x, y); g.scale(es, es); fn(); g.restore(); };
  // paths of selected entity & visible enemy raids
  const selE = selectedEntity();
  const pathLine = (e, color, dash) => {
    if (!e.path || !e.path.length) return;
    const [sx, sy] = entPos(e);
    g.strokeStyle = color; g.lineWidth = 2.5 / z; g.setLineDash(dash.map((v) => v / z)); g.lineDashOffset = (-t * 20) / z;
    g.beginPath(); g.moveTo(sx, sy); for (const p of e.path) g.lineTo(WG.cx[p], WG.cy[p]); g.stroke(); g.setLineDash([]);
    const last = e.path[e.path.length - 1];
    g.beginPath(); g.arc(WG.cx[last], WG.cy[last], 8 / z, 0, 7); g.stroke();
  };
  for (const e of S.divisions.concat(S.fleets)) pathLine(e, e === selE ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.35)', [6, 6]);
  for (const p of S.scouts) pathLine(p, p === selE ? 'rgba(127,212,255,.95)' : 'rgba(127,212,255,.4)', [3, 5]);
  // guard rings: idle divisions protect their hex and its neighbours
  for (const d of S.divisions) if (!d.path.length && d.at !== S.world.capital) { g.strokeStyle = 'rgba(242,193,78,.28)'; g.lineWidth = 2 / z; g.setLineDash([3 / z, 4 / z]); g.beginPath(); g.arc(WG.cx[d.at], WG.cy[d.at], W_HEX * SQ3 * 2.2, 0, 7); g.stroke(); g.setLineDash([]); }
  for (const a of S.aiArmies) if (a.kind === 'raid' && isSeen(a.at)) pathLine(a, 'rgba(229,83,75,.8)', [4, 6]);
  for (const a of S.aiArmies) if (a.kind === 'raid' && a.targetHex != null) { g.strokeStyle = `rgba(229,83,75,${0.5 + 0.4 * Math.sin(t * 6)})`; g.lineWidth = 3 / z; g.beginPath(); WG.hexPath(g, a.targetHex, 1.3); g.stroke(); }
  // scout parties
  for (const p of S.scouts) {
    const [px0, py0] = entPos(p), sel = selE === p;
    g.save(); g.translate(px0, py0); g.scale(es, es); const x = 0, y = 0;
    if (sel) { g.strokeStyle = '#7fd4ff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y - 4, 13 + Math.sin(t * 5), 0, 7); g.stroke(); }
    shadow(g, x, y + 5, 7, 2.5);
    const bob = p.path.length ? Math.abs(Math.sin(t * 10)) * 1.5 : 0;
    g.fillStyle = '#3f6fb5'; g.fillRect(x - 3, y - 9 - bob, 6, 8);
    g.fillStyle = '#f1c9a5'; g.beginPath(); g.arc(x, y - 11 - bob, 2.6, 0, 7); g.fill();
    g.strokeStyle = '#c9a44a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x + 2, y - 11 - bob); g.lineTo(x + 8, y - 13 - bob); g.stroke();
    g.fillStyle = 'rgba(12,14,20,.85)'; g.fillRect(x - 10, y + 5, 20, 11);
    g.fillStyle = '#7fd4ff'; g.font = 'bold 8px sans-serif'; g.textAlign = 'center'; g.fillText(`🔭${p.n}`, x, y + 13); g.textAlign = 'left';
    g.restore();
  }
  // AI forces (only where you can see them)
  for (const a of S.aiArmies) {
    if (!isSeen(a.at)) continue;
    if (a.status === 'fighting') continue;
    const [x, y] = entPos(a), k = S.kingdoms[a.kid];
    icon(x, y, () => drawBanner(g, 0, 0, k.color, a.kind === 'raid' ? '⚔' : a.kind === 'guard' ? '🛡' : '', armyHousing(a.units), t, false, a.kind === 'raid' || hostileToPlayer(k)));
  }
  for (const f of S.aiFleets) {
    if (!isSeen(f.at)) continue;
    if (f.status === 'fighting') continue;
    const [x, y] = entPos(f), pirate = f.owner === 'pirate';
    const nx = f.path.length ? WG.cx[f.path[0]] : x, main = SHIP_TYPES.slice().reverse().find((st) => f.ships[st] > 0) || 'galley';
    icon(x, y, () => {
      drawShip(g, 0, 0, main, pirate ? '#222' : S.kingdoms[f.owner].color, nx >= x ? 1 : -1, t + x, false, pirate, 0.9);
      g.fillStyle = 'rgba(12,14,20,.85)'; g.fillRect(-14, 8, 28, 12);
      g.fillStyle = pirate ? '#ddd' : shade(S.kingdoms[f.owner].color, 0.3); g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillText(`⚓${shipCount(f.ships)}`, 0, 17); g.textAlign = 'left';
    });
  }
  // player forces
  for (const f of S.fleets) {
    if (f.status === 'fighting') continue;
    const [fx0, fy0] = entPos(f), nx = f.path.length ? WG.cx[f.path[0]] : fx0 + 1;
    g.save(); g.translate(fx0, fy0); g.scale(es, es); const x = 0, y = 0;
    if (f === selE) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y - 6, 20 + Math.sin(t * 5) * 1.5, 0, 7); g.stroke(); }
    const main = SHIP_TYPES.slice().reverse().find((st) => f.ships[st] > 0) || 'sloop';
    drawShip(g, x, y, main, '#f2c14e', nx >= fx0 ? 1 : -1, t + fx0, false, false, 1);
    g.fillStyle = 'rgba(12,14,20,.85)'; g.fillRect(x - 14, y + 8, 28, 12);
    g.fillStyle = '#f2c14e'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillText(`⚓${shipCount(f.ships)}`, x, y + 17); g.textAlign = 'left';
    g.restore();
  }
  for (const d of S.divisions) {
    if (d.status === 'fighting') continue;
    const [dx0, dy0] = entPos(d);
    const off = 0;
    const water = isWater(d.at);
    icon(dx0 + off, dy0, () => {
      if (water) drawShip(g, 0, 0, 'cog', d.color, 1, t, false, false, 0.8);
      drawBanner(g, 0, water ? -10 : 0, d.color, '', armyHousing(d.units), t, d === selE, false);
    });
  }
  drawCloudShadows(g, WG, t);
  // fog
  g.drawImage(fogLayer(), -20 / FOG_SCALE, -20 / FOG_SCALE, fogCache.width / FOG_SCALE, fogCache.height / FOG_SCALE);
  Battles.draw(g, t);   // battles stay visible above the fog
  // labels (on top of fog so known names stay readable)
  const fs = 12 / z;
  g.font = `bold ${fs}px sans-serif`; g.textAlign = 'center';
  const label = (text, x, y, c) => { const w = g.measureText(text).width + 10; g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(x - w / 2, y - fs, w, fs * 1.35); g.fillStyle = c; g.fillText(text, x, y); };
  const off = (r) => Math.max(r * W_HEX * 1.5, 26 / z);
  label(S.name, WG.cx[cap], WG.cy[cap] + off(landRadius() * 0.35), '#f2c14e');
  for (const k of S.kingdoms) if (isSeen(k.capital)) label(`${k.name} · ${k.hall}${k.atWar ? ' ⚔' : ''}`, WG.cx[k.capital], WG.cy[k.capital] + off(1 + k.hall * 0.35), shade(k.color, 0.35));
  g.textAlign = 'left';
  // selection + hover
  if (UI.worldSel >= 0 && !UI.selected) { g.strokeStyle = '#fff'; g.lineWidth = 2.5 / z; g.beginPath(); WG.hexPath(g, UI.worldSel, 0.92); g.stroke(); g.strokeStyle = '#f2c14e'; g.lineWidth = 1.5 / z; g.beginPath(); WG.hexPath(g, UI.worldSel, 1.05); g.stroke(); }
  if (UI.hover >= 0 && !UI.placing) { g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.5 / z; g.beginPath(); WG.hexPath(g, UI.hover, 0.95); g.stroke(); }
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawAtmosphere(g);
  drawMinimap(t);
}

/* ---------- minimap ---------- */
let miniCache = null, miniKey = '';
function drawMinimap() {
  const mc = el('minimap');
  if (!mc) return;
  mc.hidden = !SETTINGS.minimap;
  if (mc.hidden) return;
  const W = 200, H = Math.round(W * WG.ph / WG.pw), sc = W / WG.pw;
  if (mc.width !== W * DPR) { mc.width = W * DPR; mc.height = H * DPR; mc.style.width = W + 'px'; mc.style.height = H + 'px'; }
  const g = mc.getContext('2d');
  const key = `${worldVersion}-${seenCount}`;
  if (!miniCache || (key !== miniKey && performance.now() - (drawMinimap.at || 0) > 1500)) {
    drawMinimap.at = performance.now();
    miniKey = key;
    miniCache = document.createElement('canvas'); miniCache.width = W * DPR; miniCache.height = H * DPR;
    const m = miniCache.getContext('2d'); m.scale(DPR * sc, DPR * sc);
    m.fillStyle = DEPTH_COLORS[4]; m.fillRect(0, 0, WG.pw, WG.ph);
    for (let i = 0; i < WG.N; i++) {
      const tt = S.world.terrain[i], o = S.world.owner[i];
      if (!S.world.seen[i]) m.fillStyle = '#0c0f15';
      else if (o !== -1) m.fillStyle = o === -2 ? '#f2c14e' : S.kingdoms[o].color;
      else m.fillStyle = tt === T.WATER ? DEPTH_COLORS[Math.min(WDEPTH[i], 7) - 1] : TERRAIN[tt].color;
      m.fillRect(WG.cx[i] - W_HEX, WG.cy[i] - W_HEX, W_HEX * 2, W_HEX * 2);
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(miniCache, 0, 0);
  g.setTransform(DPR * sc, 0, 0, DPR * sc, 0, 0);
  g.fillStyle = '#fff';
  for (const d of S.divisions) { const [x, y] = entPos(d); g.fillRect(x - 25, y - 25, 50, 50); }
  g.fillStyle = '#7fd4ff';
  for (const f of S.fleets) { const [x, y] = entPos(f); g.fillRect(x - 25, y - 25, 50, 50); }
  g.fillStyle = '#ff5a4f';
  for (const a of S.aiArmies) if (a.kind === 'raid' && isSeen(a.at)) { const [x, y] = entPos(a); g.fillRect(x - 30, y - 30, 60, 60); }
  const cam = CAM, [x0, y0] = cam.toWorld(0, 0), [x1, y1] = cam.toWorld(CW, CH);
  g.strokeStyle = '#fff'; g.lineWidth = 2 / sc; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
}
function selectedEntity() {
  const s = UI.selEntity;
  if (!s) return null;
  return (s.kind === 'division' ? S.divisions : s.kind === 'scout' ? S.scouts : S.fleets).find((e) => e.id === s.id) || null;
}
