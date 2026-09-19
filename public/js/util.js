/* ==========================================================================
   Utilities: RNG, noise, formatting, colours, hex grid maths, A* pathfinding
   ========================================================================== */
'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Smooth value noise on an infinite lattice + fractal sum.
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
function fbm(x, y, seed, oct = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { v += vnoise(x * f, y * f, seed + o * 17) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
  return v / norm;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const sum = (o) => Object.values(o).reduce((s, v) => s + (v || 0), 0);
function weighted(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (!entries.length) return null;
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { if ((r -= w) <= 0) return k; }
  return entries[entries.length - 1][0];
}
function fmt(n) {
  n = Math.floor(n);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(Math.abs(n) >= 1e7 ? 0 : 1) + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(Math.abs(n) >= 1e5 ? 0 : 1) + 'k';
  return String(n);
}
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
  return Math.floor(s / 3600) + 'h ' + String(Math.floor(s / 60) % 60).padStart(2, '0') + 'm';
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}
function mix(h1, h2, t) {
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(lerp((a >> s) & 255, (b >> s) & 255, t)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const el = (id) => document.getElementById(id);

/* ------------------------------------------------------------------------
   Hex grid — pointy-top hexes, "odd-r" offset layout (odd rows shifted right).
   Neighbour/edge order: E, SE, SW, W, NW, NE. Edge d runs from corner d to
   corner d+1, where corner k sits at angle 60k-30 degrees.
   ------------------------------------------------------------------------ */
const SQ3 = Math.sqrt(3);
const HEX_DIRS = [
  [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]],   // even rows
  [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]],     // odd rows
];
const HEX_CORNER = Array.from({ length: 6 }, (_, k) => [Math.cos((Math.PI / 180) * (60 * k - 30)), Math.sin((Math.PI / 180) * (60 * k - 30))]);

class HexGrid {
  constructor(W, H, size) {
    this.W = W; this.H = H; this.size = size; this.N = W * H;
    this.cx = new Float32Array(this.N); this.cy = new Float32Array(this.N);
    this.q = new Int32Array(this.N); this.r = new Int32Array(this.N);
    this.nb = new Int32Array(this.N * 6).fill(-1);
    for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
      const i = row * W + col;
      this.cx[i] = size * SQ3 * (col + 0.5 * (row & 1)) + (size * SQ3) / 2;
      this.cy[i] = size * 1.5 * row + size;
      this.q[i] = col - (row - (row & 1)) / 2; this.r[i] = row;
      const dirs = HEX_DIRS[row & 1];
      for (let d = 0; d < 6; d++) {
        const nc = col + dirs[d][0], nr = row + dirs[d][1];
        if (nc >= 0 && nr >= 0 && nc < W && nr < H) this.nb[i * 6 + d] = nr * W + nc;
      }
    }
    this.pw = size * SQ3 * (W + 0.5);
    this.ph = size * 1.5 * (H - 1) + size * 2;
  }
  idx(col, row) { return col >= 0 && row >= 0 && col < this.W && row < this.H ? row * this.W + col : -1; }
  col(i) { return i % this.W; }
  row(i) { return (i / this.W) | 0; }
  dist(a, b) { const dq = this.q[a] - this.q[b], dr = this.r[a] - this.r[b]; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; }
  neighbors(i) { const out = []; for (let d = 0; d < 6; d++) { const n = this.nb[i * 6 + d]; if (n >= 0) out.push(n); } return out; }
  within(i, rad) {
    const out = [], c = this.col(i), r = this.row(i);
    for (let y = Math.max(0, r - rad); y <= Math.min(this.H - 1, r + rad); y++)
      for (let x = Math.max(0, c - rad - 1); x <= Math.min(this.W - 1, c + rad + 1); x++) {
        const j = y * this.W + x;
        if (this.dist(i, j) <= rad) out.push(j);
      }
    return out;
  }
  at(x, y) {
    const s = this.size, px = x - (s * SQ3) / 2, py = y - s;
    let q = ((SQ3 / 3) * px - py / 3) / s, r = ((2 / 3) * py) / s, cz = -q - r;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(cz);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - cz);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    return this.idx(rq + (rr - (rr & 1)) / 2, rr);
  }
  hexPath(g, i, scale = 1) {
    const s = this.size * scale, x = this.cx[i], y = this.cy[i];
    g.moveTo(x + HEX_CORNER[0][0] * s, y + HEX_CORNER[0][1] * s);
    for (let k = 1; k < 6; k++) g.lineTo(x + HEX_CORNER[k][0] * s, y + HEX_CORNER[k][1] * s);
    g.closePath();
  }
  corner(i, k, scale = 1) { return [this.cx[i] + HEX_CORNER[k % 6][0] * this.size * scale, this.cy[i] + HEX_CORNER[k % 6][1] * this.size * scale]; }
  // Distance map (BFS, in hex steps) from every cell matching `pred`.
  distanceField(pred, cap = 99) {
    const d = new Int16Array(this.N).fill(cap), q = [];
    for (let i = 0; i < this.N; i++) if (pred(i)) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (let k = 0; k < 6; k++) { const n = this.nb[i * 6 + k]; if (n >= 0 && d[n] > d[i] + 1) { d[n] = d[i] + 1; q.push(n); } }
    }
    return d;
  }
}

// A* over a HexGrid. cost(i) → step cost of entering hex i (Infinity = blocked).
function findPath(grid, start, goal, cost, maxExpand = 6000) {
  if (start === goal) return [];
  if (goal < 0 || !isFinite(cost(goal))) return null;
  const g = new Float32Array(grid.N).fill(Infinity), came = new Int32Array(grid.N).fill(-1), closed = new Uint8Array(grid.N);
  const heap = [];
  const push = (f, i) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  g[start] = 0; push(grid.dist(start, goal), start);
  let expanded = 0;
  while (heap.length) {
    const [, i] = pop();
    if (i === goal) break;
    if (closed[i]) continue;
    closed[i] = 1;
    if (++expanded > maxExpand) return null;
    for (let k = 0; k < 6; k++) {
      const n = grid.nb[i * 6 + k];
      if (n < 0 || closed[n]) continue;
      const c = cost(n);
      if (!isFinite(c)) continue;
      const ng = g[i] + c;
      if (ng < g[n]) { g[n] = ng; came[n] = i; push(ng + grid.dist(n, goal) * 0.95, n); }
    }
  }
  if (came[goal] < 0) return null;
  const path = [];
  for (let c = goal; c !== start; c = came[c]) path.push(c);
  return path.reverse();
}
