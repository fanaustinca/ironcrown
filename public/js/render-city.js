/* ==========================================================================
   Cities on the one hex map: your buildings (anywhere on your land) and the
   procedural cities of AI kingdoms, drawn straight onto map hexes.
   ========================================================================== */
'use strict';

const villagers = [];
const popTimers = {};
const artSize = (b) => (b.type === 'hall' ? K_HEX * 3.1 : K_HEX * 1.75);
// Draw a building's art centred on its map hex (art is authored at K_HEX scale).
function drawOnHex(g, b, t, ghost) {
  const s = artSize(b);
  g.save(); g.translate(WG.cx[b.hex], WG.cy[b.hex]); g.scale(ART, ART);
  drawBuilding(g, b, -s / 2, -s * 0.62, s, t, ghost);
  g.restore();
}
const CAT_DOT = { resource: '#c9a34a', defense: '#9aa0a8', military: '#b5452f', naval: '#3f6fb5', civic: '#e3dccb', core: '#f2c14e' };

/* ---- AI cities: procedural, around each capital, on hexes they own ---- */
const aiCityCache = new Map();
function aiCity(k) {
  const hit = aiCityCache.get(k.id);
  if (hit && hit.hall === k.hall && S.time - hit.at < 30) return hit;
  const R = 2 + k.hall, rng = mulberry32(k.id * 7919 + k.hall), cap = k.capital;
  const own = (i) => S.world.owner[i] === k.id && buildableTerrain(i);
  const spots = WG.within(cap, R - 1).filter((i) => own(i) && WG.dist(i, cap) >= 2).sort(() => rng() - 0.5);
  const types = ['farm', 'lumbermill', 'goldmine', 'village', 'barracks', 'farm', 'archery', 'ironmine', 'warehouse', 'stable', 'university', 'village', 'goldmine', 'workshop', 'farm', 'diamondmine', 'lumbermill', 'village'];
  const lvl = Math.max(1, Math.min(6, k.hall));
  const buildings = [{ id: 1000 + k.id, type: 'hall', hex: cap, level: lvl, build: 0, color: k.color }];
  const n = Math.min(spots.length, 4 + k.hall * 3);
  for (let j = 0; j < n; j++) buildings.push({ id: 2000 + k.id * 100 + j, type: types[j % types.length], hex: spots[j], level: lvl, build: 0 });
  const ring = WG.within(cap, R).filter((i) => own(i) && WG.dist(i, cap) === R);
  const towers = clamp(Math.round(k.defense / 70), 1, 8), step = Math.max(1, Math.floor(ring.length / towers));
  const wallSet = new Set();
  ring.forEach((i, j) => { if (j % step === 0 && j / step < towers) buildings.push({ id: 3000 + k.id * 100 + j, type: j % 3 === 2 && k.hall >= 3 ? 'cannon' : 'tower', hex: i, level: lvl, build: 0 }); else if (k.hall >= 3) wallSet.add(i); });
  wallSet.forEach((i) => buildings.push({ id: 4000 + i, type: 'wall', hex: i, level: lvl, build: 0, wallSet }));
  const c = { hall: k.hall, at: S.time, buildings, R };
  aiCityCache.set(k.id, c);
  return c;
}

function drawCityLayer(g, t, dt, vis) {
  const z = CAM.z, visSet = new Set(vis), cap = S.world.capital, detail = z * W_HEX >= 5;
  // plazas
  const plaza = (c) => { for (const i of [c].concat(WG.neighbors(c))) { if (!visSet.has(i)) continue; g.fillStyle = SETTINGS.graphics === 'high' ? patXform(pattern(g, 'cobble'), 0, 0) : '#b8ab92'; g.beginPath(); WG.hexPath(g, i, 1.02); g.fill(); } };
  plaza(cap);
  for (const k of S.kingdoms) if (isSeen(k.capital)) plaza(k.capital);
  // cleared hexes & loose rocks on your land
  if (detail) for (const i of vis) {
    if (S.world.owner[i] !== -2) continue;
    if (cleared(i) && [T.FOREST, T.HILLS].includes(S.world.terrain[i])) { g.fillStyle = SETTINGS.graphics === 'high' ? patXform(pattern(g, 'grass')) : '#7fae55'; g.globalAlpha = 0.9; g.beginPath(); WG.hexPath(g, i, 0.98); g.fill(); g.globalAlpha = 1; }
    const o = obstacleAt(i);
    if (o === 'rock' && detail && S.world.terrain[i] !== T.HILLS && !buildingAt(i)) { g.save(); g.translate(WG.cx[i], WG.cy[i]); g.scale(ART, ART); rock(g, 0, 6, 12); rock(g, 10, -2, 7); g.restore(); }
    else if (o === 'tree' && detail && S.world.terrain[i] !== T.FOREST && !buildingAt(i)) { g.save(); g.translate(WG.cx[i], WG.cy[i]); g.scale(ART, ART); tree(g, -8, 4, 9); tree(g, 7, 9, 8, true); g.restore(); }
  }
  // placement / hover / selection
  const h = UI.hover;
  if (UI.placing && h >= 0) {
    const err = placementError(UI.placing, h);
    g.fillStyle = err ? 'rgba(229,83,75,.4)' : 'rgba(87,194,107,.4)'; g.beginPath(); WG.hexPath(g, h, 0.95); g.fill();
    g.strokeStyle = err ? '#e5534b' : '#57c26b'; g.lineWidth = 2 / z; g.stroke();
  }
  const sel = S.buildings.find((b) => b.id === UI.selected);
  if (sel) { g.strokeStyle = `rgba(242,193,78,${0.6 + 0.4 * Math.sin(t * 5)})`; g.lineWidth = 3 / z; g.beginPath(); WG.hexPath(g, sel.hex, sel.type === 'hall' ? 1.9 : 0.95); g.stroke(); }
  // buildings (yours + AI cities), depth-sorted; tiny dots when zoomed far out
  const list = S.buildings.filter((b) => visSet.has(b.hex) || (b.type === 'hall' && vis.length));
  for (const k of S.kingdoms) if (isSeen(k.capital)) for (const b of aiCity(k).buildings) if (visSet.has(b.hex)) list.push(b);
  list.sort((a, b) => WG.cy[a.hex] - WG.cy[b.hex]);
  for (const b of list) {
    if (!detail && b.type !== 'hall') { g.fillStyle = b.color ? b.color : CAT_DOT[BUILDINGS[b.type].cat]; g.fillRect(WG.cx[b.hex] - 2.5, WG.cy[b.hex] - 2.5, 5, 5); continue; }
    drawOnHex(g, b, t);
  }
  if (UI.placing && h >= 0 && !placementError(UI.placing, h)) { g.globalAlpha = 0.65; drawOnHex(g, { id: 0, type: UI.placing, hex: h, level: 1, build: 0 }, t, true); g.globalAlpha = 1; }
  // production popups
  for (const b of S.buildings) {
    const prod = productionOf(b);
    if (!prod || b.build > 0 || S.res[prod[0]] >= capOf(prod[0]) || !visSet.has(b.hex)) continue;
    popTimers[b.id] = (popTimers[b.id] ?? hash2(b.id, 1) * 6) - dt;
    if (popTimers[b.id] <= 0) {
      popTimers[b.id] = 6;
      const amt = prod[1] * 6 * prodMult(prod[0]);
      if (z > 2.5) floatText(WG.cx[b.hex], WG.cy[b.hex] - 7, `+${amt >= 10 ? fmt(amt) : amt.toFixed(1)} ${RES_META[prod[0]].icon}`, RES_META[prod[0]].color);
    }
  }
  if (detail) drawVillagers(g, t, dt);
  drawFx(g, dt);
}

function drawVillagers(g, t, dt) {
  const cap = S.world.capital;
  if (villagers.length < 12) villagers.push({ x: WG.cx[cap], y: WG.cy[cap] + 8, tx: WG.cx[cap], ty: WG.cy[cap], c: pick(['#c0392b', '#2980b9', '#8e44ad', '#16a085', '#d35400']), wait: Math.random() * 3 });
  const u = ART;
  for (const v of villagers) {
    const d = dist(v.x, v.y, v.tx, v.ty);
    if (d < 0.3) {
      v.wait -= dt;
      if (v.wait <= 0) { const land = WG.within(cap, landRadius()).filter(inLand); const i = pick(land.length ? land : [cap]); v.tx = WG.cx[i] + rand(-3, 3); v.ty = WG.cy[i] + rand(-3, 3); v.wait = rand(1, 4); }
    } else { const sp = Math.min(d, dt * 8); v.x += ((v.tx - v.x) / d) * sp; v.y += ((v.ty - v.y) / d) * sp; }
    const bob = d > 0.3 ? Math.abs(Math.sin(t * 9 + v.c.length)) * 1.5 * u : 0;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(v.x, v.y + u, 3 * u, 1.2 * u, 0, 0, 7); g.fill();
    g.fillStyle = v.c; g.fillRect(v.x - 2 * u, v.y - 6 * u - bob, 4 * u, 5.5 * u);
    g.fillStyle = '#f1c9a5'; g.beginPath(); g.arc(v.x, v.y - 7.5 * u - bob, 1.8 * u, 0, 7); g.fill();
  }
}
