/* ==========================================================================
   Cities on the one-and-only map. Your kingdom (and every AI capital) is a
   small hex city drawn to scale on its capital world hex: zoom in to build,
   zoom out to rule the world. Drawn in kingdom coordinates under a transform.
   ========================================================================== */
'use strict';

const villagers = [];
const popTimers = {};
const bSize = (b) => (b.type === 'hall' ? K_HEX * 3.1 : K_HEX * 1.75);
const bBox = (b) => { const s = bSize(b), i = b.type === 'hall' ? HALL_HEX : b.hex; return [KG.cx[i] - s / 2, KG.cy[i] - s * 0.62, s]; };
const cityAlpha = () => clamp((CAM.z - CITY_Z * 0.75) / (CITY_Z * 0.6), 0, 1);
// world radius (in world px) covered by a city of land radius r
const cityWorldRadius = (r) => (r + 3.2) * K_HEX * SQ3 * K2W;

function cityLandColor(inside, i) {
  const h = hash2(i, 3, 1);
  let c = inside ? shade('#74a84c', (h - 0.5) * 0.1) : shade('#5e8a41', (h - 0.5) * 0.12);
  if (calendar().seasonIdx === 3) c = mix(c, '#e6edf0', 0.45);
  else if (calendar().seasonIdx === 2) c = mix(c, '#b59a45', 0.18);
  return c;
}
// Kingdom hexes visible in the current camera (in kingdom space around a centre hex).
function cityVisible(radius) {
  const [x0, y0] = CAM.toWorld(0, 0), [x1, y1] = CAM.toWorld(CW, CH);
  return KG.within(HALL_HEX, radius).filter((i) => {
    const [wx, wy] = k2w(KG.cx[i], KG.cy[i]);
    return wx > x0 - 20 && wx < x1 + 20 && wy > y0 - 20 && wy < y1 + 20;
  });
}
// Ground of a city: land hexes (textured in High quality), organic coast against the world's water.
function drawCityGround(g, list, isLand, inside, seed) {
  const hi = SETTINGS.graphics === 'high', low = SETTINGS.graphics === 'low';
  for (const i of list) {
    if (!isLand(i)) continue;
    const coastal = KG.neighbors(i).some((n) => !isLand(n));
    const path = () => { g.beginPath(); if (coastal && !low) coastPath(g, KG, i, isLand, -0.04, seed); else KG.hexPath(g, i, 1.02); };
    if (hi) { g.fillStyle = patXform(pattern(g, inside(i) ? 'grass' : 'grassDark'), 0, 0); path(); g.fill(); g.globalAlpha *= 0.25; }
    g.fillStyle = low ? shade(cityLandColor(inside(i), i), (hash2(i, 9) - 0.5) * 0.12) : cityLandColor(inside(i), i);
    path(); g.fill();
    if (hi) g.globalAlpha /= 0.25;
  }
}

/* ---------------- your city ---------------- */
function drawCity(g, t, dt) {
  const a = cityAlpha();
  if (a <= 0) return;
  const [ox, oy] = k2w(0, 0);
  g.save(); g.translate(ox, oy); g.scale(K2W, K2W);
  g.globalAlpha = a;
  const r = landRadius(), vis = cityVisible(r + 3), isLandK = (i) => KT[i] === 1;
  drawCityGround(g, vis, isLandK, inLand, S.seed);
  // plaza cobbles
  for (const i of KG.neighbors(HALL_HEX).concat(HALL_HEX)) {
    g.fillStyle = SETTINGS.graphics === 'high' ? patXform(pattern(g, 'cobble')) : '#b8ab92';
    g.beginPath(); KG.hexPath(g, i, 1.01); g.fill();
  }
  if (SETTINGS.showGrid) { g.strokeStyle = 'rgba(0,0,0,.09)'; g.lineWidth = 1; g.beginPath(); for (const i of vis) if (inLand(i) && KG.dist(i, HALL_HEX) > 1) KG.hexPath(g, i, 0.98); g.stroke(); }
  const edge = (pred, color, w, dash) => {
    g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath();
    for (const i of vis) {
      if (!pred(i)) continue;
      for (let d = 0; d < 6; d++) {
        const n = KG.nb[i * 6 + d];
        if ((n >= 0 && pred(n)) || (n >= 0 && KT[n] === 0)) continue;
        const [x0, y0] = KG.corner(i, d), [x1, y1] = KG.corner(i, d + 1); g.moveTo(x0, y0); g.lineTo(x1, y1);
      }
    }
    g.stroke(); g.setLineDash([]);
  };
  if (hallLevel() < MAX_HALL) edge((i) => KT[i] === 1 && KG.dist(i, HALL_HEX) <= r + 1, 'rgba(255,255,255,.18)', 1.5, [5, 6]);
  edge(inLand, 'rgba(0,0,0,.25)', 6);
  edge(inLand, `rgba(242,193,78,${0.75 + 0.2 * Math.sin(t * 2)})`, 2.5);
  // hover / placement / selection
  const h = UI.khover;
  if (UI.placing && h >= 0) {
    const err = placementError(UI.placing, h);
    g.fillStyle = err ? 'rgba(229,83,75,.35)' : 'rgba(87,194,107,.35)'; g.beginPath(); KG.hexPath(g, h, 0.95); g.fill();
    g.strokeStyle = err ? '#e5534b' : '#57c26b'; g.lineWidth = 2; g.stroke();
  } else if (h >= 0 && inLand(h)) { g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.5; g.beginPath(); KG.hexPath(g, h, 0.94); g.stroke(); }
  const sel = S.buildings.find((b) => b.id === UI.selected);
  if (sel) { g.strokeStyle = `rgba(242,193,78,${0.6 + 0.4 * Math.sin(t * 5)})`; g.lineWidth = 3; g.beginPath(); KG.hexPath(g, sel.type === 'hall' ? HALL_HEX : sel.hex, sel.type === 'hall' ? 1.9 : 0.95); g.stroke(); }
  // depth-sorted scenery + buildings
  const items = [];
  for (const i of vis) {
    if (KT[i] !== 1) continue;
    const o = obstacleAt(i);
    if (o && inLand(i)) items.push({ y: KG.cy[i], f: () => { if (o === 'tree') { tree(g, KG.cx[i] - 8, KG.cy[i] + 4, 9); tree(g, KG.cx[i] + 7, KG.cy[i] + 9, 8, true); } else { rock(g, KG.cx[i], KG.cy[i] + 6, 12); rock(g, KG.cx[i] + 10, KG.cy[i] - 2, 7); } } });
    else if (!inLand(i) && KG.dist(i, HALL_HEX) > r + 1 && hash2(i, 9, 2) < 0.62) {
      const n = 1 + Math.floor(hash2(i, 4) * 3);
      for (let k = 0; k < n; k++) { const x = KG.cx[i] + (hash2(i, k, 5) - 0.5) * K_HEX * 1.2, y = KG.cy[i] + (hash2(k, i, 6) - 0.5) * K_HEX; items.push({ y, f: () => tree(g, x, y, 8 + hash2(i, k) * 5, k % 2) }); }
    }
  }
  for (const b of S.buildings) { const [px, py, s] = bBox(b); items.push({ y: py + s * 0.8, f: () => drawBuilding(g, b, px, py, s, t) }); }
  items.sort((p, q) => p.y - q.y).forEach((it) => it.f());
  if (UI.placing && h >= 0 && !placementError(UI.placing, h)) {
    const s = K_HEX * 1.75; g.globalAlpha = 0.65 * a;
    drawBuilding(g, { id: 0, type: UI.placing, hex: h, level: 1, build: 0 }, KG.cx[h] - s / 2, KG.cy[h] - s * 0.62, s, t, true); g.globalAlpha = a;
  }
  for (const b of S.buildings) {
    const prod = productionOf(b);
    if (!prod || b.build > 0 || S.res[prod[0]] >= capOf(prod[0])) continue;
    popTimers[b.id] = (popTimers[b.id] ?? hash2(b.id, 1) * 6) - dt;
    if (popTimers[b.id] <= 0) {
      popTimers[b.id] = 6;
      const amt = prod[1] * 6 * prodMult(prod[0]), i = b.type === 'hall' ? HALL_HEX : b.hex;
      if (a > 0.6) floatText(KG.cx[i], KG.cy[i] - 22, `+${amt >= 10 ? fmt(amt) : amt.toFixed(1)} ${RES_META[prod[0]].icon}`, RES_META[prod[0]].color);
    }
  }
  drawVillagers(g, t, dt);
  drawFx(g, dt);
  g.restore();
}

function drawVillagers(g, t, dt) {
  if (villagers.length < 9) villagers.push({ x: KG.cx[HALL_HEX], y: KG.cy[HALL_HEX] + 30, tx: KG.cx[HALL_HEX], ty: KG.cy[HALL_HEX], c: pick(['#c0392b', '#2980b9', '#8e44ad', '#16a085', '#d35400']), wait: Math.random() * 3 });
  for (const v of villagers) {
    const d = dist(v.x, v.y, v.tx, v.ty);
    if (d < 1) {
      v.wait -= dt;
      if (v.wait <= 0) { const i = pick(KG.within(HALL_HEX, landRadius()).filter((j) => KT[j] === 1)); v.tx = KG.cx[i] + rand(-10, 10); v.ty = KG.cy[i] + rand(-8, 8); v.wait = rand(1, 4); }
    } else { const sp = Math.min(d, dt * 26); v.x += ((v.tx - v.x) / d) * sp; v.y += ((v.ty - v.y) / d) * sp; }
    const bob = d > 1 ? Math.abs(Math.sin(t * 9 + v.c.length)) * 1.5 : 0;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(v.x, v.y + 1, 3, 1.2, 0, 0, 7); g.fill();
    g.fillStyle = v.c; g.fillRect(v.x - 2, v.y - 6 - bob, 4, 5.5);
    g.fillStyle = '#f1c9a5'; g.beginPath(); g.arc(v.x, v.y - 7.5 - bob, 1.8, 0, 7); g.fill();
  }
}

/* ---------------- AI cities (procedural, from their keep level & defenses) ---------------- */
const aiCityCache = new Map();
function aiCity(k) {
  const key = `${k.id}-${k.hall}-${Math.round(k.defense / 70)}-${worldVersion > 0 ? 1 : 0}`;
  const hit = aiCityCache.get(k.id);
  if (hit && hit.key === key) return hit;
  const cx = WG.cx[k.capital], cy = WG.cy[k.capital];
  const toW = (i) => [cx + (KG.cx[i] - KG.cx[HALL_HEX]) * K2W, cy + (KG.cy[i] - KG.cy[HALL_HEX]) * K2W];
  const land = new Uint8Array(KG.N);
  for (const i of KG.within(HALL_HEX, 12)) { const [wx, wy] = toW(i), w = WG.at(wx, wy); land[i] = w >= 0 && S.world.terrain[w] !== T.WATER ? 1 : 0; }
  land[HALL_HEX] = 1; KG.neighbors(HALL_HEX).forEach((n) => { land[n] = 1; });
  const R = 3 + k.hall, rng = mulberry32(k.id * 7919 + k.hall);
  const spots = KG.within(HALL_HEX, R).filter((i) => land[i] && KG.dist(i, HALL_HEX) >= 2).sort(() => rng() - 0.5);
  const types = ['farm', 'farm', 'lumbermill', 'goldmine', 'ironmine', 'barracks', 'archery', 'warehouse', 'stable', 'university', 'farm', 'lumbermill', 'goldmine', 'workshop', 'diamondmine'];
  const lvl = Math.max(1, Math.min(6, k.hall));
  const buildings = [{ id: 1000 + k.id, type: 'hall', hex: HALL_HEX, level: lvl, build: 0, color: k.color }];
  const nBuild = Math.min(spots.length, 5 + k.hall * 4);
  for (let n = 0; n < nBuild; n++) buildings.push({ id: 2000 + k.id * 100 + n, type: types[n % types.length], hex: spots[n], level: lvl, build: 0 });
  const towers = clamp(Math.round(k.defense / 70), 1, 8);
  const ring = KG.within(HALL_HEX, R).filter((i) => land[i] && KG.dist(i, HALL_HEX) === R);
  const used = new Set(buildings.map((b) => b.hex));
  const wallSet = new Set();
  if (k.hall >= 3) ring.forEach((i) => { if (!used.has(i)) wallSet.add(i); });
  ring.filter((i) => !used.has(i)).filter((_, n, arr) => n % Math.max(1, Math.floor(arr.length / towers)) === 0).slice(0, towers)
    .forEach((i, n) => { wallSet.delete(i); used.add(i); buildings.push({ id: 3000 + k.id * 100 + n, type: n % 3 === 2 && k.hall >= 3 ? 'cannon' : 'tower', hex: i, level: lvl, build: 0 }); });
  wallSet.forEach((i) => buildings.push({ id: 4000 + i, type: 'wall', hex: i, level: lvl, build: 0, wallSet }));
  const c = { key, cx, cy, land, R, buildings };
  aiCityCache.set(k.id, c);
  return c;
}
function drawAiCity(g, k, t) {
  const a = cityAlpha();
  if (a <= 0 || !isSeen(k.capital)) return;
  const [x0, y0] = CAM.toWorld(0, 0), [x1, y1] = CAM.toWorld(CW, CH), wx = WG.cx[k.capital], wy = WG.cy[k.capital], rad = cityWorldRadius(3 + k.hall);
  if (wx + rad < x0 || wx - rad > x1 || wy + rad < y0 || wy - rad > y1) return;
  const c = aiCity(k);
  g.save(); g.translate(c.cx - KG.cx[HALL_HEX] * K2W, c.cy - KG.cy[HALL_HEX] * K2W); g.scale(K2W, K2W); g.globalAlpha = a;
  const list = KG.within(HALL_HEX, c.R + 2);
  drawCityGround(g, list, (i) => c.land[i] === 1, (i) => KG.dist(i, HALL_HEX) <= c.R, k.id + 99);
  for (const i of KG.neighbors(HALL_HEX).concat(HALL_HEX)) { g.fillStyle = SETTINGS.graphics === 'high' ? patXform(pattern(g, 'cobble')) : '#b8ab92'; g.beginPath(); KG.hexPath(g, i, 1.01); g.fill(); }
  g.strokeStyle = k.color; g.lineWidth = 3; g.beginPath();
  for (const i of list) {
    if (!c.land[i] || KG.dist(i, HALL_HEX) > c.R) continue;
    for (let d = 0; d < 6; d++) { const n = KG.nb[i * 6 + d]; if (n >= 0 && c.land[n] && KG.dist(n, HALL_HEX) <= c.R) continue; if (n >= 0 && !c.land[n]) continue; const [p0, p1] = KG.corner(i, d), [q0, q1] = KG.corner(i, d + 1); g.moveTo(p0, p1); g.lineTo(q0, q1); }
  }
  g.stroke();
  const items = c.buildings.map((b) => { const s = bSize(b), i = b.type === 'hall' ? HALL_HEX : b.hex; return { y: KG.cy[i] + s * 0.18, f: () => drawBuilding(g, b, KG.cx[i] - s / 2, KG.cy[i] - s * 0.62, s, t) }; });
  items.sort((p, q) => p.y - q.y).forEach((it) => it.f());
  g.restore();
}
// AI land has farms, mines, villages… (derived from the hex, not stored).
function aiTerritoryBuilding(i) {
  const o = S.world.owner[i];
  if (o < 0 || S.kingdoms[o].capital === i || hash2(i, 61, S.seed) > 0.4) return null;
  const t = S.world.terrain[i], f = S.world.feat[i];
  const type = f && (f.type === 'cave' || f.type === 'goldvein') ? 'mine' : t === T.FOREST ? 'lumbercamp' : t === T.HILLS ? 'mine' : [T.PLAINS, T.MEADOW, T.SWAMP].includes(t) ? (hash2(i, 62) < 0.6 ? 'farmstead' : 'village') : hash2(i, 63) < 0.5 ? 'watchtower' : 'village';
  return { type, level: clamp(1 + Math.floor(S.kingdoms[o].hall / 2), 1, 3), build: 0 };
}
