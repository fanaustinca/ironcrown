/* ==========================================================================
   Rendering shared by both maps: camera, organic coastlines, primitives,
   building art, particles.
   ========================================================================== */
'use strict';

let cv, ctx, CW = 800, CH = 600, DPR = 1;

class Camera {
  constructor(grid, minZ = 0.35, maxZ = 2.8) { this.grid = grid; this.x = grid.pw / 2; this.y = grid.ph / 2; this.z = 1; this.minZ = minZ; this.maxZ = maxZ; }
  toScreen(wx, wy) { return [(wx - this.x) * this.z + CW / 2, (wy - this.y) * this.z + CH / 2]; }
  toWorld(sx, sy) { return [(sx - CW / 2) / this.z + this.x, (sy - CH / 2) / this.z + this.y]; }
  apply(g) { g.setTransform(DPR * this.z, 0, 0, DPR * this.z, DPR * (CW / 2 - this.x * this.z), DPR * (CH / 2 - this.y * this.z)); }
  clamp() {
    const fitZ = Math.min(CW / this.grid.pw, CH / this.grid.ph);
    this.z = clamp(this.z, Math.max(this.minZ, fitZ * 0.85), this.maxZ);
    const hw = CW / 2 / this.z, hh = CH / 2 / this.z;
    this.x = this.grid.pw < hw * 2 ? this.grid.pw / 2 : clamp(this.x, hw - 40, this.grid.pw - hw + 40);
    this.y = this.grid.ph < hh * 2 ? this.grid.ph / 2 : clamp(this.y, hh - 40, this.grid.ph - hh + 40);
  }
  pan(dx, dy) { this.x -= dx / this.z; this.y -= dy / this.z; this.clamp(); }
  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.z = clamp(this.z * factor, this.minZ, this.maxZ);
    this.clamp();
    const [nx, ny] = this.toWorld(sx, sy);
    this.x += wx - nx; this.y += wy - ny;
    this.clamp();
  }
  centerOn(i) { this.x = this.grid.cx[i]; this.y = this.grid.cy[i]; this.clamp(); }
  visible(pad = 1) {
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(CW, CH), s = this.grid.size;
    const out = [];
    const r0 = Math.max(0, Math.floor((y0 - s) / (s * 1.5)) - pad), r1 = Math.min(this.grid.H - 1, Math.ceil((y1 - s) / (s * 1.5)) + pad);
    const c0 = Math.max(0, Math.floor(x0 / (s * SQ3)) - pad - 1), c1 = Math.min(this.grid.W - 1, Math.ceil(x1 / (s * SQ3)) + pad);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * this.grid.W + c);
    return out;
  }
  key() { return `${this.x.toFixed(1)},${this.y.toFixed(1)},${this.z.toFixed(3)},${CW},${CH}`; }
}
const CAM = new Camera(WG, 0.3, 9);   // one camera for the one map

function resize() {
  const r = cv.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  CW = Math.max(200, r.width); CH = Math.max(200, r.height);
  cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR);
  CAM.clamp();
}

/* ---------- organic coastline ----------
   Draws the outline of a land hex whose water-facing edges are replaced by
   jittered curves. grow < 0 pulls the shore in (grass), grow > 0 pushes it
   out (sand, foam). Corners shared with other land hexes never move, so
   neighbouring shapes always meet. */
function coastPath(g, grid, i, isLand, grow, seed) {
  const s = grid.size, cx = grid.cx[i], cy = grid.cy[i], water = [];
  for (let d = 0; d < 6; d++) { const n = grid.nb[i * 6 + d]; water[d] = n >= 0 ? !isLand(n) : false; }
  const pt = (k) => {
    const kk = k % 6, movable = water[(kk + 5) % 6] && water[kk];
    const f = movable ? 1 + grow + (hash2(i, kk, seed) - 0.5) * 0.24 : 1;
    return [cx + HEX_CORNER[kk][0] * s * f, cy + HEX_CORNER[kk][1] * s * f];
  };
  const p0 = pt(0);
  g.moveTo(p0[0], p0[1]);
  for (let d = 0; d < 6; d++) {
    const b = pt(d + 1);
    if (water[d]) {
      const a = pt(d), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const f = 1 + grow * 1.25 + (hash2(i, d + 10, seed) - 0.5) * 0.4;
      g.quadraticCurveTo(cx + (mx - cx) * f, cy + (my - cy) * f, b[0], b[1]);
    } else g.lineTo(b[0], b[1]);
  }
  g.closePath();
  // round off the pinch points where the coast meets a hex boundary
  if (grow > 0) for (let k = 0; k < 6; k++) {
    if (water[(k + 5) % 6] !== water[k]) { const [x, y] = [cx + HEX_CORNER[k][0] * s, cy + HEX_CORNER[k][1] * s]; g.moveTo(x + s * grow, y); g.arc(x, y, s * grow, 0, Math.PI * 2); }
  }
}
const DEPTH_COLORS = ['#58b3cf', '#4aa0c4', '#3a88b3', '#2f73a0', '#27628f', '#20557f', '#1c4a70'];
// drawTerrainBase lives in gfx.js (quality-aware).

/* ---------- primitives ---------- */
function box(g, x, y, w, d, h, top, front) { g.fillStyle = front; g.fillRect(x, y + d - h, w, h); g.fillStyle = top; g.fillRect(x, y - h, w, d); }
function gable(g, x, y, w, d, rh, color) {
  const ry = y + d * 0.45 - rh;
  g.fillStyle = shade(color, 0.18); g.beginPath(); g.moveTo(x - 2, y); g.lineTo(x + w + 2, y); g.lineTo(x + w - 2, ry); g.lineTo(x + 2, ry); g.closePath(); g.fill();
  g.fillStyle = color; g.beginPath(); g.moveTo(x + 2, ry); g.lineTo(x + w - 2, ry); g.lineTo(x + w + 2, y + d); g.lineTo(x - 2, y + d); g.closePath(); g.fill();
  g.strokeStyle = shade(color, -0.35); g.lineWidth = 1; g.beginPath(); g.moveTo(x + 2, ry); g.lineTo(x + w - 2, ry); g.stroke();
}
function cone(g, cx, by, r, h, color) {
  g.fillStyle = color; g.beginPath(); g.moveTo(cx - r, by); g.lineTo(cx + r, by); g.lineTo(cx, by - h); g.closePath(); g.fill();
  g.fillStyle = shade(color, 0.2); g.beginPath(); g.moveTo(cx - r, by); g.lineTo(cx, by); g.lineTo(cx, by - h); g.closePath(); g.fill();
}
function shadow(g, cx, cy, rx, ry) { g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.fill(); }
function flag(g, x, y, h, color, t) {
  g.fillStyle = '#5b4630'; g.fillRect(x, y - h, 2, h);
  g.fillStyle = color; g.beginPath(); g.moveTo(x + 2, y - h);
  for (let i = 0; i <= 6; i++) g.lineTo(x + 2 + i * 2.5, y - h + Math.sin(t * 5 + i * 0.9) * 1.6);
  for (let i = 6; i >= 0; i--) g.lineTo(x + 2 + i * 2.5, y - h + 8 + Math.sin(t * 5 + i * 0.9) * 1.6);
  g.fill();
}
function mound(g, x, y, s, color) {
  shadow(g, x + s / 2, y + s * 0.8, s * 0.46, s * 0.14);
  g.fillStyle = shade(color, -0.2); g.beginPath(); g.ellipse(x + s / 2, y + s * 0.62, s * 0.44, s * 0.3, 0, Math.PI, 0); g.fill();
  g.fillStyle = color; g.beginPath(); g.ellipse(x + s / 2, y + s * 0.6, s * 0.4, s * 0.36, 0, Math.PI, 0); g.fill();
  g.fillStyle = shade(color, 0.15); g.beginPath(); g.ellipse(x + s * 0.42, y + s * 0.42, s * 0.18, s * 0.1, -0.3, 0, 7); g.fill();
  g.fillStyle = '#1b1510'; g.beginPath(); g.ellipse(x + s / 2, y + s * 0.62, s * 0.13, s * 0.16, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#7a5a36'; g.fillRect(x + s * 0.35, y + s * 0.44, s * 0.3, s * 0.05); g.fillRect(x + s * 0.35, y + s * 0.44, s * 0.05, s * 0.18); g.fillRect(x + s * 0.6, y + s * 0.44, s * 0.05, s * 0.18);
}
function tree(g, x, y, r, dark) {
  shadow(g, x, y + r * 0.3, r * 0.9, r * 0.3);
  g.fillStyle = '#5a3d22'; g.fillRect(x - r * 0.1, y - r * 0.2, r * 0.2, r * 0.5);
  cone(g, x, y, r, r * 1.8, dark ? '#2b5427' : '#356b2f'); cone(g, x, y - r * 0.6, r * 0.75, r * 1.5, dark ? '#346430' : '#3f7d36');
}
function rock(g, x, y, r) {
  shadow(g, x, y + r * 0.3, r, r * 0.35);
  g.fillStyle = '#7d7f84'; g.beginPath(); g.moveTo(x - r, y + r * 0.2); g.lineTo(x - r * 0.5, y - r * 0.6); g.lineTo(x + r * 0.4, y - r * 0.8); g.lineTo(x + r, y); g.lineTo(x + r * 0.6, y + r * 0.35); g.closePath(); g.fill();
  g.fillStyle = '#a2a4a9'; g.beginPath(); g.moveTo(x - r * 0.5, y - r * 0.6); g.lineTo(x + r * 0.4, y - r * 0.8); g.lineTo(x + r * 0.1, y - r * 0.1); g.closePath(); g.fill();
}
function levelBadge(g, x, y, lvl) {
  g.fillStyle = 'rgba(20,24,32,.88)'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
  g.strokeStyle = '#f2c14e'; g.lineWidth = 1; g.stroke();
  g.fillStyle = '#f2c14e'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(lvl, x, y + 0.5); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

/* ---------- building art (px,py = top-left of an s×s box) ---------- */
function drawBuilding(g, b, px, py, s, t, ghost) {
  if (b.level === 0 && !ghost) return drawScaffold(g, b, px, py, s);
  const u = s / 40, seed = b.id * 1.7;
  switch (b.type) {
    case 'hall': {
      const lvl = b.level, roof = lvl >= 5 ? '#6a3fa0' : lvl >= 3 ? '#b5452f' : '#3f6fb5';
      shadow(g, px + s / 2, py + s * 0.9, s * 0.48, s * 0.12);
      box(g, px + s * 0.1, py + s * 0.34, s * 0.8, s * 0.56, s * 0.2, '#b3b7bf', '#8a8f99');
      box(g, px + s * 0.24, py + s * 0.3, s * 0.52, s * 0.36, s * 0.34, '#c4c8cf', '#9ca1ab');
      gable(g, px + s * 0.24, py + s * 0.3 - s * 0.34, s * 0.52, s * 0.36, s * 0.16, roof);
      for (const cx of [0.14, 0.86]) { box(g, px + s * cx - s * 0.08, py + s * 0.66, s * 0.16, s * 0.2, s * 0.34, '#c4c8cf', '#9ca1ab'); cone(g, px + s * cx, py + s * 0.66 - s * 0.34 + 1, s * 0.1, s * 0.16, roof); }
      g.fillStyle = '#4a3522'; g.beginPath(); g.moveTo(px + s * 0.43, py + s * 0.9); g.lineTo(px + s * 0.43, py + s * 0.8); g.arc(px + s / 2, py + s * 0.8, s * 0.07, Math.PI, 0); g.lineTo(px + s * 0.57, py + s * 0.9); g.fill();
      if (lvl >= 2) { g.fillStyle = '#f2c14e'; g.fillRect(px + s * 0.24, py + s * 0.62, s * 0.52, 2); }
      if (lvl >= 4) for (const cx of [0.3, 0.7]) { g.fillStyle = '#b5452f'; g.fillRect(px + s * cx - 3, py + s * 0.52, 6, s * 0.12); }
      if (lvl >= 6) { g.fillStyle = '#f2c14e'; for (let i = 0; i < 5; i++) g.fillRect(px + s * (0.3 + i * 0.1), py + s * 0.13, 3, 5); }
      flag(g, px + s / 2, py + s * 0.02, s * 0.26, b.color || '#f2c14e', t);
      break;
    }
    case 'goldmine': case 'ironmine': case 'diamondmine': {
      const col = b.type === 'goldmine' ? '#9c7a4a' : b.type === 'ironmine' ? '#7d8189' : '#4b4458';
      mound(g, px, py, s, col);
      for (let i = 0; i < 5; i++) {
        const ox = px + s * (0.18 + hash2(b.id, i) * 0.64), oy = py + s * (0.3 + hash2(i, b.id) * 0.25);
        if (b.type === 'diamondmine') {
          const glow = 0.6 + 0.4 * Math.sin(t * 3 + i);
          g.fillStyle = `rgba(111,227,242,${0.35 * glow})`; g.beginPath(); g.arc(ox, oy, 6 * u, 0, 7); g.fill();
          g.fillStyle = '#6fe3f2'; g.beginPath(); g.moveTo(ox, oy - 6 * u); g.lineTo(ox + 3 * u, oy); g.lineTo(ox, oy + 3 * u); g.lineTo(ox - 3 * u, oy); g.fill();
        } else {
          g.fillStyle = b.type === 'goldmine' ? '#f2c14e' : '#c6d2de'; g.beginPath(); g.arc(ox, oy, 2.2 * u, 0, 7); g.fill();
          if (b.type === 'goldmine' && Math.sin(t * 4 + i * 2 + seed) > 0.93) { g.fillStyle = '#fff'; g.fillRect(ox - 4 * u, oy - 0.5, 8 * u, 1); g.fillRect(ox - 0.5, oy - 4 * u, 1, 8 * u); }
        }
      }
      const cx = px + s * (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.8 + seed)));
      g.fillStyle = '#5b4630'; g.fillRect(cx - 5 * u, py + s * 0.78, 10 * u, 5 * u);
      g.fillStyle = RES_META[b.type === 'goldmine' ? 'gold' : b.type === 'ironmine' ? 'iron' : 'diamonds'].color; g.fillRect(cx - 4 * u, py + s * 0.76, 8 * u, 2.5 * u);
      g.fillStyle = '#222'; g.beginPath(); g.arc(cx - 3 * u, py + s * 0.78 + 5 * u, 1.6 * u, 0, 7); g.arc(cx + 3 * u, py + s * 0.78 + 5 * u, 1.6 * u, 0, 7); g.fill();
      break;
    }
    case 'lumbermill': {
      shadow(g, px + s / 2, py + s * 0.85, s * 0.44, s * 0.12);
      for (let i = 0; i < 3; i++) { g.fillStyle = '#8b5a2b'; g.fillRect(px + s * 0.08, py + s * (0.62 + i * 0.08), s * 0.34, s * 0.07); g.fillStyle = '#d9a86a'; g.beginPath(); g.arc(px + s * 0.08, py + s * (0.655 + i * 0.08), s * 0.035, 0, 7); g.fill(); }
      box(g, px + s * 0.44, py + s * 0.42, s * 0.48, s * 0.42, s * 0.22, '#a0703f', '#7b5230');
      gable(g, px + s * 0.44, py + s * 0.2, s * 0.48, s * 0.42, s * 0.12, '#b5452f');
      g.save(); g.translate(px + s * 0.3, py + s * 0.42); g.rotate(t * 6);
      g.fillStyle = '#c9ced6'; g.beginPath();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = i % 2 ? s * 0.13 : s * 0.104; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.fill(); g.fillStyle = '#555'; g.beginPath(); g.arc(0, 0, s * 0.03, 0, 7); g.fill(); g.restore();
      break;
    }
    case 'farm': {
      g.fillStyle = '#6b4f2d'; g.fillRect(px + s * 0.05, py + s * 0.12, s * 0.9, s * 0.82);
      const winter = calendar().seasonIdx === 3;
      for (let i = 0; i < 5; i++) {
        const ry = py + s * (0.18 + i * 0.15);
        g.fillStyle = winter ? '#e8eef2' : i % 2 ? '#c9b24a' : '#8fbf4a';
        for (let j = 0; j < 7; j++) g.fillRect(px + s * (0.1 + j * 0.12) + Math.sin(t * 2 + j * 0.6 + i) * 1.5 * u, ry, s * 0.07, s * 0.1);
      }
      box(g, px + s * 0.62, py + s * 0.62, s * 0.3, s * 0.3, s * 0.14, '#b5452f', '#8a3322');
      gable(g, px + s * 0.62, py + s * 0.48, s * 0.3, s * 0.3, s * 0.08, '#6d3a2a');
      break;
    }
    case 'warehouse': {
      shadow(g, px + s / 2, py + s * 0.88, s * 0.46, s * 0.12);
      box(g, px + s * 0.08, py + s * 0.42, s * 0.84, s * 0.46, s * 0.26, '#a98a5e', '#86694a');
      gable(g, px + s * 0.08, py + s * 0.16, s * 0.84, s * 0.46, s * 0.12, '#6f7f8f');
      g.fillStyle = '#3a2b1a'; g.fillRect(px + s * 0.4, py + s * 0.7, s * 0.2, s * 0.18);
      for (let i = 0; i < 3; i++) box(g, px + s * (0.12 + i * 0.1), py + s * 0.84, s * 0.09, s * 0.08, s * 0.08, '#c89a5a', '#9c7442');
      break;
    }
    case 'wall': {
      const i = b.hex, h = s * 0.3, c1 = b.level >= 4 ? '#c0c4cc' : b.level >= 2 ? '#a9adb6' : '#9aa0a8', c2 = shade(c1, -0.28);
      const cx = KG.cx[i], cy = KG.cy[i];
      g.lineCap = 'butt';
      for (let d = 0; d < 6; d++) {
        const n = KG.nb[i * 6 + d];
        if (n < 0 || !(b.wallSet ? b.wallSet.has(n) : (S.buildings.find((x) => x.hex === n) || {}).type === 'wall')) continue;
        const mx = (cx + KG.cx[n]) / 2, my = (cy + KG.cy[n]) / 2;
        g.strokeStyle = c2; g.lineWidth = s * 0.26; g.beginPath(); g.moveTo(cx, cy + s * 0.05); g.lineTo(mx, my + s * 0.05); g.stroke();
        g.strokeStyle = c1; g.lineWidth = s * 0.26; g.beginPath(); g.moveTo(cx, cy - h * 0.7); g.lineTo(mx, my - h * 0.7); g.stroke();
      }
      box(g, cx - s * 0.17, cy - s * 0.12, s * 0.34, s * 0.3, h, shade(c1, 0.1), c2);
      g.fillStyle = shade(c1, 0.15); for (let k = 0; k < 2; k++) g.fillRect(cx - s * 0.17 + k * s * 0.22, cy - s * 0.12 - h - s * 0.06, s * 0.12, s * 0.07);
      break;
    }
    case 'tower': {
      shadow(g, px + s / 2, py + s * 0.85, s * 0.3, s * 0.1);
      box(g, px + s * 0.28, py + s * 0.5, s * 0.44, s * 0.36, s * 0.72, '#b8bcc4', '#8f949d');
      for (let i = 0; i < 3; i++) box(g, px + s * (0.26 + i * 0.17), py + s * 0.5 - s * 0.72, s * 0.1, s * 0.1, s * 0.08, '#c9cdd4', '#9da2ab');
      g.fillStyle = '#2b2b2b'; g.fillRect(px + s * 0.46, py + s * 0.52, s * 0.08, s * 0.14);
      g.fillStyle = '#3f6fb5'; g.beginPath(); g.arc(px + s * 0.5, py + s * 0.5 - s * 0.66, s * 0.05, 0, 7); g.fill();
      break;
    }
    case 'cannon': {
      shadow(g, px + s / 2, py + s * 0.78, s * 0.42, s * 0.14);
      g.fillStyle = '#7d818a'; g.beginPath(); g.ellipse(px + s / 2, py + s * 0.66, s * 0.4, s * 0.2, 0, 0, 7); g.fill();
      g.fillStyle = '#9aa0a8'; g.beginPath(); g.ellipse(px + s / 2, py + s * 0.6, s * 0.4, s * 0.2, 0, 0, 7); g.fill();
      g.save(); g.translate(px + s / 2, py + s * 0.52); g.rotate(Math.sin(t * 0.6 + seed) * 1.2 - Math.PI / 2);
      g.fillStyle = '#2d2f33'; g.fillRect(0, -s * 0.07, s * 0.36, s * 0.14); g.fillStyle = '#44474d'; g.fillRect(s * 0.3, -s * 0.09, s * 0.08, s * 0.18);
      g.restore();
      g.fillStyle = '#5b4630'; g.beginPath(); g.arc(px + s / 2, py + s * 0.52, s * 0.1, 0, 7); g.fill();
      break;
    }
    case 'spire': {
      shadow(g, px + s / 2, py + s * 0.85, s * 0.28, s * 0.1);
      g.fillStyle = '#4b3a6b'; g.beginPath(); g.moveTo(px + s * 0.3, py + s * 0.86); g.lineTo(px + s * 0.7, py + s * 0.86); g.lineTo(px + s * 0.56, py - s * 0.1); g.lineTo(px + s * 0.44, py - s * 0.1); g.fill();
      g.fillStyle = '#6a5394'; g.beginPath(); g.moveTo(px + s * 0.3, py + s * 0.86); g.lineTo(px + s * 0.5, py + s * 0.86); g.lineTo(px + s * 0.5, py - s * 0.1); g.lineTo(px + s * 0.44, py - s * 0.1); g.fill();
      const pulse = 0.7 + 0.3 * Math.sin(t * 3);
      const grd = g.createRadialGradient(px + s / 2, py - s * 0.22, 0, px + s / 2, py - s * 0.22, s * 0.3 * pulse);
      grd.addColorStop(0, 'rgba(210,170,255,.95)'); grd.addColorStop(1, 'rgba(176,124,242,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(px + s / 2, py - s * 0.22, s * 0.3 * pulse, 0, 7); g.fill();
      g.fillStyle = '#efe0ff'; g.beginPath(); g.arc(px + s / 2, py - s * 0.22, s * 0.07, 0, 7); g.fill();
      break;
    }
    case 'port': {
      const dir = b.color ? 0 : waterDir(b.hex);
      g.save(); g.translate(px + s / 2, py + s / 2); g.rotate(dir);
      g.fillStyle = '#7b5230'; g.fillRect(-s * 0.1, -s * 0.16, s * 1.05, s * 0.32);
      g.fillStyle = '#a0703f'; for (let i = 0; i < 6; i++) g.fillRect(-s * 0.08 + i * s * 0.17, -s * 0.16, s * 0.14, s * 0.3);
      const bob = Math.sin(t * 1.6 + seed) * 1.5;
      g.restore();
      box(g, px + s * 0.2, py + s * 0.36, s * 0.4, s * 0.32, s * 0.2, '#a0703f', '#7b5230');
      gable(g, px + s * 0.2, py + s * 0.16, s * 0.4, s * 0.32, s * 0.1, '#3f6fb5');
      const sx = px + s / 2 + Math.cos(dir) * s * 0.95, sy = py + s / 2 + Math.sin(dir) * s * 0.95 + s * 0.2;
      drawShip(g, sx + Math.sin(t * 0.3 + seed) * 3, sy + bob, 'cog', '#f2c14e', 1, t, false, false, s / 40);
      break;
    }
    case 'shipyard': {
      const dir = waterDir(b.hex);
      g.save(); g.translate(px + s / 2, py + s / 2); g.rotate(dir);
      g.fillStyle = '#6b4a2c'; g.fillRect(-s * 0.3, -s * 0.28, s * 1.1, s * 0.56);
      g.fillStyle = '#8a6440'; for (let i = 0; i < 7; i++) g.fillRect(-s * 0.28 + i * s * 0.155, -s * 0.28, s * 0.03, s * 0.56);
      g.strokeStyle = '#d2b48c'; g.lineWidth = 2;
      for (let i = 0; i < 6; i++) { const x = -s * 0.1 + i * s * 0.12; g.beginPath(); g.moveTo(x, -s * 0.2); g.quadraticCurveTo(x + s * 0.04, 0, x, s * 0.2); g.stroke(); }
      g.beginPath(); g.moveTo(-s * 0.15, 0); g.lineTo(s * 0.6, 0); g.stroke();
      g.restore();
      g.fillStyle = '#4a321f'; g.fillRect(px + s * 0.12, py - s * 0.1, s * 0.05, s * 0.8);
      g.strokeStyle = '#4a321f'; g.lineWidth = s * 0.04; g.beginPath(); g.moveTo(px + s * 0.14, py - s * 0.08); g.lineTo(px + s * 0.7 + Math.sin(t * 0.5) * s * 0.05, py + s * 0.05); g.stroke();
      g.strokeStyle = '#ccc'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + s * 0.7 + Math.sin(t * 0.5) * s * 0.05, py + s * 0.05); g.lineTo(px + s * 0.7, py + s * 0.35 + Math.sin(t) * 3); g.stroke();
      break;
    }
    case 'university': {
      shadow(g, px + s / 2, py + s * 0.88, s * 0.46, s * 0.12);
      box(g, px + s * 0.1, py + s * 0.46, s * 0.8, s * 0.42, s * 0.28, '#e3dccb', '#bdb39c');
      g.fillStyle = '#f4efe2'; for (let i = 0; i < 5; i++) g.fillRect(px + s * (0.15 + i * 0.16), py + s * 0.64, s * 0.06, s * 0.24);
      g.fillStyle = '#cfc5ad'; g.beginPath(); g.moveTo(px + s * 0.08, py + s * 0.62); g.lineTo(px + s * 0.5, py + s * 0.5); g.lineTo(px + s * 0.92, py + s * 0.62); g.fill();
      g.fillStyle = '#3f6fb5'; g.beginPath(); g.arc(px + s / 2, py + s * 0.18, s * 0.2, Math.PI, 0); g.fill();
      g.fillStyle = '#5a88cc'; g.beginPath(); g.arc(px + s * 0.45, py + s * 0.18, s * 0.12, Math.PI, Math.PI * 1.5); g.lineTo(px + s * 0.45, py + s * 0.18); g.fill();
      g.fillStyle = '#f2c14e'; g.fillRect(px + s / 2 - 1, py - s * 0.08, 2, s * 0.08);
      if (b.research) { g.fillStyle = `rgba(255,240,180,${0.5 + 0.4 * Math.sin(t * 4)})`; g.fillRect(px + s * 0.44, py + s * 0.08, s * 0.12, s * 0.06); }
      break;
    }
    case 'workshop': {
      shadow(g, px + s / 2, py + s * 0.88, s * 0.46, s * 0.12);
      box(g, px + s * 0.06, py + s * 0.46, s * 0.46, s * 0.4, s * 0.22, '#8f7355', '#6d563f');
      gable(g, px + s * 0.06, py + s * 0.24, s * 0.46, s * 0.4, s * 0.1, '#5d5d66');
      g.strokeStyle = '#6b4a2c'; g.lineWidth = s * 0.05;
      g.beginPath(); g.moveTo(px + s * 0.58, py + s * 0.86); g.lineTo(px + s * 0.74, py + s * 0.5); g.lineTo(px + s * 0.9, py + s * 0.86); g.stroke();
      const a = -0.8 + Math.sin(t * 1.5 + seed) * 0.4;
      g.beginPath(); g.moveTo(px + s * 0.74, py + s * 0.52); g.lineTo(px + s * 0.74 + Math.cos(a) * s * 0.3, py + s * 0.52 + Math.sin(a) * s * 0.3); g.stroke();
      break;
    }
    case 'archery': {
      shadow(g, px + s / 2, py + s * 0.85, s * 0.44, s * 0.1);
      g.fillStyle = '#c9b48a'; g.beginPath(); g.moveTo(px + s * 0.08, py + s * 0.86); g.lineTo(px + s * 0.34, py + s * 0.22); g.lineTo(px + s * 0.6, py + s * 0.86); g.fill();
      g.fillStyle = '#a8946a'; g.beginPath(); g.moveTo(px + s * 0.34, py + s * 0.22); g.lineTo(px + s * 0.6, py + s * 0.86); g.lineTo(px + s * 0.34, py + s * 0.86); g.fill();
      g.fillStyle = '#3a2b1a'; g.beginPath(); g.moveTo(px + s * 0.28, py + s * 0.86); g.lineTo(px + s * 0.34, py + s * 0.6); g.lineTo(px + s * 0.4, py + s * 0.86); g.fill();
      const tx = px + s * 0.78, ty = py + s * 0.5;
      g.fillStyle = '#5b4630'; g.fillRect(tx - 1, ty, 2, s * 0.34);
      [['#fff', 0.16], ['#e5534b', 0.12], ['#fff', 0.08], ['#e5534b', 0.04]].forEach(([c, r]) => { g.fillStyle = c; g.beginPath(); g.arc(tx, ty, s * r, 0, 7); g.fill(); });
      flag(g, px + s * 0.34, py + s * 0.24, s * 0.16, '#57c26b', t);
      break;
    }
    case 'barracks': {
      shadow(g, px + s / 2, py + s * 0.88, s * 0.46, s * 0.12);
      box(g, px + s * 0.08, py + s * 0.4, s * 0.84, s * 0.48, s * 0.26, '#b89c78', '#8d7556');
      gable(g, px + s * 0.08, py + s * 0.14, s * 0.84, s * 0.48, s * 0.14, '#9e3a2a');
      g.strokeStyle = '#d7dbe2'; g.lineWidth = 2 * u;
      g.beginPath(); g.moveTo(px + s * 0.4, py + s * 0.66); g.lineTo(px + s * 0.6, py + s * 0.82); g.moveTo(px + s * 0.6, py + s * 0.66); g.lineTo(px + s * 0.4, py + s * 0.82); g.stroke();
      break;
    }
    case 'stable': {
      shadow(g, px + s / 2, py + s * 0.88, s * 0.46, s * 0.12);
      box(g, px + s * 0.06, py + s * 0.38, s * 0.7, s * 0.5, s * 0.24, '#9c6b3f', '#76502e');
      gable(g, px + s * 0.06, py + s * 0.14, s * 0.7, s * 0.5, s * 0.14, '#6d3a2a');
      g.fillStyle = '#3a2716'; g.fillRect(px + s * 0.3, py + s * 0.66, s * 0.2, s * 0.22);
      const hb = Math.sin(t * 1.5 + seed) * 1.5;
      g.fillStyle = '#5a3a22'; g.fillRect(px + s * 0.34, py + s * 0.66 + hb, s * 0.08, s * 0.12); g.fillRect(px + s * 0.34, py + s * 0.66 + hb, s * 0.14, s * 0.05);
      g.fillStyle = '#d6b85a'; g.beginPath(); g.ellipse(px + s * 0.86, py + s * 0.8, s * 0.1, s * 0.08, 0, 0, 7); g.fill();
      break;
    }
    case 'scoutlodge': {
      shadow(g, px + s / 2, py + s * 0.88, s * 0.4, s * 0.1);
      box(g, px + s * 0.1, py + s * 0.52, s * 0.44, s * 0.36, s * 0.2, '#8f6a45', '#6f5034');
      gable(g, px + s * 0.1, py + s * 0.32, s * 0.44, s * 0.36, s * 0.1, '#4e7a3a');
      g.fillStyle = '#6f5034'; g.fillRect(px + s * 0.66, py + s * 0.1, s * 0.04, s * 0.78); g.fillRect(px + s * 0.84, py + s * 0.1, s * 0.04, s * 0.78);
      g.fillStyle = '#8f6a45'; g.fillRect(px + s * 0.6, py + s * 0.04, s * 0.34, s * 0.1);
      g.fillStyle = Math.sin(t * 2 + seed) > 0.8 ? '#fff' : '#9fb3c8'; g.beginPath(); g.arc(px + s * 0.92, py + s * 0.02, s * 0.03, 0, 7); g.fill();
      break;
    }
  }
  if (!ghost && b.type !== 'wall') levelBadge(g, px + s - 8, py + s - 6, b.level);
  if (!ghost && b.build > 0) drawScaffold(g, b, px, py, s, true);
}
function waterDir(i) {
  for (let d = 0; d < 6; d++) { const n = KG.nb[i * 6 + d]; if (n >= 0 && KT[n] === 0) return Math.atan2(KG.cy[n] - KG.cy[i], KG.cx[n] - KG.cx[i]); }
  return 0;
}
function drawScaffold(g, b, px, py, s, overlay) {
  if (!overlay) {
    shadow(g, px + s / 2, py + s * 0.85, s * 0.42, s * 0.12);
    g.fillStyle = '#8a6d4a'; g.fillRect(px + s * 0.12, py + s * 0.6, s * 0.76, s * 0.28);
    g.fillStyle = '#a6a9ae'; g.fillRect(px + s * 0.18, py + s * 0.66, s * 0.26, s * 0.12); g.fillRect(px + s * 0.5, py + s * 0.7, s * 0.3, s * 0.1);
  }
  g.strokeStyle = '#c39a62'; g.lineWidth = 1.5; g.beginPath();
  for (const fx of [0.14, 0.5, 0.86]) { g.moveTo(px + s * fx, py + s * 0.88); g.lineTo(px + s * fx, py + s * 0.18); }
  for (const fy of [0.3, 0.55, 0.8]) { g.moveTo(px + s * 0.12, py + s * fy); g.lineTo(px + s * 0.88, py + s * fy); }
  g.moveTo(px + s * 0.14, py + s * 0.8); g.lineTo(px + s * 0.5, py + s * 0.3); g.stroke();
  const p = 1 - b.build / b.buildTotal;
  g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(px + 3, py - 2, s - 6, 7);
  g.fillStyle = '#f2c14e'; g.fillRect(px + 4, py - 1, (s - 8) * p, 5);
  if (SETTINGS.particles && Math.random() < 0.08) UI.fx.push({ kind: 'spark', x: px + Math.random() * s, y: py + s * 0.3, vx: rand(-30, 30), vy: rand(-60, -15), life: 0.5, max: 0.5, color: '#ffd27a' });
}

/* ---------- particles (kingdom-map world coordinates) ---------- */
function spawnDust(i) {
  if (!SETTINGS.particles) return;
  for (let k = 0; k < 18; k++) UI.fx.push({ kind: 'dust', x: KG.cx[i] + rand(-18, 18), y: KG.cy[i] + rand(0, 14), vx: rand(-25, 25), vy: rand(-35, -8), life: 0.9, max: 0.9, r: rand(2, 5) });
}
function spawnSparkles(i) {
  if (!SETTINGS.particles) return;
  for (let k = 0; k < 26; k++) UI.fx.push({ kind: 'spark', x: KG.cx[i], y: KG.cy[i] - 10, vx: rand(-80, 80), vy: rand(-110, -20), life: 1.1, max: 1.1, color: pick(['#f2c14e', '#fff3c4', '#ffffff']) });
}
function floatText(x, y, text, color) { if (SETTINGS.prodNumbers) UI.fx.push({ kind: 'text', x, y, text, color, life: 1.6, max: 1.6 }); }
function celebrate() { if (!SETTINGS.particles) return; for (let k = 0; k < 80; k++) UI.fx.push({ kind: 'spark', x: KG.cx[HALL_HEX], y: KG.cy[HALL_HEX] - 20, vx: rand(-200, 200), vy: rand(-240, -30), life: 1.8, max: 1.8, color: pick(['#f2c14e', '#e5534b', '#4ea1f2', '#57c26b', '#fff']) }); }
let shakeAmt = 0;
function shake(n) { shakeAmt = Math.max(shakeAmt, n); }
function drawFx(g, dt) {
  for (const f of UI.fx) {
    f.life -= dt;
    const a = clamp(f.life / f.max, 0, 1);
    g.globalAlpha = a;
    if (f.kind === 'text') {
      const y = f.y - (1 - a) * 36;
      g.font = 'bold 12px sans-serif'; g.textAlign = 'center';
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(f.text, f.x + 1, y + 1);
      g.fillStyle = f.color || '#fff'; g.fillText(f.text, f.x, y); g.textAlign = 'left';
    } else {
      f.x += f.vx * dt; f.y += f.vy * dt; f.vy += (f.kind === 'dust' ? 20 : 160) * dt;
      if (f.kind === 'dust') { g.fillStyle = '#d8cbb0'; g.beginPath(); g.arc(f.x, f.y, f.r * (1.5 - a * 0.5), 0, 7); g.fill(); }
      else { g.fillStyle = f.color; g.fillRect(f.x - 1.5, f.y - 1.5, 3, 3); }
    }
    g.globalAlpha = 1;
  }
  UI.fx = UI.fx.filter((f) => f.life > 0);
  if (UI.fx.length > 400) UI.fx.splice(0, UI.fx.length - 400);
}
