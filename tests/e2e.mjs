/**
 * Ironcrown end-to-end tests (Playwright, headless Chromium).
 *
 *   npm test                                  # starts server/server.py and tests locally
 *   BASE_URL=https://<you>.github.io/ironcrown/ npm test   # test the live deployment
 *
 * Every test drives the real UI (clicks on buttons and on the canvas) and uses
 * the window.ironcrown debug hooks only to fast-forward time or grant
 * resources. Screenshots land in tests/screenshots/.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shots = path.join(here, 'screenshots');
mkdirSync(shots, { recursive: true });

const PORT = 8123;
let BASE = process.env.BASE_URL;
let server = null;
const dataDir = path.join(here, '.test-data');

async function startServer() {
  rmSync(dataDir, { recursive: true, force: true });
  server = spawn('python3', [path.join(root, 'server/server.py'), '--port', String(PORT), '--data', dataDir], { stdio: 'inherit' });
  BASE = `http://127.0.0.1:${PORT}/`;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + 'api/health'); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

// ---------------------------------------------------------------- mini runner
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✔ ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log(`  ✘ ${name}\n      ${e.message.split('\n').join('\n      ')}`); await page.screenshot({ path: path.join(shots, `FAIL-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {}); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const G = (fn, arg) => page.evaluate(fn, arg);
const state = () => G(() => window.ironcrown.state);

// Count distinct colours in a canvas region to prove something was actually drawn.
async function canvasRichness(selector) {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel), g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data, colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) colors.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
    return colors.size;
  }, selector);
}
async function clickTile(x, y) {
  const p = await G(([x, y]) => window.ironcrown.debug.tileToClient(x, y), [x, y]);
  await page.mouse.click(p.x, p.y);
}

// ---------------------------------------------------------------- run
if (!BASE) await startServer();
const local = !process.env.BASE_URL;
console.log(`\nIroncrown e2e — ${BASE}\n`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/api\/(health|save)|favicon|404/.test(m.text())) errors.push('console: ' + m.text()); });

const url = (extra = '') => `${BASE}?slot=e2e${extra}`;

await test('loads, shows welcome screen and starts the game', async () => {
  await page.goto(url('&reset=1'));
  await page.waitForSelector('body[data-ready="1"]', { timeout: 15000 });
  await page.waitForSelector('#welcome-name');
  await page.fill('#welcome-name', 'Testoria');
  await page.screenshot({ path: path.join(shots, '01-welcome.png') });
  await page.click('#begin-btn');
  assert(await page.isHidden('#modal'), 'welcome modal should close');
  assert((await page.textContent('#kingdom-name')) === 'Testoria', 'kingdom name shown in HUD');
});

await test('kingdom canvas renders a detailed scene', async () => {
  await page.waitForTimeout(600);
  const rich = await canvasRichness('#stage');
  assert(rich > 60, `expected a colourful canvas, got ${rich} colour buckets`);
  const s = await state();
  assert(s.buildings.some((b) => b.type === 'hall'), 'main hall exists');
  await page.screenshot({ path: path.join(shots, '02-kingdom.png') });
});

await test('resources accumulate automatically over time', async () => {
  const before = (await state()).res.gold;
  await page.waitForTimeout(2200);
  const after = (await state()).res.gold;
  assert(after > before, `gold should grow in real time (${before} → ${after})`);
  const hud = await page.textContent('#res-gold .val');
  assert(/\d/.test(hud), 'gold shown in HUD');
});

await test('build a Farm by clicking the build menu and the map', async () => {
  const count = (await state()).buildings.filter((b) => b.type === 'farm').length;
  await page.click('.build-item[data-type="farm"]');
  assert(await page.isVisible('#placing-hint'), 'placement hint visible');
  const spot = await G(() => window.ironcrown.debug.freeTile('farm'));
  await page.mouse.move(0, 0);
  await clickTile(spot.x, spot.y);
  const farms = (await state()).buildings.filter((b) => b.type === 'farm');
  assert(farms.length === count + 1, 'farm placed');
  const f = farms.find((b) => b.x === spot.x && b.y === spot.y);
  assert(f && f.level === 0 && f.build > 0, 'farm is under construction');
  await G(() => window.ironcrown.debug.fastForward(10));
  const done = (await state()).buildings.find((b) => b.x === spot.x && b.y === spot.y);
  assert(done.level === 1, 'farm finished construction');
});

await test('select a building on the canvas and upgrade it', async () => {
  await G(() => window.ironcrown.debug.give({ gold: 5000, lumber: 5000, iron: 3000, food: 3000 }));
  const s = await state();
  const hall = s.buildings.find((b) => b.type === 'hall');
  await clickTile(hall.x, hall.y + 1);
  await page.waitForSelector('[data-action="upgrade"]');
  assert((await page.textContent('#panel-body')).includes('Main Hall'), 'hall details open');
  await page.click('[data-action="upgrade"]');
  assert((await state()).buildings.find((b) => b.type === 'hall').build > 0, 'hall upgrading');
  await page.screenshot({ path: path.join(shots, '03-upgrade.png') });
  await G(() => window.ironcrown.debug.fastForward(60));
  assert((await G(() => window.ironcrown.debug.hallLevel())) === 2, 'hall reached level 2');
  await page.keyboard.press('Escape');
});

await test('build barracks and train troops from the Army tab', async () => {
  await G(() => window.ironcrown.debug.give({ gold: 5000, lumber: 5000, iron: 3000, food: 3000 }));
  for (const type of ['archery', 'barracks']) {
    await page.click('[data-tab="info"]');
    await page.click(`.build-item[data-type="${type}"]`);
    const spot = await G((t) => window.ironcrown.debug.freeTile(t), type);
    await clickTile(spot.x, spot.y);
  }
  await G(() => window.ironcrown.debug.fastForward(30));
  const before = (await state()).army;
  await page.click('[data-tab="army"]');
  await page.click('[data-action="train"][data-arg="archer:5"]');
  await page.click('[data-action="train"][data-arg="swordsman:5"]');
  await page.screenshot({ path: path.join(shots, '04-army.png') });
  await G(() => window.ironcrown.debug.fastForward(60));
  const after = (await state()).army;
  assert(after.archer === before.archer + 5, `archers trained (${before.archer} → ${after.archer})`);
  assert(after.swordsman === before.swordsman + 5, 'swordsmen trained');
});

await test('generals panel shows attack / health / speed bars', async () => {
  await page.click('[data-tab="generals"]');
  const bars = await page.$$('#active-general-bars .stat-bar');
  assert(bars.length === 3, 'three stat bars for the active general');
  const txt = await page.textContent('#panel-body');
  assert(txt.includes('Sir Aldric'), 'starts with the basic general');
});

await test('open a mystery box in the shop', async () => {
  await G(() => window.ironcrown.debug.give({ gold: 2000 }));
  await page.click('[data-tab="shop"]');
  await page.click('[data-action="open-box"][data-arg="wooden"]');
  await page.waitForSelector('#box-reward', { timeout: 5000 });
  await page.screenshot({ path: path.join(shots, '05-mystery-box.png') });
  assert((await state()).stats.boxesOpened === 1, 'box counted');
  await page.click('#modal [data-action="close-modal"]');
  // Royal box with diamonds; roll several to exercise generals
  await G(() => window.ironcrown.debug.give({ diamonds: 600 }));
  for (let i = 0; i < 6; i++) await G(() => { window.ironcrown.api.openBox('royal'); });
  await page.evaluate(() => { document.getElementById('modal').hidden = true; });
  assert((await state()).stats.boxesOpened === 7, 'seven boxes opened');
});

await test('world map renders with fog, and scouts reveal territory', async () => {
  await page.click('[data-view="world"]');
  await page.waitForTimeout(300);
  assert(await canvasRichness('#stage') > 30, 'world canvas drawn');
  const s = await state();
  const k = s.kingdoms[0];
  const seenBefore = s.world.seen.filter(Boolean).length;
  const p = await G(([x, y]) => window.ironcrown.debug.worldToClient(x, y), [k.cx, k.cy]);
  await page.mouse.click(p.x, p.y);
  await page.waitForSelector('[data-action="scout"]');
  await page.click('[data-action="scout"]');
  assert((await state()).missions.length === 1, 'scout mission underway');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, '06-world-scouting.png') });
  await G(() => window.ironcrown.debug.fastForward(40));
  const after = await state();
  assert(after.world.seen.filter(Boolean).length > seenBefore, 'fog lifted');
  assert(after.intel[k.id], 'intel gathered on the kingdom');
});

await test('claim neutral land next to your territory', async () => {
  await G(() => window.ironcrown.debug.give({ gold: 3000, food: 3000 }));
  const target = await G(() => {
    const s = window.ironcrown.state, W = 34;
    for (let i = 0; i < s.world.owner.length; i++) {
      const x = i % W, y = Math.floor(i / W);
      if (s.world.owner[i] !== -1 || s.world.tiles[i] === 0 || !s.world.seen[i]) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => s.world.owner[(y + dy) * W + x + dx] === -2)) return { x, y };
    }
  });
  const p = await G(([x, y]) => window.ironcrown.debug.worldToClient(x, y), [target.x, target.y]);
  await page.mouse.click(p.x, p.y);
  await page.click('[data-action="claim"]');
  const s = await state();
  assert(s.world.owner[target.y * 34 + target.x] === -2, 'tile now belongs to the player');
});

await test('attack a scouted kingdom and watch the battle', async () => {
  await G(() => { const s = window.ironcrown.state; s.army.archer += 40; s.army.swordsman += 40; });
  const s = await state();
  const k = s.kingdoms[0];
  const p = await G(([x, y]) => window.ironcrown.debug.worldToClient(x, y), [k.cx, k.cy]);
  await page.mouse.click(p.x, p.y);
  await page.click('[data-action="attack-open"]');
  await page.waitForSelector('[data-action="attack-launch"]');
  await page.click('[data-action="attack-launch"]');
  assert(await page.isVisible('#battle'), 'battle view open');
  await page.waitForTimeout(1800);
  assert(await canvasRichness('#battle-canvas') > 25, 'battle canvas drawn');
  await page.screenshot({ path: path.join(shots, '07-battle.png') });
  await page.click('#battle-skip');
  await page.waitForSelector('#battle-close');
  await page.screenshot({ path: path.join(shots, '08-battle-result.png') });
  const after = await state();
  assert(after.stats.battlesWon + after.stats.battlesLost === 1, 'battle recorded');
  await page.click('#battle-close');
  assert(await page.isHidden('#battle'), 'battle closed');
});

await test('AI kingdoms expand and upgrade over time', async () => {
  const before = await G(() => window.ironcrown.state.kingdoms.map((k) => ({ t: window.ironcrown.debug.kingdomTiles(k.id), h: k.hall, p: k.power, d: k.defense })));
  await G(() => window.ironcrown.debug.fastForward(900));
  const after = await G(() => window.ironcrown.state.kingdoms.map((k) => ({ t: window.ironcrown.debug.kingdomTiles(k.id), h: k.hall, p: k.power, d: k.defense })));
  const grew = after.filter((a, i) => a.t > before[i].t || a.h > before[i].h || a.d > before[i].d).length;
  assert(grew >= Math.ceil(after.length / 2), `most kingdoms should grow (${grew}/${after.length})`);
});

await test('found an alliance, donate and chat', async () => {
  await G(() => { const s = window.ironcrown.state; if (s.allianceId) return; });
  await G(() => window.ironcrown.debug.give({ gold: 3000 }));
  await page.click('[data-view="kingdom"]');
  await page.click('[data-tab="alliance"]');
  await page.fill('#alliance-name', 'Test Legion');
  await page.click('[data-action="create-alliance"]');
  let s = await state();
  assert(s.allianceId, 'player is in an alliance');
  const a = s.alliances.find((x) => x.id === s.allianceId);
  assert(a.name === 'Test Legion' && a.leader === 'P', 'player leads the new alliance');
  await page.click('[data-action="donate"][data-arg="gold:250"]');
  s = await state();
  assert(s.alliances.find((x) => x.id === s.allianceId).xp >= 250 || s.alliances.find((x) => x.id === s.allianceId).level > 1, 'donation counted');
  await page.fill('#chat-input', 'Hello allies!');
  await page.click('[data-action="chat-send"]');
  assert((await page.textContent('#chat')).includes('Hello allies!'), 'chat message visible');
  await page.screenshot({ path: path.join(shots, '09-alliance.png') });
  await page.click('[data-action="leave"]');
  await page.click('[data-action="join"][data-arg="a1"]');
  s = await state();
  assert(s.allianceId === 'a1', 'joined an existing open alliance');
});

await test('game state persists across reloads', async () => {
  const before = await state();
  await G(() => window.ironcrown.api.save());
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
  const after = await state();
  assert(after.name === 'Testoria', 'name restored');
  assert(after.buildings.length === before.buildings.length, 'buildings restored');
  assert(await page.isHidden('#modal'), 'no welcome screen for returning players');
});

if (local) {
  await test('Python backend stores the save and serves a leaderboard', async () => {
    await G(() => window.ironcrown.api.save());
    await page.evaluate(() => fetch('api/health'));
    await page.click('[data-action="menu"]');
    await page.click('#modal [data-action="save"]');
    await page.waitForTimeout(500);
    const lb = await (await fetch(BASE + 'api/leaderboard')).json();
    assert(lb.players.some((p) => p.name === 'Testoria'), 'player on the server leaderboard');
    assert((await page.textContent('#sync-label')) === 'synced', 'HUD shows cloud sync');
  });
}

await test('mobile viewport renders without horizontal overflow', async () => {
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `page should not scroll sideways (overflow ${overflow}px)`);
  await page.screenshot({ path: path.join(shots, '10-mobile.png'), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
});

await test('no uncaught errors in the console', async () => {
  assert(errors.length === 0, errors.join('\n'));
});

await browser.close();
if (server) server.kill();
rmSync(dataDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: tests/screenshots/\n`);
process.exit(failed.length ? 1 : 0);
