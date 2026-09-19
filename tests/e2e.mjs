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

await test('kingdom renders as a hex map with a hexagonal land border', async () => {
  await page.waitForTimeout(500);
  assert((await canvasRichness('#stage')) > 70, 'detailed canvas');
  const s = await state();
  assert(s.buildings.find((b) => b.type === 'hall'), 'main hall');
  const land = await G(() => { const d = window.ironcrown.debug; return d.KG.within(d.HALL_HEX, 4).length; });
  assert(land === 61, `hexagonal land of radius 4 has 61 hexes (got ${land})`);
  await shot('02-kingdom');
});

await test('resources accumulate in real time', async () => {
  const before = (await state()).res.gold;
  await page.waitForTimeout(1500);
  assert((await state()).res.gold > before, 'gold grows');
});

await test('camera: drag pans, wheel zooms, buttons recenter', async () => {
  const c0 = await G(() => ({ ...window.ironcrown.CAM.kingdom }));
  await page.mouse.move(500, 500); await page.mouse.down(); await page.mouse.move(360, 420, { steps: 8 }); await page.mouse.up();
  const c1 = await G(() => ({ ...window.ironcrown.CAM.kingdom }));
  assert(Math.abs(c1.x - c0.x) > 40 && Math.abs(c1.y - c0.y) > 20, `drag moved the camera (${c0.x.toFixed(0)},${c0.y.toFixed(0)} → ${c1.x.toFixed(0)},${c1.y.toFixed(0)})`);
  await page.mouse.move(500, 500); await page.mouse.wheel(0, -400); await page.waitForTimeout(100);
  assert((await G(() => window.ironcrown.CAM.kingdom.z)) > c1.z, 'wheel zooms in');
  await page.click('[data-action="zoom-home"]');
});

await test('settings: keyboard camera mode disables drag and enables WASD', async () => {
  await page.click('.hud-stats [data-action="settings"]');
  await page.selectOption('[data-setting="panMode"]', 'keys');
  await page.keyboard.press('Escape');
  const x0 = await G(() => window.ironcrown.CAM.kingdom.x);
  await page.mouse.move(500, 500); await page.mouse.down(); await page.mouse.move(300, 500, { steps: 6 }); await page.mouse.up();
  assert(Math.abs((await G(() => window.ironcrown.CAM.kingdom.x)) - x0) < 1, 'drag no longer pans in keyboard mode');
  await page.keyboard.down('d'); await page.waitForTimeout(350); await page.keyboard.up('d');
  assert(Math.abs((await G(() => window.ironcrown.CAM.kingdom.x)) - x0) > 20, 'D key pans');
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
  const hex = await G(() => { const d = window.ironcrown.debug; return d.KG.within(d.HALL_HEX, 4).find((i) => window.obstacleAt && obstacleAt(i)); });
  assert(hex !== undefined, 'an obstacle exists on the land');
  await clickHex('kingdom', hex);
  await page.click('[data-action="clear-obstacle"]');
  assert((await state()).cleared.includes(hex), 'hex cleared');
});

await test('upgrade the Main Hall and grow the hexagonal land', async () => {
  const s = await state();
  const hall = s.buildings.find((b) => b.type === 'hall');
  await clickHex('kingdom', hall.hex);
  await page.click('[data-action="upgrade"]');
  await ff(80);
  assert((await G(() => window.ironcrown.debug.hallLevel())) === 2, 'hall level 2');
  await G(() => { cheats.hall(3); });
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

await test('world map: hex terrain, fog, minimap, select a division and march', async () => {
  await page.click('[data-view="world"]');
  await page.waitForTimeout(300);
  assert((await canvasRichness('#stage')) > 40, 'world drawn');
  assert(await page.isVisible('#minimap'), 'minimap visible');
  const s = await state();
  const d = s.divisions.find((x) => x.name === 'Test Legion');
  await page.click('[data-tab="army"]');
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
  const k = s.kingdoms[0];
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
  await ff(200);
  const s2 = await state();
  assert(route.every((i) => s2.world.seen[i]), 'every hex on the route was revealed');
  assert(s2.world.seen.filter(Boolean).length > seen0 && s2.intel[k.id], 'fog lifted and intel gathered');
});

await test('claim land anywhere and build on it', async () => {
  await G(() => window.ironcrown.debug.give({ gold: 30000, lumber: 30000, iron: 10000, food: 10000 }));
  const hex = await G(() => { const s = window.ironcrown.state, W = window.ironcrown.debug.WG; return s.world.owner.map((o, i) => i).filter((i) => s.world.owner[i] === -1 && s.world.seen[i] && [1, 2].includes(s.world.terrain[i]) && !s.world.feat[i] && distToTerritory(i) >= 3).sort((a, b) => W.dist(a, s.world.capital) - W.dist(b, s.world.capital))[0]; });
  assert(hex !== undefined, 'a distant neutral plains hex');
  await page.keyboard.press('Escape');
  await clickHex('world', hex);
  await page.click('[data-action="claim"]');
  assert((await state()).world.owner[hex] === -2, 'claimed a hex far from the borders');
  await page.click('[data-action="tb-build"][data-tb="farmstead"]');
  assert((await state()).world.bld[hex]?.type === 'farmstead', 'farmstead under construction');
  await ff(30);
  assert((await state()).world.bld[hex].level === 1, 'farmstead built');
  await shot('07c-territory');
});

await test('port trains seamen, shipyard builds crewed ships, form a fleet and sail', async () => {
  await page.click('[data-view="kingdom"]');
  await page.click('[data-tab="info"]');
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
  await page.click('[data-action="build-ship"][data-arg="sloop:1"]');
  await page.click('[data-action="build-ship"][data-arg="cog:1"]');
  await ff(40);
  const hs = await state();
  assert(hs.harbor.cog === 1 && hs.army.seaman < 14, 'ships launched into harbour with their crews aboard');
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
  const wreck = await G(() => Object.keys(window.ironcrown.state.world.feat).map(Number).find((i) => window.ironcrown.state.world.feat[i].type === 'wreck'));
  const f = (await state()).fleets[0];
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
  await page.click('[data-action="b-resolve"]');
  const s = await state();
  assert(s.stats.battlesWon + s.stats.battlesLost >= 1, 'battle recorded');
  await page.waitForTimeout(3500);
  assert(await G(() => window.ironcrown.Battles.list.length) === 0, 'battlefield cleared');
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
  await G(() => cheats.raid());
  const raid = (await state()).aiArmies.find((a) => a.kind === 'raid');
  assert(raid && raid.path.length > 0 && raid.targetHex != null, 'raid army marching on a target hex');
  assert(await page.isVisible('.alert'), 'threat alert shown');
  await shot('11-raid-alert');
  await ff(600);
  const s = await state();
  assert(s.stats.raidsRepelled + s.stats.raidsLost > before.stats.raidsRepelled + before.stats.raidsLost, 'raid resolved');
});

await test('diplomacy: gift and declare war', async () => {
  const k0 = (await state()).kingdoms[1];
  await page.keyboard.press('Escape');
  await page.click('[data-tab="info"]');
  await page.click('[data-view="world"]');
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
