/**
 * Ironcrown end-to-end tests (Playwright, headless Chromium).
 *
 *   npm test                                         # starts server/server.py and tests locally
 *   BASE_URL=https://<you>.github.io/ironcrown/ npm test   # test the live deployment
 *
 * Tests drive the real UI — clicks on buttons, on hexes of the canvas, drags
 * and key presses — and use window.ironcrown hooks only to fast-forward time,
 * grant resources or locate hexes. Screenshots land in tests/screenshots/.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shots = path.join(here, 'screenshots');
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });

const PORT = 8123;
let BASE = process.env.BASE_URL;
let server = null;
const dataDir = path.join(here, '.test-data');
async function startServer() {
  rmSync(dataDir, { recursive: true, force: true });
  server = spawn('python3', [path.join(root, 'server/server.py'), '--port', String(PORT), '--data', dataDir], { stdio: ['ignore', 'ignore', 'inherit'] });
  BASE = `http://127.0.0.1:${PORT}/`;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + 'api/health'); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

// ------------------------------------------------------------ mini runner
const results = [];
let page;
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name} (${Date.now() - t0}ms)`); }
  catch (e) {
    results.push({ name, ok: false, err: e });
    console.log(`  ✘ ${name}\n      ${String(e.message).split('\n').slice(0, 6).join('\n      ')}`);
    await page.screenshot({ path: path.join(shots, `FAIL-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const G = (fn, arg) => page.evaluate(fn, arg);
const state = () => G(() => window.ironcrown.state);
const ff = (s) => G((s) => window.ironcrown.debug.fastForward(s), s);
const shot = (name) => page.screenshot({ path: path.join(shots, name + '.png') });
async function canvasRichness(selector) {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel), g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data, colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) colors.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
    return colors.size;
  }, selector);
}
async function clickHex(view, i, opts = {}) {
  await G(([v, i]) => window.ironcrown.debug.focus(v, i), [view, i]);
  await page.waitForTimeout(60);
  const p = await G(([v, i]) => window.ironcrown.debug.hexToClient(v, i), [view, i]);
  await page.mouse.click(p.x, p.y, opts);
}
async function closeModalIfOpen() { if (await page.isVisible('#modal')) await page.keyboard.press('Escape'); }

// ------------------------------------------------------------ run
if (!BASE) await startServer();
const local = !process.env.BASE_URL;
console.log(`\nIroncrown e2e — ${BASE}\n`);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/api\/(health|save)|favicon|404/.test(m.text())) errors.push('console: ' + m.text()); });
const url = (extra = '') => `${BASE}?slot=e2e${extra}`;

await test('loads, shows the welcome screen, version label and starts', async () => {
  await page.goto(url('&reset=1'));
  await page.waitForSelector('body[data-ready="1"]', { timeout: 15000 });
  await page.waitForSelector('#welcome-name');
  const v = await G(() => window.ironcrown.version);
  assert((await page.textContent('#version')) === 'v' + v, 'version label shown on the map');
  await page.fill('#welcome-name', 'Testoria');
  await shot('01-welcome');
  await page.click('#begin-btn');
  assert(await page.isHidden('#modal'), 'welcome closes');
  assert((await page.textContent('#kingdom-name')) === 'Testoria', 'name in HUD');
});

await test('one map of small hexes: buildings sit on map hexes around the capital', async () => {
  await page.waitForTimeout(500);
  assert((await canvasRichness('#stage')) > 70, 'detailed canvas');
  const s = await state();
  const hall = s.buildings.find((b) => b.type === 'hall');
  assert(hall && hall.hex === s.world.capital, 'the Main Hall stands on the capital map hex');
  assert(s.buildings.every((b) => s.world.owner[b.hex] === -2), 'every building is on land you own');
  assert(await page.$('[data-view]') === null, 'no separate world-map button');
  await shot('02-kingdom');
  await page.keyboard.press('m');
  await page.waitForTimeout(400);
  assert((await G(() => window.ironcrown.CAM.z)) < 1, 'zoomed out over the world');
  await shot('02b-world-same-map');
  await page.keyboard.press('k');
  assert((await G(() => window.ironcrown.CAM.z)) > 4, 'K flies back to the capital');
});

await test('resources accumulate in real time', async () => {
  const before = (await state()).res.gold;
  await page.waitForTimeout(1500);
  assert((await state()).res.gold > before, 'gold grows');
});

await test('camera: drag pans, wheel zooms, buttons recenter', async () => {
  const c0 = await G(() => ({ ...window.ironcrown.CAM }));
  await page.mouse.move(500, 500); await page.mouse.down(); await page.mouse.move(360, 420, { steps: 8 }); await page.mouse.up();
  const c1 = await G(() => ({ ...window.ironcrown.CAM }));
  assert(Math.abs(c1.x - c0.x) * c1.z > 100 && Math.abs(c1.y - c0.y) * c1.z > 50, `drag moved the camera (${c0.x.toFixed(0)},${c0.y.toFixed(0)} → ${c1.x.toFixed(0)},${c1.y.toFixed(0)})`);
  await page.mouse.move(500, 500); await page.mouse.wheel(0, -400); await page.waitForTimeout(100);
  assert((await G(() => window.ironcrown.CAM.z)) > c1.z, 'wheel zooms in');
  await page.click('[data-action="zoom-home"]');
});

await test('settings: keyboard camera mode disables drag and enables WASD', async () => {
  await page.click('.hud-stats [data-action="settings"]');
  await page.selectOption('[data-setting="panMode"]', 'keys');
  await page.keyboard.press('Escape');
  const x0 = await G(() => window.ironcrown.CAM.x);
  await page.mouse.move(500, 500); await page.mouse.down(); await page.mouse.move(300, 500, { steps: 6 }); await page.mouse.up();
  assert(Math.abs((await G(() => window.ironcrown.CAM.x)) - x0) < 1, 'drag no longer pans in keyboard mode');
  await page.keyboard.down('d'); await page.waitForTimeout(350); await page.keyboard.up('d');
  assert(Math.abs((await G(() => window.ironcrown.CAM.x)) - x0) > 20, 'D key pans');
  await page.click('.hud-stats [data-action="settings"]');
  await page.selectOption('[data-setting="panMode"]', 'drag');
  await shot('03-settings');
  await page.keyboard.press('Escape');
  assert((await G(() => window.ironcrown.SETTINGS.panMode)) === 'drag', 'restored');
});

await test('help menu explains every feature', async () => {
  await page.keyboard.press('h');
  await page.waitForSelector('.help nav');
  const sections = await page.$$eval('.help nav button', (b) => b.map((x) => x.textContent));
  assert(sections.length >= 12, `many help sections (${sections.length})`);
  await page.click('.help nav button[data-arg="navy"]');
  assert((await page.textContent('.help article')).includes('Shipyard'), 'navy section explains shipyards');
  await shot('04-help');
  await page.keyboard.press('Escape');
});

await test('build a Farm by clicking the build menu and a hex', async () => {
  await G(() => window.ironcrown.debug.give({ gold: 20000, lumber: 20000, iron: 8000, food: 8000, diamonds: 300 }));
  const n = (await state()).buildings.length;
  await page.keyboard.press('Escape');
  await page.click('[data-tab="info"]');
  await page.click('.build-item[data-type="farm"]');
  const hex = await G(() => window.ironcrown.debug.freeHex('farm'));
  await clickHex('kingdom', hex);
  const s = await state();
  assert(s.buildings.length === n + 1 && s.buildings.find((b) => b.hex === hex && b.type === 'farm'), 'farm placed on that hex');
  await ff(10);
  assert((await state()).buildings.find((b) => b.hex === hex).level === 1, 'farm finished');
});

await test('clear trees/rocks from a hex', async () => {
  const hex = await G(() => {
    const s = window.ironcrown.state, W = window.ironcrown.debug.WG;
    return playerLand().filter((i) => inLand(i) && obstacleAt(i) && !buildingAt(i)).sort((a, b) => W.dist(a, s.world.capital) - W.dist(b, s.world.capital))[0];
  });
  assert(hex !== undefined, 'an obstacle exists on the land');
  await clickHex('kingdom', hex);
  await page.click('[data-action="clear-obstacle"]');
  assert((await state()).cleared.includes(hex), 'hex cleared');
});

await test('the Main Hall upgrades without limit and claims more land', async () => {
  const s = await state();
  const hall = s.buildings.find((b) => b.type === 'hall');
  const land0 = await G(() => playerTiles());
  await clickHex('kingdom', hall.hex);
  await page.click('[data-action="upgrade"]');
  await ff(80);
  assert((await G(() => window.ironcrown.debug.hallLevel())) === 2, 'hall level 2');
  assert((await G(() => playerTiles())) > land0, 'the new level claimed a ring of land');
  const beyond = await G(() => { cheats.hall(7); const b = window.ironcrown.state.buildings.find((x) => x.type === 'hall'); return upgradeError(b); });
  assert(!beyond || beyond === 'Not enough resources' || beyond.includes('builders'), `level 7 can still be upgraded (${beyond})`);
});

await test('research at a University', async () => {
  await page.keyboard.press('Escape');
  await page.click('[data-tab="info"]');
  await page.click('.build-item[data-type="university"]');
  await clickHex('kingdom', await G(() => window.ironcrown.debug.freeHex('university')));
  await ff(30);
  await page.click('[data-tab="research"]');
  await page.click('[data-action="research"][data-arg="tools"]');
  assert((await state()).buildings.find((b) => b.type === 'university').research?.id === 'tools', 'research started');
  await shot('05-research');
  await ff(60);
  assert((await state()).research.tools === 1, 'Improved Tools researched');
});

await test('train troops and muster a division with a general', async () => {
  for (const t of ['archery', 'barracks', 'stable']) {
    await page.click('[data-tab="info"]');
    await page.click(`.build-item[data-type="${t}"]`);
    await clickHex('kingdom', await G((t) => window.ironcrown.debug.freeHex(t), t));
  }
  await ff(40);
  await page.click('[data-tab="army"]');
  await page.click('[data-action="train"][data-arg="archer:5"]');
  await page.click('[data-action="train"][data-arg="pikeman:5"]');
  await ff(60);
  const s = await state();
  assert(s.army.pikeman >= 5 && s.army.archer >= 9, 'troops trained');
  await page.click('[data-action="muster"]');
  await page.fill('#div-name', 'Test Legion');
  await page.click('#muster-yes');
  const s2 = await state();
  const d = s2.divisions.find((x) => x.name === 'Test Legion');
  assert(d && d.units.pikeman >= 5, 'division created with troops from the garrison');
  assert(d.general && s2.divisions.every((x, i, a) => a.findIndex((y) => y.general === x.general) === i), 'each division has its own general');
});

await test('generals: one per division, tavern hire, copies & promotion', async () => {
  const noGen = await G(() => { const n = window.ironcrown.state.divisions.length; window.ironcrown.api.createDivision('Leaderless', { archer: 1 }, null); return window.ironcrown.state.divisions.length === n; });
  assert(noGen, 'a division cannot be mustered without a general');
  await page.click('[data-tab="shop"]');
  const g0 = (await state()).generals.length;
  await page.click('.card [data-action="hire"]');
  assert((await state()).generals.length === g0 + 1, 'hired a general at the tavern');
  await G(() => { cheats.generals(2); });
  await page.click('[data-tab="generals"]');
  const promo = await page.$('[data-action="promote"]');
  assert(promo, 'promote button offered for duplicate copies');
  const n0 = (await state()).generals.length;
  await promo.click();
  const s = await state();
  assert(s.generals.length === n0 - 1 && s.generals.some((g) => g.stars > 5 - 1 || g.stars >= 2), 'spare copy merged into a promoted general');
  await shot('06-generals');
});

await test('no army cap; edit, split and merge divisions', async () => {
  await G(() => window.ironcrown.debug.give({ gold: 90000, food: 90000, iron: 90000 }));
  await page.click('[data-tab="army"]');
  await G(() => cheats.army(400));                          // far beyond what the old housing cap allowed
  const q0 = await G(() => window.ironcrown.state.buildings.find((b) => b.type === 'barracks').queue.length);
  await page.click('[data-action="train"][data-arg="swordsman:5"]');
  const q1 = await G(() => window.ironcrown.state.buildings.find((b) => b.type === 'barracks').queue.length);
  assert(q1 === q0 + 5 && (await G(() => totalHousing() > armyCap())), 'training continues with no army cap');
  await ff(60);
  const s0 = await state();
  const d = s0.divisions.find((x) => x.name === 'Test Legion');
  await page.click(`[data-action="edit-troops"][data-arg="${d.id}"]`);
  await page.$eval('input[data-ed="swordsman"]', (e) => { e.value = 20; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#edit-yes');
  const s1 = await state();
  assert(s1.divisions.find((x) => x.id === d.id).units.swordsman === 20, 'division resized to 20 swordsmen');
  await G(() => cheats.generals(1));
  await page.click(`[data-action="split"][data-arg="${d.id}"]`);
  await page.click('#split-yes');
  const s2 = await state();
  const nd = s2.divisions.find((x) => x.name === 'Test Legion II');
  assert(nd && nd.general && nd.general !== s2.divisions.find((x) => x.id === d.id).general, 'split into a new division with its own general');
  const before = s2.divisions.length;
  await page.click(`[data-action="merge"][data-arg="${d.id}:${nd.id}"]`);
  assert((await state()).divisions.length === before - 1, 'merged back together');
});

await test('world map: hex terrain, fog, minimap, select a division and march', async () => {
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  assert((await canvasRichness('#stage')) > 40, 'world drawn');
  await page.click('[data-tab="army"]');
  assert(await page.isVisible('#minimap'), 'minimap visible');
  const s = await state();
  const d = s.divisions.find((x) => x.name === 'Test Legion');
  await page.click(`[data-action="select-entity"][data-arg="division:${d.id}"]`);
  const target = await G((cap) => { const W = window.ironcrown.debug.WG; return W.within(cap, 3).find((i) => W.dist(i, cap) >= 2 && isPassable(i) && isSeen(i) && (findPath(W, cap, i, aiLandCost) || []).length <= 4); }, s.world.capital);
  assert(target !== undefined, 'a reachable hex nearby');
  await clickHex('world', target);
  await page.waitForSelector('[data-action="order"][data-arg="move"]');
  await page.click('[data-action="order"][data-arg="move"]');
  assert((await state()).divisions.find((x) => x.id === d.id).path.length > 0, 'division has a route');
  await page.waitForTimeout(300);
  await shot('07-world-march');
  await ff(80);
  assert((await state()).divisions.find((x) => x.id === d.id).at === target, 'division arrived');
});

await test('scouts: dispatch a party, click a point, everything on the way is revealed', async () => {
  const s = await state();
  const kid = await G(() => { const s = window.ironcrown.state; return s.kingdoms.find((k) => findPath(WG, s.world.capital, k.capital, scoutCost))?.id ?? 0; });
  const k = s.kingdoms[kid];
  const seen0 = s.world.seen.filter(Boolean).length;
  await page.keyboard.press('Escape');
  await page.click('[data-tab="army"]');
  await page.click('[data-action="dispatch-scouts"]');
  const party = (await state()).scouts[0];
  assert(party, 'scout party on the map');
  await clickHex('world', k.capital);                       // left-click moves the selected scouts
  const moving = (await state()).scouts[0];
  assert(moving.path.length > 0, 'scouts walking to the clicked point');
  const route = moving.path.slice();
  await shot('07b-scouts');
  let walked = 0;
  for (let k = 0; k < 10; k++) {
    await ff(40);
    const p = (await state()).scouts.find((x) => x.id === moving.id);
    if (!p) break;                                   // arrived home / captured
    walked = route.length - p.path.length;
    if (!p.path.length) break;
  }
  const s2 = await state();
  const passed = route.slice(0, Math.max(walked, 1));
  assert(passed.every((i) => s2.world.seen[i]), `every hex the scouts passed was revealed (${passed.length} hexes)`);
  assert(s2.world.seen.filter(Boolean).length > seen0, 'fog lifted');
  if (walked >= route.length - 1) assert(s2.intel[k.id], 'intel gathered on arrival');
});

await test('claim land anywhere and build on it', async () => {
  await G(() => window.ironcrown.debug.give({ gold: 30000, lumber: 30000, iron: 10000, food: 10000 }));
  await G(() => cheats.reveal());
  const hex = await G(() => { const s = window.ironcrown.state, W = window.ironcrown.debug.WG; return s.world.owner.map((o, i) => i).filter((i) => s.world.owner[i] === -1 && [1, 2, 7].includes(s.world.terrain[i]) && !s.world.feat[i] && distToTerritory(i) >= 2).sort((a, b) => W.dist(a, s.world.capital) - W.dist(b, s.world.capital))[0]; });
  assert(hex !== undefined, 'a distant neutral farmable hex');
  await page.keyboard.press('Escape');
  await clickHex('world', hex);
  await page.click('[data-action="claim"]');
  assert((await state()).world.owner[hex] === -2, 'claimed a hex far from the borders');
  const spot = await G((h) => [h].concat(window.ironcrown.debug.WG.neighbors(h)).find((i) => inLand(i) && !placementError('village', i)), hex);
  assert(spot !== undefined, 'a buildable hex in the claimed land');
  await G(() => { cheats.build(); });
  await clickHex('world', spot);
  await page.click('[data-action="build-at"][data-tb="village"]');
  const vb = (await state()).buildings.find((b) => b.hex === spot);
  assert(vb && vb.type === 'village', 'village under construction on far-away land');
  await ff(30);
  assert((await state()).buildings.find((b) => b.hex === spot).level === 1, 'village built');
  await shot('07c-territory');
});

await test('port trains seamen, shipyard builds crewed ships, form a fleet and sail', async () => {
  await page.keyboard.press('k');
  await page.click('[data-tab="info"]');
  await page.keyboard.press('Escape');
  await page.click('.build-item[data-type="port"]');
  await clickHex('kingdom', await G(() => window.ironcrown.debug.freeHex('port')));
  await ff(30);
  await page.click('[data-tab="navy"]');
  assert(await page.isDisabled('[data-action="build-ship"][data-arg="sloop:1"]'), 'ships need a crew first');
  for (let k = 0; k < 3; k++) { await page.click('[data-action="train"][data-arg="seaman:5"]'); await ff(20); }
  assert((await state()).army.seaman >= 14, 'seamen trained at the port');
  await page.click('[data-tab="info"]');
  await page.click('.build-item[data-type="shipyard"]');
  const hex = await G(() => window.ironcrown.debug.freeHex('shipyard'));
  assert(hex >= 0, 'a free coastal hex exists');
  await clickHex('kingdom', hex);
  await ff(40);
  await page.click('[data-tab="navy"]');
  const sea0 = (await state()).army.seaman;
  await page.click('[data-action="build-ship"][data-arg="sloop:1"]');
  await page.click('[data-action="build-ship"][data-arg="cog:1"]');
  await ff(40);
  const hs = await state();
  assert(hs.harbor.cog === 1 && hs.army.seaman === sea0 - 14, 'ships launched into harbour with their crews aboard (6 + 8 seamen)');
  await page.click('[data-action="form-fleet"]');
  await page.click('#fleet-yes');
  const f = (await state()).fleets[0];
  assert(f && f.ships.sloop === 1, 'fleet formed');
  await shot('08-navy');
  const water = await G((h) => { const W = window.ironcrown.debug.WG; return W.within(h, 4).filter((i) => isWater(i) && OCEAN[i]).sort((a, b) => W.dist(b, h) - W.dist(a, h))[0]; }, f.at);
  await G(([id, w]) => { const f = window.ironcrown.state.fleets.find((x) => x.id === id); window.ironcrown.api.giveOrder(f, 'move', w); }, [f.id, water]);
  await ff(40);
  assert((await state()).fleets[0].at === water, 'fleet sailed');
});

await test('fleet salvages a shipwreck', async () => {
  await G(() => cheats.reveal());
  const f = (await state()).fleets[0];
  const wreck = await G((at) => {
    const s = window.ironcrown.state, W = window.ironcrown.debug.WG;
    return Object.keys(s.world.feat).map(Number).filter((i) => s.world.feat[i].type === 'wreck' && !s.world.feat[i].salvaged)
      .sort((a, b) => W.dist(a, at) - W.dist(b, at)).find((i) => findPath(W, at, i, fleetCost));
  }, f.at);
  const ok = await G(([id, w]) => { const f = window.ironcrown.state.fleets.find((x) => x.id === id); return window.ironcrown.api.giveOrder(f, 'salvage', w); }, [f.id, wreck]);
  assert(ok, 'route to wreck');
  await ff(400);
  assert((await state()).world.feat[wreck].salvaged, 'wreck salvaged');
});

await test('division explores ruins (battle auto-resolved)', async () => {
  await G(() => { window.ironcrown.SETTINGS.battleMode = 'auto'; cheats.army(60); });
  const s = await state();
  await G(() => cheats.hall(6));
  const ruin = await G(() => { const s = window.ironcrown.state, W = window.ironcrown.debug.WG; return Object.keys(s.world.feat).map(Number).filter((i) => s.world.feat[i].type === 'ruins' && findPath(W, s.world.capital, i, aiLandCost)).sort((a, b) => W.dist(a, s.world.capital) - W.dist(b, s.world.capital))[0]; });
  assert(ruin !== undefined, 'a reachable ruin');
  await G(() => window.ironcrown.api.createDivision('Raiders', { swordsman: 40, archer: 40, horseman: 30 }, idleGenerals()[0].uid));
  const d = (await state()).divisions.find((x) => x.name === 'Raiders');
  const ok = await G(([id, r]) => { const d = window.ironcrown.state.divisions.find((x) => x.id === id); return window.ironcrown.api.giveOrder(d, 'explore', r); }, [d.id, ruin]);
  assert(ok, 'route to ruins');
  await ff(600);
  const s2 = await state();
  assert(s2.world.feat[ruin].looted || s2.stats.ruinsExplored > 0 || !s2.divisions.find((x) => x.id === d.id), 'ruins fought over');
});

await test('battle is fought on the map with formations and stances', async () => {
  await G(() => { window.ironcrown.SETTINGS.battleMode = 'watch'; cheats.army(80); });
  const kid = await G(() => { const s = window.ironcrown.state, W = window.ironcrown.debug.WG; return s.kingdoms.slice().sort((a, b) => W.dist(a.capital, s.world.capital) - W.dist(b.capital, s.world.capital)).find((k) => findPath(W, s.world.capital, k.capital, aiLandCost))?.id; });
  assert(kid !== undefined, 'a reachable kingdom');
  await G(() => window.ironcrown.api.createDivision('Siege Host', { swordsman: 60, archer: 60, horseman: 50, pikeman: 30 }, idleGenerals()[0].uid));
  const d = (await state()).divisions.find((x) => x.name === 'Siege Host');
  assert(d, 'division mustered');
  await G(([id, kid]) => { const s = window.ironcrown.state; const d = s.divisions.find((x) => x.id === id); window.ironcrown.api.giveOrder(d, 'attack', s.kingdoms[kid].capital); }, [d.id, kid]);
  for (let i = 0; i < 400 && !(await G(() => window.ironcrown.Battles.list.length)); i++) await G(() => { for (let k = 0; k < 5; k++) step(1); });
  assert(await G(() => window.ironcrown.Battles.list.length) === 1, 'battle started on the map');
  assert(await page.isHidden('#modal'), 'no separate battle screen');
  await page.waitForSelector('#battle-hud:not([hidden])');
  assert(await page.isVisible('#battle-hud'), 'command bar visible');
  await page.click('[data-action="b-form"][data-arg$=":wedge"]');
  await page.click('[data-action="b-stance"][data-arg$=":charge"]');
  const g = await G(() => { const b = window.ironcrown.Battles.list[0]; return { f: b.groups[0].formation, s: b.groups[0].stance }; });
  assert(g.f === 'wedge' && g.s === 'charge', 'formation & stance changed mid-battle');
  await page.waitForTimeout(1500);
  await shot('09-battle-on-map');
  const bid = await G(() => window.ironcrown.Battles.focus);
  await page.click('[data-action="b-resolve"]', { force: true });   // the HUD ticks every second
  const s = await state();
  assert(s.stats.battlesWon + s.stats.battlesLost >= 1, 'battle recorded');
  await page.waitForTimeout(3500);
  assert(await G((id) => !window.ironcrown.Battles.get(id), bid), 'battlefield cleared');
});

await test('coalition battles: nearby divisions fight together; 3-way battles', async () => {
  await G(() => { window.ironcrown.SETTINGS.battleMode = 'auto'; cheats.army(60); cheats.generals(2); });
  const res = await G(() => {
    const s = window.ironcrown.state, W = window.ironcrown.debug.WG;
    s.divisions = s.divisions.slice(0, 1);
    const k = s.kingdoms.find((k) => canReachCapital(k));
    const hex = W.neighbors(s.world.capital).find((i) => isPassable(i) && !W.neighbors(i).includes(k.capital));
    const a = createDivision('Left Wing', { swordsman: 20, archer: 20 }, idleGenerals()[0].uid);
    const b = createDivision('Right Wing', { pikeman: 20, horseman: 10 }, idleGenerals()[0].uid);
    // put both next to each other and bring an enemy army and a pirate-like third party (bandits) into the fight
    a.at = hex; b.at = W.neighbors(hex).find((i) => isPassable(i)) ?? hex;
    k.atWar = true; k.relation = -80;
    const army = { id: 'test-army', kid: k.id, kind: 'war', units: { swordsman: 25, archer: 15, pikeman: 0, horseman: 5, catapult: 0, scout: 0, seaman: 0 }, hall: 2, at: hex, path: [], prog: 0, target: hex, status: 'idle' };
    s.aiArmies.push(army);
    let seen = null;
    const orig = Battles.create.bind(Battles);
    Battles.create = (cfg) => { const bt = orig(cfg); seen = seen || { teams: bt.teams.map((t) => [t.id, t.groups.map((g) => g.name)]) }; return bt; };
    gatherBattle(hex, ['P', teamOfKingdom(k)], { kind: 'land', title: 'test', extra: [bandits(hex, 150, 1)] });
    Battles.create = orig;
    return seen;
  });
  assert(res, 'a battle was created');
  const P = res.teams.find((t) => t[0] === 'P');
  assert(P && P[1].includes('Left Wing') && P[1].includes('Right Wing'), `both divisions fought together (${JSON.stringify(res.teams)})`);
  assert(res.teams.length >= 3 && res.teams.some((t) => t[0] === 'B'), '3-way battle with a third party');
});

await test('AI kingdoms field guard armies and navy patrols', async () => {
  await ff(200);
  const s = await state();
  assert(s.aiArmies.some((a) => a.kind === 'guard'), 'guard armies on AI land');
  const coastal = s.kingdoms.filter((k) => k.coastal).length;
  assert(!coastal || s.aiFleets.some((f) => f.patrol), 'coastal kingdoms keep navy patrols');
});

await test('build anywhere: unclaimed land, no count limits', async () => {
  await G(() => { cheats.res(200000); cheats.build(); });
  const r = await G(() => {
    const s = window.ironcrown.state, cap = s.world.capital;
    const spot = WG.within(cap, 25).find((i) => s.world.owner[i] === -1 && isSeen(i) && buildableTerrain(i) && !obstacleAt(i) && !buildingAt(i));
    if (spot == null) return { skip: true };
    const b = placeBuilding('farm', spot); cheats.build();
    let farms = 0;
    for (let n = 0; n < 12; n++) { const i = window.ironcrown.debug.freeHex('farm'); if (i >= 0 && placeBuilding('farm', i)) { farms++; cheats.build(); } }
    return { ok: !!b, owned: s.world.owner[spot] === -2, farms, total: countOf('farm'), oldLimit: BUILDINGS.farm.limit[5] };
  });
  if (!r.skip) assert(r.ok && r.owned, 'built on unclaimed land and settled it');
  assert(r.total > r.oldLimit, `more farms than the old limit (${r.total} > ${r.oldLimit})`);
});

await test('towers open fire on passing enemies; battles do not chain', async () => {
  await G(() => { window.ironcrown.SETTINGS.battleMode = 'auto'; });
  const r = await G(() => {
    const s = window.ironcrown.state, cap = s.world.capital;
    const k = s.kingdoms.find((x) => canReachCapital(x));
    const spot = window.ironcrown.debug.freeHex('tower');
    placeBuilding('tower', spot); cheats.build();
    k.atWar = true; k.relation = -90;
    const passBy = WG.within(spot, 2).find((i) => isPassable(i) && WG.dist(i, spot) === 2);
    const far = WG.within(spot, 12).find((i) => isPassable(i) && WG.dist(i, spot) === 10);
    s.divisions.forEach((d) => { d.at = s.world.capital; d.path = []; });
    const army = { id: 'passer', kid: k.id, kind: 'war', units: { swordsman: 15, archer: 5, pikeman: 0, horseman: 0, catapult: 0, scout: 0, seaman: 0 }, hall: 1, at: passBy, path: [far], prog: 0, target: far, status: 'moving' };
    s.aiArmies.push(army);
    let n = 0; const orig = Battles.create.bind(Battles); Battles.create = (c) => { n++; return orig(c); };
    for (let t = 0; t < 10; t++) step(1, true);
    const after10 = n;
    Battles.create = orig;
    return { fought: after10 >= 1, chained: after10 > 3, towers: playerTowers(passBy).length, kinds: playerTowers(passBy).map((x) => x.type) };
  });
  assert(r.towers > 0 && r.fought, `defenses engaged the passing army (towers ${r.towers})`);
  assert(r.kinds.every((k) => k === 'tower'), `the real building fights as itself, got ${r.kinds.join()}`);
  assert(!r.chained, 'no endless chain of battles');
});

await test('empire expands into unexplored land: settle a whole region at once', async () => {
  await G(() => window.ironcrown.debug.give({ gold: 600000, food: 600000 }));
  const r = await G(() => {
    const s = window.ironcrown.state, W = window.ironcrown.debug.WG;
    const hall = s.buildings.find((b) => b.type === 'hall');
    hall.level = Math.max(hall.level, 8);                     // a big hall settles a radius-5 region
    const land = (i) => s.world.owner[i] === -1 && isPassable(i) && !s.world.feat[i];
    const before = playerTiles();
    // 1. push the border outwards with one big claim on the edge of what you have seen
    const edge = W.within(s.world.capital, 30).filter((i) => land(i) && isSeen(i)).sort((a, b) => distToTerritory(b) - distToTerritory(a))[0];
    const big = Math.min(4, settleRadius()), planned = claimCluster(edge, big).length;
    const firstOk = claimTile(edge, big);
    const gained = playerTiles() - before;
    // 2. from that new border, settle land nobody has ever walked
    //    (an earlier test lifted the fog, so put it back around the new frontier)
    for (const i of W.within(edge, 10)) if (s.world.owner[i] === -1) s.world.seen[i] = 0;
    const dark = W.within(edge, 10).filter((i) => land(i) && !isSeen(i) && distToTerritory(i) >= 1 && distToTerritory(i) <= settleReach())[0];
    if (dark == null) return { firstOk, planned, gained, dark: null };
    const darkOk = claimTile(dark, 2);
    return { firstOk, planned, gained, dark: true, darkOk, owned: s.world.owner[dark] === -2, nowSeen: isSeen(dark), reach: settleReach(), radius: settleRadius() };
  });
  assert(r.firstOk && r.planned > 7 && r.gained >= r.planned - 1, `one claim settles a whole region (${r.gained} hexes, planned ${r.planned})`);
  assert(r.dark, 'unexplored land sits just past the new border');
  assert(r.darkOk && r.owned, 'settlers pushed into land that was never scouted');
  assert(r.nowSeen, 'settlers reveal what they settle');
  await shot('07d-expansion');
});

await test('armies auto-engage any enemy inside their detection radius', async () => {
  await G(() => { window.ironcrown.SETTINGS.battleMode = 'auto'; cheats.army(80); });
  const r = await G(() => {
    const s = window.ironcrown.state, W = window.ironcrown.debug.WG;
    s.divisions.forEach((d) => { d.at = s.world.capital; d.path = []; d.cooldown = 0; });
    const k = s.kingdoms.find((x) => canReachCapital(x));
    k.atWar = true; k.relation = -90;
    const d = s.divisions[0];
    const spot = W.within(s.world.capital, 9).find((i) => isPassable(i) && W.dist(i, s.world.capital) === 8);
    d.at = spot; d.path = []; d.status = 'idle'; d.cooldown = 0;
    // park a hostile army exactly DETECT_R hexes away, standing still, with nothing else nearby
    const away = W.within(spot, DETECT_R).find((i) => isPassable(i) && W.dist(i, spot) === DETECT_R);
    if (away == null) return { skip: true };
    s.aiArmies = [{ id: 'sniffer', kid: k.id, kind: 'war', units: { swordsman: 12, archer: 4, pikeman: 0, horseman: 0, catapult: 0, scout: 0, seaman: 0 }, hall: 1, at: away, path: [], prog: 0, target: away, status: 'idle', cooldown: 0 }];
    let fought = false;
    const orig = Battles.create.bind(Battles);
    Battles.create = (c) => { fought = true; return orig(c); };
    checkEncounters(true);
    Battles.create = orig;
    return { skip: false, fought, gap: W.dist(spot, away), radius: DETECT_R };
  });
  if (r.skip) return;
  assert(r.gap === r.radius, 'the enemy stood at the edge of the ring');
  assert(r.fought, `the division attacked an enemy ${r.gap} hexes away on its own`);
  await G(() => { const s = window.ironcrown.state; s.aiArmies = []; s.kingdoms.forEach((k) => { k.atWar = false; k.relation = Math.max(k.relation, 0); }); });
});

await test('you never have to command an allied kingdom\'s battle', async () => {
  const r = await G(() => {
    const s = window.ironcrown.state, W = window.ironcrown.debug.WG;
    s.divisions.forEach((d) => { d.at = s.world.capital; d.path = []; d.status = 'idle'; d.cooldown = 0; });
    const friend = s.kingdoms[0], foe = s.kingdoms.find((k) => k !== friend);
    window.__restore = { id: friend.id, allianceId: friend.allianceId, relation: foe.relation };
    // join a fresh alliance with `friend`, then stage a fight far from anything of yours
    s.allianceId = null;
    createAlliance('Test Concord', '#57c26b', '🤝');
    const a = S.alliances.find((x) => x.id === s.allianceId);
    a.leader = 'P'; a.members.push(friend.id); friend.allianceId = a.id;
    foe.atWar = false; foe.relation = -90;
    friend.wars = { [foe.id]: s.time + 999 }; foe.wars = { [friend.id]: s.time + 999 };
    const hex = W.within(friend.capital, 2).find((i) => isPassable(i) && W.dist(i, s.world.capital) > 8) ?? friend.capital;
    const army = { id: 'ally-war', kid: foe.id, kind: 'war', units: { swordsman: 20, archer: 10, pikeman: 0, horseman: 0, catapult: 0, scout: 0, seaman: 0 }, hall: 2, at: hex, path: [], prog: 0, target: hex, status: 'idle', cooldown: 0 };
    s.aiArmies = [army];
    const live = Battles.list.length;
    const bt = gatherBattle(hex, ['P', teamOfKingdom(foe)], { kind: 'land', title: 'allied war' });
    const P = bt && bt.teams.find((t) => t.player);
    return { made: !!bt, watched: Battles.list.length > live, ally: P ? P.groups.every((g) => g.ally) : null, mineToCommand: P ? P.groups.filter((g) => !g.ally).length : -1 };
  });
  assert(r.made, 'the allied kingdom still fought its war');
  assert(r.ally === true, 'every friendly group there belonged to the ally');
  assert(!r.watched, 'no battle was handed to you to command');
  assert(r.mineToCommand === 0, 'you had nothing of your own on that field');
  await G(() => {   // put the world back the way the later tests expect to find it
    const s = window.ironcrown.state, was = window.__restore;
    leaveAlliance();
    s.alliances = s.alliances.filter((a) => a.name !== 'Test Concord');
    s.kingdoms.forEach((k) => { k.wars = {}; k.atWar = false; });
    const friend = s.kingdoms[was.id], home = s.alliances.find((a) => a.id === was.allianceId);
    friend.allianceId = was.allianceId;
    if (home && !home.members.includes(friend.id)) home.members.push(friend.id);
    s.kingdoms.forEach((k) => { if (k.allianceId && !s.alliances.some((a) => a.id === k.allianceId)) k.allianceId = null; });
    s.aiArmies = [];
  });
});

await test('battles use the real towers standing on the map, and towers duel towers', async () => {
  await G(() => { cheats.res(400000); cheats.build(); });
  const r = await G(() => {
    const s = window.ironcrown.state, W = window.ironcrown.debug.WG;
    const hall = s.buildings.find((b) => b.type === 'hall'); hall.level = Math.max(hall.level, 5);
    const spot = window.ironcrown.debug.freeHex('cannon');
    placeBuilding('cannon', spot); cheats.build();
    const t2 = window.ironcrown.debug.freeHex('tower');
    placeBuilding('tower', t2); cheats.build();
    const defs = playerTowers(spot);
    // an enemy with towers of its own, so the two sets of stonework can shoot at each other
    const foe = { id: 'K:99', name: 'Testers', color: '#e5534b', groups: [], towers: [{ type: 'tower', level: 3, hex: W.neighbors(spot)[0] }] };
    const bt = Battles.create({ kind: 'land', hex: spot, title: 'tower duel',
      teams: [{ id: 'P', name: 'You', color: '#f2c14e', player: true, groups: [], towers: defs }, foe],
      hostile: (a, b) => a !== b });
    const mine = bt.towers.filter((x) => x.team === 0);
    const before = bt.towers.filter((x) => x.team === 1).reduce((a, x) => a + x.hp, 0);
    for (let i = 0; i < 400; i++) Battles.tick(bt, 1 / 30);
    const after = bt.towers.filter((x) => x.team === 1).reduce((a, x) => a + x.hp, 0);
    return { types: defs.map((d) => d.type).sort(), onRealHexes: mine.every((x) => x.real && x.hex != null),
      placed: mine.map((x) => x.hex).sort().join() === defs.map((d) => d.hex).sort().join(),
      hasCannon: mine.some((x) => x.type === 'cannon'), hasArcher: mine.some((x) => x.type === 'tower'),
      damagedEnemyTowers: after < before };
  });
  assert(r.types.includes('cannon') && r.types.includes('tower'), `both buildings joined as themselves (${r.types.join()})`);
  assert(r.hasCannon && r.hasArcher, 'a cannon fights as a cannon and an archer tower as an archer tower');
  assert(r.onRealHexes && r.placed, 'towers stand on their own hexes, not on a made-up back line');
  assert(r.damagedEnemyTowers, 'towers opened fire on the enemy towers');
});

await test('the world is ten times bigger and full of kingdoms', async () => {
  const r = await G(() => {
    const s = window.ironcrown.state, W = window.ironcrown.debug.WG;
    const caps = s.kingdoms.map((k) => k.capital);
    let far = 0;
    for (const a of caps) for (const b of caps) far = Math.max(far, W.dist(a, b));
    return { N: W.N, W: W.W, H: W.H, kingdoms: s.kingdoms.length, alliances: s.alliances.length,
      spread: far, land: s.world.terrain.reduce((a, t) => a + (t !== 0 ? 1 : 0), 0),
      feats: Object.keys(s.world.feat).length, packed: serialize(s).length, plain: JSON.stringify(s).length };
  });
  assert(r.N >= 150000, `about ten times the old 16,500 hexes (${r.N})`);
  assert(r.W > 400 && r.H > 300, `grid grew in both directions (${r.W}x${r.H})`);
  assert(r.kingdoms >= 20, `a lot more kingdoms (${r.kingdoms})`);
  assert(r.alliances >= 3, `blocs formed among them (${r.alliances})`);
  assert(r.spread > 200, `capitals are spread across the whole world (${r.spread} hexes apart)`);
  assert(r.land > 60000 && r.feats > 300, `land and points of interest scaled with it (${r.land} land, ${r.feats} features)`);
  assert(r.packed < 600000 && r.packed < r.plain / 3, `the save stays small enough to store (${r.packed} vs ${r.plain} bytes)`);
});

await test('base defenses hit and endure more than ten times harder', async () => {
  const r = await G(() => {
    const s = window.ironcrown.state;
    const before = { tower: { hp: 300, atk: 20 }, cannon: { hp: 400, atk: 62 }, fortress: { hp: 750, atk: 26 }, spire: { hp: 600, atk: 80 } };
    const ratio = Math.min(...Object.keys(before).map((k) => Math.min(TOWER_STATS[k].hp / before[k].hp, TOWER_STATS[k].atk / before[k].atk)));
    // the same raiding party, thrown at the old stats and at the new ones
    const fight = () => {
      const hex = s.world.capital;
      const bt = Battles.create({ kind: 'land', hex, title: 'siege test',
        teams: [{ id: 'P', name: 'You', color: '#f2c14e', player: true, groups: [], towers: [{ type: 'tower', level: 1, hex }] },
                { id: 'K:99', name: 'Raiders', color: '#e5534b', groups: [{ key: 'r', name: 'Raiders', units: { swordsman: 12 }, stats: (u) => ({ atk: UNITS[u].atk, hp: UNITS[u].hp, speed: UNITS[u].speed, range: UNITS[u].range }) }] }],
        hostile: (a, b) => a !== b });
      for (let i = 0; i < 4000 && !bt.done; i++) Battles.tick(bt, 1 / 30);
      return { held: !bt.towers[0].dead, killed: bt.units.filter((u) => u.dead).length };
    };
    const now = fight();
    const keep = { ...TOWER_STATS.tower };
    TOWER_STATS.tower.hp = before.tower.hp; TOWER_STATS.tower.atk = before.tower.atk;
    const old = fight();
    Object.assign(TOWER_STATS.tower, keep);
    return { ratio, now, old, defRating: BUILDINGS.tower.def, siege: UNITS.catapult.vs.tower };
  });
  assert(r.ratio >= 10, `every fortification is at least ten times stronger (lowest ${r.ratio.toFixed(1)}x)`);
  assert(r.defRating >= 450, `the defense rating followed (${r.defRating})`);
  assert(!r.old.held, 'a dozen raiders used to overrun a lone archer tower');
  assert(r.now.held, 'now the tower holds the ground');
  assert(r.now.killed >= r.old.killed + 6, `and it cuts down ${r.now.killed} of them where it used to manage ${r.old.killed}`);
  assert(r.siege >= 8, 'catapults are still the answer to stone');
});

await test('a division on guard marches to defend land connected to its post', async () => {
  await G(() => { window.ironcrown.SETTINGS.battleMode = 'auto'; cheats.army(60); });
  const r = await G(() => {
    const s = window.ironcrown.state, W = window.ironcrown.debug.WG;
    s.aiArmies = []; s.divisions.forEach((d) => { d.guard = false; d.path = []; d.cooldown = 0; d.status = 'idle'; });
    const d = s.divisions[0];
    const mine = playerLand();
    const post = mine.find((i) => isPassable(i) && W.dist(i, s.world.capital) >= 2) ?? s.world.capital;
    d.at = post; d.path = []; d.order = null; d.status = 'idle';
    // a hex of the same connected realm, well outside the division's detection ring
    const comp = territoryComponents();
    const far = mine.filter((i) => comp[i] === comp[post] && W.dist(i, post) >= DETECT_R_IDLE + 3 && isPassable(i))
      .sort((a, b) => W.dist(a, post) - W.dist(b, post))[0];
    if (far == null) return { skip: true };
    const k = s.kingdoms.find((x) => canReachCapital(x)) || s.kingdoms[0];
    k.atWar = true; k.relation = -90;
    // off guard duty it ignores the raid entirely
    s.aiArmies = [{ id: 'invader', kid: k.id, kind: 'raid', units: { swordsman: 14, archer: 4, pikeman: 0, horseman: 0, catapult: 0, scout: 0, seaman: 0 }, hall: 1, at: far, targetHex: far, path: [], prog: 0, status: 'idle', cooldown: 0 }];
    guardDuty(true);
    const ignored = !d.order || d.order.type !== 'defend';
    d.guard = true; d.guardAt = post;
    guardDuty(true);
    const answered = !!d.order && d.order.type === 'defend' && d.order.hex === far;
    const marching = d.path.length > 0 || d.at === far;
    // the invader leaves; the guard goes back to its post
    d.at = far; d.path = []; d.status = 'idle';
    s.aiArmies = [];
    guardDuty(true);
    const returning = (d.path.length > 0 && d.path[d.path.length - 1] === post) || d.at === post;
    const gap = W.dist(post, far);
    s.kingdoms.forEach((x) => { x.atWar = false; });
    d.guard = false; d.at = s.world.capital; d.path = []; d.order = null;
    return { skip: false, ignored, answered, marching, returning, gap, reach: DETECT_R_IDLE };
  });
  if (r.skip) return;
  assert(r.gap > r.reach, `the raid was outside the division's own detection ring (${r.gap} > ${r.reach} hexes)`);
  assert(r.ignored, 'a division not on guard stays where it is');
  assert(r.answered && r.marching, 'a guarding division marches on an invader anywhere in its connected land');
  assert(r.returning, 'and goes back to its post once the land is clear');
});

await test('zoomed in on High graphics an army is drawn soldier by soldier', async () => {
  const r = await G(async () => {
    const s = window.ironcrown.state;
    const d = s.divisions[0];
    d.at = s.world.capital; d.path = []; d.status = 'idle';
    const troops = armyHousing(d.units);
    const real = window.drawSoldier;
    let n = 0;
    window.drawSoldier = (...a) => { n++; return real(...a); };
    const count = async (graphics, z) => {
      window.ironcrown.SETTINGS.graphics = graphics;
      CAM.z = z; CAM.centerOn(d.at);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      n = 0;
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return n;
    };
    const zoomedIn = await count('high', 5);
    const zoomedOut = await count('high', 1.2);
    const lowPoly = await count('low', 5);
    window.drawSoldier = real;
    window.ironcrown.SETTINGS.graphics = 'high';
    return { troops, zoomedIn, zoomedOut, lowPoly, armyZ: ARMY_Z };
  });
  assert(r.troops > 10, `the division has troops to draw (${r.troops})`);
  assert(r.zoomedIn >= Math.min(r.troops, 100) / 2, `zoomed in, the whole army is drawn, not a flag (${r.zoomedIn} figures for ${r.troops} troops)`);
  assert(r.zoomedOut === 0, `zoomed out past ${r.armyZ} it goes back to a banner (${r.zoomedOut})`);
  assert(r.lowPoly === 0, 'low-poly graphics keep the cheap banner');
  await shot('07e-army-on-map');
});

await test('assets are version-stamped so updates never mix old and new files', async () => {
  const srcs = await page.$$eval('script[src]', (els) => els.map((e) => e.getAttribute('src')));
  const v = await G(() => window.ironcrown.version);
  assert(srcs.length > 10 && srcs.every((x) => x.includes('?v=' + v)), 'every script carries ?v=' + v);
});

await test('pause and game speed controls', async () => {
  await page.click('[data-speed="0"]');
  const t0 = await G(() => window.ironcrown.state.time);
  await page.waitForTimeout(700);
  assert((await G(() => window.ironcrown.state.time)) === t0, 'paused: time stands still');
  assert(await page.isVisible('#paused-banner'), 'paused banner shown');
  await page.click('[data-speed="4"]');
  const t1 = await G(() => window.ironcrown.state.time);
  await page.waitForTimeout(500);
  const dt = (await G(() => window.ironcrown.state.time)) - t1;
  assert(dt > 1.2, `4× speed runs faster than real time (${dt.toFixed(2)}s in 0.5s)`);
  await page.click('[data-speed="1"]');
});

await test('objectives guide the player and pay rewards', async () => {
  const done = await G(() => { checkObjectives(); return Object.keys(window.ironcrown.state.objectives || {}); });
  assert(done.length >= 3, `several objectives completed so far (${done.join(', ')})`);
});

await test('starvation makes soldiers desert', async () => {
  const r = await G(() => {
    const s = window.ironcrown.state; const before = s.army.swordsman;
    s.army.swordsman += 500; const b0 = s.army.swordsman; s.res.food = 0;
    const farms = s.buildings.filter((b) => b.type === 'farm'); farms.forEach((b) => { b._lv = b.level; b.level = 0; });
    for (let t = 0; t < 12; t++) step(1, true);
    farms.forEach((b) => { b.level = b._lv; delete b._lv; });
    return { b0, after: s.army.swordsman };
  });
  assert(r.after < r.b0, `hungry soldiers deserted (${r.b0} → ${r.after})`);
});

await test('render resolution setting changes canvas density', async () => {
  await page.click('.hud-stats [data-action="settings"]');
  await page.selectOption('[data-setting="resolution"]', 'performance');
  const w1 = await page.$eval('#stage', (c) => c.width / c.getBoundingClientRect().width);
  await page.selectOption('[data-setting="resolution"]', 'balanced');
  await page.keyboard.press('Escape');
  assert(w1 <= 1.01, `performance mode renders at 1× (${w1.toFixed(2)})`);
});

await test('graphics quality: high textures ↔ low-poly switch live', async () => {
  await page.click('.hud-stats [data-action="settings"]');
  await page.selectOption('[data-setting="graphics"]', 'low');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const low = await canvasRichness('#stage');
  await shot('10-lowpoly');
  await page.click('.hud-stats [data-action="settings"]');
  await page.selectOption('[data-setting="graphics"]', 'high');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const high = await canvasRichness('#stage');
  assert(low > 20 && high > low, `high quality is more detailed (${low} → ${high} colour buckets)`);
});

await test('enemy raid marches across the map and is resolved', async () => {
  await G(() => { window.ironcrown.SETTINGS.battleMode = 'auto'; });
  const before = await state();
  const msg = await G(() => { const s = window.ironcrown.state, W = window.ironcrown.debug.WG;
    const k = s.kingdoms.find((k) => canReachCapital(k) && s.divisions.every((d) => W.dist(d.at, k.capital) > 3)) || s.kingdoms.find(canReachCapital);
    return cheats.raid(k.id); });
  const raid = (await state()).aiArmies.find((a) => a.kind === 'raid');
  const why = await G(() => JSON.stringify({ shield: ironcrown.state.shield, raids: ironcrown.state.aiArmies.map((a) => [a.kind, a.path.length, a.targetHex]) }));
  assert(raid && raid.path.length > 0 && raid.targetHex != null, `raid army marching on a target hex (${msg} ${why})`);
  assert(await page.isVisible('.alert'), 'threat alert shown');
  await shot('11-raid-alert');
  for (let k = 0; k < 20 && (await G(() => window.ironcrown.state.aiArmies.some((a) => a.kind === 'raid'))); k++) await ff(200);
  const s = await state();
  const done = (x) => x.stats.raidsRepelled + x.stats.raidsLost + x.stats.battlesWon + x.stats.battlesLost;
  assert(!s.aiArmies.some((a) => a.kind === 'raid' && a.id === raid.id), `raid resolved (repelled, pillaged or intercepted) ${JSON.stringify(s.aiArmies.filter((a) => a.kind === 'raid').map((a) => ({ st: a.status, at: a.at, p: a.path.length, t: a.targetHex, n: Object.values(a.units).reduce((x, y) => x + y, 0) })))} ${done(before)}->${done(s)} battles=${await G(() => window.ironcrown.Battles.list.length)}`);
});

await test('diplomacy: gift and declare war', async () => {
  const k0 = (await state()).kingdoms[1];
  await page.keyboard.press('Escape');
  await page.click('[data-tab="info"]');
  await page.keyboard.press('m');
  await page.click('[data-tab="map"]');
  await page.click('[data-action="focus-kingdom"][data-arg="1"]');
  await page.click(`[data-action="diplo"][data-arg="gift:${k0.id}"]`);
  const k1 = (await state()).kingdoms[1];
  assert(k1.relation > k0.relation, 'gift improves relations');
  await page.click(`[data-action="diplo"][data-arg="war:${k0.id}"]`);
  assert((await state()).kingdoms[1].atWar, 'at war');
});

await test('open a mystery box', async () => {
  await page.click('[data-tab="shop"]');
  await page.click('[data-action="open-box"][data-arg="wooden"]');
  await page.waitForSelector('#box-reward', { timeout: 5000 });
  await shot('12-mystery-box');
  await page.click('#modal [data-action="close-modal"]');
  assert((await state()).stats.boxesOpened === 1, 'box counted');
});

await test('alliance: found, donate, chat, leave, join', async () => {
  await page.click('[data-tab="alliance"]');
  await page.fill('#alliance-name', 'Test Legion Pact');
  await page.click('[data-action="create-alliance"]');
  let s = await state();
  assert(s.allianceId && s.alliances.find((a) => a.id === s.allianceId).leader === 'P', 'founded');
  await page.click('[data-action="donate"][data-arg="gold:250"]');
  await page.fill('#chat-input', 'Hello allies!');
  await page.click('[data-action="chat-send"]');
  assert((await page.textContent('#chat')).includes('Hello allies!'), 'chat works');
  await page.click('[data-action="leave"]');
  const target = await G(() => { const s = window.ironcrown.state; return s.alliances.find((a) => a.open && a.minHall <= 6 && a.members.every((m) => m === 'P' || !s.kingdoms[m].atWar))?.id; });
  assert(target, 'an open alliance without enemies exists');
  await page.click(`[data-action="join"][data-arg="${target}"]`);
  assert((await state()).allianceId === target, 'joined an existing alliance');
});

await test('AI kingdoms act over time (expand, build, fleets, wars)', async () => {
  const snap = () => G(() => window.ironcrown.state.kingdoms.map((k) => ({ t: window.ironcrown.debug.kingdomTiles(k.id), h: k.hall, d: k.defense, p: k.power })));
  const a = await snap();
  await ff(900);
  const b = await snap();
  const grew = b.filter((x, i) => x.t > a[i].t || x.h > a[i].h || x.d > a[i].d).length;
  assert(grew >= Math.ceil(b.length / 2), `most kingdoms grew (${grew}/${b.length})`);
});

await test('developer cheats are available from the console', async () => {
  const help = await G(() => window.cheats.help());
  assert(/cheats/.test(help), 'cheats.help() works');
  const g0 = (await state()).res.gold;
  await G(() => window.cheats.gold(12345));
  assert((await state()).res.gold >= g0 + 12345 - 1, 'cheats.gold adds gold');
});

await test('state persists across reloads', async () => {
  const before = await state();
  await G(() => window.ironcrown.api.save());
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
  const after = await state();
  assert(after.name === 'Testoria' && after.buildings.length === before.buildings.length && after.divisions.length === before.divisions.length && after.fleets.length === before.fleets.length, 'kingdom, divisions and fleets restored');
  assert(await page.isHidden('#modal'), 'no welcome screen for returning players');
});

if (local) {
  await test('Python backend stores the save and serves a leaderboard', async () => {
    await page.click('.hud-stats [data-action="menu"]');
    await page.click('#modal [data-action="save"]');
    await page.waitForTimeout(500);
    const lb = await (await fetch(BASE + 'api/leaderboard')).json();
    assert(lb.players.some((p) => p.name === 'Testoria'), 'on the server leaderboard');
    assert((await page.textContent('#sync-label')) === 'synced', 'HUD shows cloud sync');
    await page.keyboard.press('Escape');
  });
}

await test('mobile viewport renders without horizontal overflow', async () => {
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `no sideways scroll (overflow ${overflow}px)`);
  await shot('13-mobile');
  await page.setViewportSize({ width: 1440, height: 900 });
});

await test('no uncaught errors in the console', async () => { assert(errors.length === 0, errors.slice(0, 5).join('\n')); });

await browser.close();
if (server) server.kill();
rmSync(dataDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: tests/screenshots/\n`);
process.exit(failed.length ? 1 : 0);
