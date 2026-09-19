/* ==========================================================================
   Graphics quality: procedural textures (High), classic flat shading (Medium)
   and faceted low-poly (Low). Switch live in Settings → Graphics.
   ========================================================================== */
'use strict';

const TEX_SIZE = 512, TEX_SCALE = 0.5;     // a 512px texture covers 256 world units
const GFX = { tex: null, pat: new Map(), ctx: null };

// Draw `fn(x, y)` at a point and its wrapped copies so textures tile seamlessly.
function wrapDraw(size, x, y, pad, fn) {
  for (const dx of [0, -size, size]) for (const dy of [0, -size, size]) {
    const px = x + dx, py = y + dy;
    if (px < -pad || py < -pad || px > size + pad || py > size + pad) continue;
    fn(px, py);
  }
}
function texCanvas(base, paint, seed) {
  const c = document.createElement('canvas'); c.width = c.height = TEX_SIZE;
  const g = c.getContext('2d'), rng = mulberry32(seed);
  g.fillStyle = base; g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  // soft large-scale mottling
  for (let i = 0; i < 40; i++) {
    const x = rng() * TEX_SIZE, y = rng() * TEX_SIZE, r = 40 + rng() * 90, dark = rng() < 0.5;
    wrapDraw(TEX_SIZE, x, y, r, (px, py) => {
      const grd = g.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, dark ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.07)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  paint(g, rng);
  return c;
}
function blades(g, rng, n, palette, len = [5, 11]) {
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = rng() * TEX_SIZE, y = rng() * TEX_SIZE, l = len[0] + rng() * (len[1] - len[0]), a = -Math.PI / 2 + (rng() - 0.5) * 0.9, c = palette[Math.floor(rng() * palette.length)];
    g.strokeStyle = c; g.lineWidth = 1 + rng() * 1.3;
    wrapDraw(TEX_SIZE, x, y, 14, (px, py) => { g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(px + Math.cos(a) * l * 0.5 + (rng() - 0.5) * 3, py + Math.sin(a) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
  }
}
function specks(g, rng, n, palette, r = [0.6, 1.8]) {
  for (let i = 0; i < n; i++) {
    const x = rng() * TEX_SIZE, y = rng() * TEX_SIZE, rr = r[0] + rng() * (r[1] - r[0]);
    g.fillStyle = palette[Math.floor(rng() * palette.length)];
    wrapDraw(TEX_SIZE, x, y, 4, (px, py) => { g.beginPath(); g.arc(px, py, rr, 0, 7); g.fill(); });
  }
}
function buildTextures() {
  const G = ['#5f9440', '#6ea64a', '#7fb554', '#4f8436', '#8cbf5c', '#5a8a3a'];
  GFX.tex = {
    grass: texCanvas('#6a9e45', (g, r) => { specks(g, r, 900, ['#5a8a3a', '#7aa84f', '#4d7a33'], [0.8, 2]); blades(g, r, 5200, G); }, 11),
    grassDark: texCanvas('#557f38', (g, r) => { specks(g, r, 800, ['#476c2e', '#61893f'], [0.8, 2]); blades(g, r, 4200, ['#4a7630', '#5d8a3e', '#3f6829', '#6b9447']); }, 12),
    meadow: texCanvas('#7aae4f', (g, r) => { blades(g, r, 4600, ['#6ea64a', '#86bb5a', '#9ccb68', '#5f9440']); specks(g, r, 520, ['#f5e663', '#ffffff', '#e58ab0', '#b99cf0'], [1, 2.4]); }, 13),
    forest: texCanvas('#40683a', (g, r) => { specks(g, r, 1500, ['#5a4a2c', '#6b5634', '#355a2f', '#2e4f28'], [1, 3]); blades(g, r, 1800, ['#3a6232', '#4d7a3c', '#2f5328'], [4, 8]); }, 14),
    hills: texCanvas('#9d8d5c', (g, r) => { blades(g, r, 2600, ['#b3a26f', '#8e7e4f', '#a8995f', '#7d8a4a'], [4, 9]); specks(g, r, 700, ['#7d7466', '#a39b8b', '#8a8274'], [1, 3]); }, 15),
    rock: texCanvas('#8a847a', (g, r) => {
      specks(g, r, 2600, ['#77716a', '#9d978c', '#6b665f', '#aaa396'], [0.8, 2.6]);
      g.strokeStyle = 'rgba(40,36,32,.35)'; g.lineWidth = 1.2;
      for (let i = 0; i < 70; i++) { let x = r() * TEX_SIZE, y = r() * TEX_SIZE; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
    }, 16),
    sand: texCanvas('#e2cf98', (g, r) => { specks(g, r, 5000, ['#d4bf85', '#eddcaa', '#c9b27a', '#f2e4b8'], [0.5, 1.3]); }, 17),
    desert: texCanvas('#dcc48a', (g, r) => {
      specks(g, r, 3000, ['#d0b77a', '#e8d4a0', '#c8ad70'], [0.5, 1.4]);
      g.strokeStyle = 'rgba(160,120,60,.22)'; g.lineWidth = 2;
      for (let y = 0; y < TEX_SIZE; y += 18) { g.beginPath(); for (let x = 0; x <= TEX_SIZE; x += 8) g.lineTo(x, y + Math.sin((x / TEX_SIZE) * Math.PI * 4 + y * 0.1) * 6); g.stroke(); }
    }, 18),
    swamp: texCanvas('#5b7348', (g, r) => {
      for (let i = 0; i < 40; i++) { const x = r() * TEX_SIZE, y = r() * TEX_SIZE, w = 10 + r() * 26; wrapDraw(TEX_SIZE, x, y, w, (px, py) => { g.fillStyle = 'rgba(52,78,70,.75)'; g.beginPath(); g.ellipse(px, py, w, w * 0.5, r(), 0, 7); g.fill(); }); }
      blades(g, r, 2200, ['#6b8a4e', '#4f6b3a', '#7d9a5a'], [5, 12]);
    }, 19),
    snow: texCanvas('#eef3f6', (g, r) => { specks(g, r, 2600, ['#ffffff', '#dfe8ee', '#d4dfe6'], [0.6, 2]); }, 20),
    cobble: texCanvas('#a9a08c', (g, r) => {
      for (let y = 0; y < TEX_SIZE; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < TEX_SIZE; x += 18) {
        g.fillStyle = ['#b8ae98', '#a39985', '#c3b9a3', '#9a907c'][Math.floor(r() * 4)];
        g.beginPath(); g.ellipse(x + 8, y + 8, 7.5, 6.5, 0, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.ellipse(x + 6, y + 6, 4, 2.5, 0, 0, 7); g.fill();
      }
    }, 21),
    water: (() => {
      const c = document.createElement('canvas'); c.width = c.height = TEX_SIZE;
      const g = c.getContext('2d'), rng = mulberry32(22);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.4;
      for (let i = 0; i < 160; i++) {
        const x = rng() * TEX_SIZE, y = rng() * TEX_SIZE, w = 8 + rng() * 18;
        wrapDraw(TEX_SIZE, x, y, 30, (px, py) => { g.beginPath(); g.moveTo(px - w, py); g.quadraticCurveTo(px, py - 4, px + w, py); g.stroke(); });
      }
      g.strokeStyle = 'rgba(200,240,255,.14)'; g.lineWidth = 1;
      for (let i = 0; i < 90; i++) { let x = rng() * TEX_SIZE, y = rng() * TEX_SIZE; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rng() - 0.5) * 40; y += (rng() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
      return c;
    })(),
  };
}
function pattern(g, name) {
  if (!GFX.tex) buildTextures();
  if (GFX.ctx !== g) { GFX.pat.clear(); GFX.ctx = g; }
  let p = GFX.pat.get(name);
  if (!p) { p = g.createPattern(GFX.tex[name], 'repeat'); GFX.pat.set(name, p); }
  return p;
}
function patXform(p, dx = 0, dy = 0) { if (p.setTransform) p.setTransform(new DOMMatrix().translate(dx, dy).scale(TEX_SCALE)); return p; }
const WORLD_TEX = { 1: 'grass', 2: 'meadow', 3: 'forest', 4: 'hills', 5: 'rock', 6: 'desert', 7: 'swamp' };

/* ---- terrain dispatcher used by both maps ---- */
function drawTerrainBase(g, grid, vis, isLand, depth, landColor, seed, t, texOf, shadeOf) {
  const q = SETTINGS.graphics;
  if (q === 'low') return drawTerrainLow(g, grid, vis, isLand, depth, landColor);
  drawTerrainClassic(g, grid, vis, isLand, depth, landColor, seed, t, q === 'high' ? texOf : null, q === 'high' ? shadeOf : null);
}

function drawTerrainClassic(g, grid, vis, isLand, depth, landColor, seed, t, texOf, shadeOf) {
  const s = grid.size, hi = !!texOf;
  for (let d = 6; d >= 1; d--) {
    g.fillStyle = DEPTH_COLORS[d - 1];
    g.beginPath();
    for (const i of vis) if (!isLand(i) && Math.min(depth[i], 6) === d) { g.moveTo(grid.cx[i] + s * 1.25, grid.cy[i]); g.arc(grid.cx[i], grid.cy[i], s * 1.25, 0, Math.PI * 2); }
    g.fill();
  }
  if (hi) {   // animated water texture: two layers drifting in different directions
    const water = vis.filter((i) => !isLand(i));
    const clip = () => { g.beginPath(); for (const i of water) { g.moveTo(grid.cx[i] + s * 1.2, grid.cy[i]); g.arc(grid.cx[i], grid.cy[i], s * 1.2, 0, Math.PI * 2); } };
    g.save(); clip(); g.clip();
    g.globalAlpha = 0.45; g.fillStyle = patXform(pattern(g, 'water'), t * 7, t * 2); g.fillRect(-1e4, -1e4, 3e4, 3e4);
    g.globalAlpha = 0.25; g.fillStyle = patXform(pattern(g, 'water'), -t * 4 + 90, t * 5 + 40); g.fillRect(-1e4, -1e4, 3e4, 3e4);
    g.globalAlpha = 1;
    // sun glints
    g.fillStyle = '#ffffff';
    for (const i of water) { if (hash2(i, 91) > 0.25) continue; const a = Math.sin(t * 2.2 + i * 1.7); if (a < 0.6) continue; g.globalAlpha = (a - 0.6) * 1.6; g.fillRect(grid.cx[i] + (hash2(i, 5) - 0.5) * s, grid.cy[i] + (hash2(5, i) - 0.5) * s, 5, 1.2); }
    g.globalAlpha = 1;
    g.restore();
  }
  const coast = vis.filter((i) => isLand(i) && grid.neighbors(i).some((n) => !isLand(n)));
  const coastSet = new Set(coast);
  g.fillStyle = `rgba(235,248,252,${0.45 + 0.15 * Math.sin(t * 1.3)})`;
  g.beginPath(); for (const i of coast) coastPath(g, grid, i, isLand, 0.4 + 0.04 * Math.sin(t * 1.3 + i), seed); g.fill();
  g.fillStyle = hi ? '#b9a26c' : '#c9b27a'; g.beginPath(); for (const i of coast) coastPath(g, grid, i, isLand, 0.28, seed); g.fill();
  g.fillStyle = hi ? patXform(pattern(g, 'sand')) : '#e2cf98'; g.beginPath(); for (const i of coast) coastPath(g, grid, i, isLand, 0.16, seed); g.fill();
  const winter = calendar().seasonIdx === 3;
  if (!hi) {
    for (const i of vis) {
      if (!isLand(i)) continue;
      g.fillStyle = landColor(i); g.beginPath();
      if (coastSet.has(i)) coastPath(g, grid, i, isLand, -0.04, seed); else grid.hexPath(g, i, 1.015);
      g.fill();
    }
    return;
  }
  // HIGH: batch hexes by texture, then tint, hill-shade and snow
  const byTex = new Map();
  for (const i of vis) { if (!isLand(i)) continue; const k = texOf(i); if (!byTex.has(k)) byTex.set(k, []); byTex.get(k).push(i); }
  for (const [k, list] of byTex) {
    g.fillStyle = patXform(pattern(g, k));
    g.beginPath();
    for (const i of list) { if (coastSet.has(i)) coastPath(g, grid, i, isLand, -0.04, seed); else grid.hexPath(g, i, 1.02); }
    g.fill();
  }
  for (const i of vis) {
    if (!isLand(i)) continue;
    const path = () => { g.beginPath(); if (coastSet.has(i)) coastPath(g, grid, i, isLand, -0.04, seed); else grid.hexPath(g, i, 1.02); };
    g.globalAlpha = 0.22; g.fillStyle = landColor(i); path(); g.fill();
    const sh = shadeOf ? shadeOf(i) : 0;
    if (sh) { g.globalAlpha = Math.min(0.35, Math.abs(sh)); g.fillStyle = sh > 0 ? '#fff8e0' : '#0b1a10'; path(); g.fill(); }
    g.globalAlpha = 1;
  }
  if (winter) {
    g.globalAlpha = 0.55; g.fillStyle = patXform(pattern(g, 'snow'));
    g.beginPath(); for (const i of vis) if (isLand(i)) { if (coastSet.has(i)) coastPath(g, grid, i, isLand, -0.04, seed); else grid.hexPath(g, i, 1.02); } g.fill();
    g.globalAlpha = 1;
  }
}

// Low-poly: every hex is six flat-shaded triangles lit from the north-west.
function drawTerrainLow(g, grid, vis, isLand, depth, landColor) {
  const s = grid.size, light = -2.3;
  const tri = (i, color, amp, scale = 1) => {
    const x = grid.cx[i], y = grid.cy[i];
    for (let k = 0; k < 6; k++) {
      const [x0, y0] = [x + HEX_CORNER[k][0] * s * scale, y + HEX_CORNER[k][1] * s * scale];
      const [x1, y1] = [x + HEX_CORNER[(k + 1) % 6][0] * s * scale, y + HEX_CORNER[(k + 1) % 6][1] * s * scale];
      const ang = Math.atan2((y0 + y1) / 2 - y, (x0 + x1) / 2 - x);
      g.fillStyle = shade(color, Math.cos(ang - light) * amp + (hash2(i, k, 7) - 0.5) * amp * 0.6);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x0, y0); g.lineTo(x1, y1); g.closePath(); g.fill();
      g.strokeStyle = g.fillStyle; g.lineWidth = 0.8; g.stroke();
    }
  };
  for (const i of vis) if (!isLand(i)) tri(i, DEPTH_COLORS[Math.min(depth[i], 7) - 1] || DEPTH_COLORS[6], 0.05);
  for (const i of vis) if (isLand(i) && grid.neighbors(i).some((n) => !isLand(n))) tri(i, '#e2cf98', 0.08, 1.14);
  for (const i of vis) {
    if (!isLand(i)) continue;
    const c = landColor(i), mountain = grid === WG && S.world.terrain[i] === T.MOUNTAIN, hill = grid === WG && S.world.terrain[i] === T.HILLS;
    tri(i, c, mountain ? 0.28 : hill ? 0.16 : 0.09);
  }
}

// Hill-shading for the world map: compare pseudo-height with the north-west neighbour.
const HEIGHT = { 0: 0, 1: 0.25, 2: 0.25, 3: 0.35, 4: 0.6, 5: 1, 6: 0.28, 7: 0.15 };
function worldShade(i) {
  const t = S.world.terrain, h = HEIGHT[t[i]] + (hash2(i, 44) - 0.5) * 0.12;
  const nw = WG.nb[i * 6 + 4], w = WG.nb[i * 6 + 3];
  const hn = nw >= 0 ? HEIGHT[t[nw]] : h, hw = w >= 0 ? HEIGHT[t[w]] : h;
  return clamp(((h - hn) * 0.6 + (h - hw) * 0.3), -0.3, 0.3);
}
// Slow drifting cloud shadows (High quality only), in world coordinates.
function drawCloudShadows(g, grid, t) {
  if (SETTINGS.graphics !== 'high') return;
  for (let k = 0; k < 7; k++) {
    const r = grid.size * (6 + hash2(k, 1) * 6);
    const x = ((hash2(k, 2) * grid.pw + t * (8 + k * 1.5)) % (grid.pw + 2 * r)) - r;
    const y = hash2(k, 3) * grid.ph + Math.sin(t * 0.05 + k) * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(10,20,30,.16)'); grd.addColorStop(0.6, 'rgba(10,20,30,.08)'); grd.addColorStop(1, 'rgba(10,20,30,0)');
    g.fillStyle = grd; g.beginPath(); g.ellipse(x, y, r, r * 0.62, 0.3, 0, Math.PI * 2); g.fill();
  }
}
// Warm sunlight + vignette in screen space (High quality only).
let atmoCache = null, atmoKey = '';
function drawAtmosphere(g) {
  if (SETTINGS.graphics !== 'high') return;
  const key = `${CW}x${CH}`;
  if (key !== atmoKey) {   // render the sunlight/vignette once per screen size, not every frame
    atmoKey = key;
    atmoCache = document.createElement('canvas'); atmoCache.width = Math.ceil(CW / 2); atmoCache.height = Math.ceil(CH / 2);
    const a = atmoCache.getContext('2d'); a.scale(0.5, 0.5);
    const v = a.createRadialGradient(CW * 0.35, CH * 0.25, Math.min(CW, CH) * 0.2, CW / 2, CH / 2, Math.max(CW, CH) * 0.75);
    v.addColorStop(0, 'rgba(255,236,190,.06)'); v.addColorStop(0.6, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,10,.28)');
    a.fillStyle = v; a.fillRect(0, 0, CW, CH);
  }
  g.drawImage(atmoCache, 0, 0, CW, CH);
}

/* ---- building materials (High quality): stone, planks, roof tiles ---- */
const MAT = { tex: null, pat: new Map(), ctx: null };
function buildMaterials() {
  const mk = (paint) => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); paint(g, mulberry32(c.width + MAT.pat.size)); return c; };
  MAT.tex = {
    stone: mk((g, r) => {
      g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 16) for (let x = ((y / 16) % 2) * 12 - 12; x < 128; x += 24) {
        const v = r();
        g.fillStyle = `rgba(${v < 0.5 ? '255,255,255' : '0,0,0'},${0.06 + r() * 0.1})`; g.fillRect(x + 1, y + 1, 22, 14);
        g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 0.5, 24, 16);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + 2, y + 2, 20, 1.5);
      }
    }),
    planks: mk((g, r) => {
      for (let x = 0; x < 128; x += 16) {
        g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.05 + r() * 0.1})`; g.fillRect(x, 0, 16, 128);
        g.strokeStyle = 'rgba(40,20,5,.45)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 128); g.stroke();
        g.strokeStyle = 'rgba(60,30,10,.18)'; g.lineWidth = 1;
        for (let k = 0; k < 4; k++) { const gx = x + 3 + r() * 10; g.beginPath(); g.moveTo(gx, 0); g.bezierCurveTo(gx + 2, 40, gx - 2, 80, gx + 1, 128); g.stroke(); }
        if (r() < 0.4) { g.fillStyle = 'rgba(40,20,5,.35)'; g.beginPath(); g.ellipse(x + 8, r() * 128, 2, 3, 0, 0, 7); g.fill(); }
      }
    }),
    tiles: mk((g, r) => {
      for (let y = 0; y < 128; y += 10) for (let x = ((y / 10) % 2) * 8 - 8; x < 128; x += 16) {
        g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.05 + r() * 0.12})`;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 16, y); g.lineTo(x + 16, y + 7); g.quadraticCurveTo(x + 8, y + 12, x, y + 7); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y + 7); g.quadraticCurveTo(x + 8, y + 12, x + 16, y + 7); g.stroke();
      }
    }),
  };
}
function matPattern(g, name, scale = 0.32) {
  if (!MAT.tex) buildMaterials();
  if (MAT.ctx !== g) { MAT.pat.clear(); MAT.ctx = g; }
  let p = MAT.pat.get(name);
  if (!p) { p = g.createPattern(MAT.tex[name], 'repeat'); MAT.pat.set(name, p); }
  if (p.setTransform) p.setTransform(new DOMMatrix().scale(scale));
  return p;
}
// Grey-ish colours read as masonry, warm ones as timber.
function materialOf(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  return Math.max(r, gg, b) - Math.min(r, gg, b) < 28 ? 'stone' : 'planks';
}
