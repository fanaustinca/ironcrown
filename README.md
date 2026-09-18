# 👑 Ironcrown

A browser kingdom-strategy game in the spirit of Clash of Clans. Build a kingdom, mine resources, train armies,
recruit legendary generals, scout the fog of war, raid rival AI kingdoms and forge alliances.

**▶ Play: https://fanaustinca.github.io/ironcrown/**

Pure HTML5 Canvas + vanilla JavaScript: no framework and no build step. There's also an optional Python server for
cloud saves and a global leaderboard.

## Features

| Area | What's in it |
|---|---|
| **Kingdom** | Upgradeable **Main Hall** (6 levels) that unlocks land, buildings, building levels, builders and storage. You can drag to paint **Walls**. **Ports** have to touch the sea; their trade ships earn gold, open a market and let you claim islands. Defenses: **Archer Tower, Cannon, Arcane Spire**. |
| **Economy** | **Gold, Iron and Diamond Mines, Lumber Mills, Farms.** Resources accrue in real time, including offline progress (up to 8h). Storage caps scale with the Main Hall. Troops eat food. |
| **Military** | **Archery Range, Barracks, Stables** train Archers, Swordsmen and Horsemen, and the **Scout Lodge** trains Scouts. Barracks level raises unit stats. Battles are animated on canvas with squads, arrows, cannonballs and towers, at 1×/2×/4× speed or skipped. |
| **Generals** | You start with *Sir Aldric*. 13 generals across 4 rarities, each with **Attack / Health / Speed** bars that boost the whole army, plus unit specialties. Duplicates add stars. |
| **Mystery Boxes** | Wooden Crate, Silver Chest and Royal Reliquary show their odds up front. Rewards are rare generals, resource bundles or items (War Horn, Healing Salve, Builder's Hammer, Ancient Map, Peace Shield). |
| **World** | A 34×22 procedurally generated map with fog of war, 6 AI kingdoms and 4 personalities. AI kingdoms **expand, upgrade their keeps, build defenses, train troops, fight each other and raid you**. Scouts reveal land and bring back intel. You can claim neutral land for production bonuses. |
| **Alliances** | Join the three AI alliances or found your own. You can invite or kick kingdoms, toggle recruitment, donate to level the alliance, and use alliance chat. Shared bonuses cover production, attack, defense and training. Allies never raid you and they reinforce you when you're attacked. |
| **Persistence** | Autosaves to localStorage. With the Python server running it also syncs to the cloud and shows a global leaderboard. There's export/import too. |

## Project layout

```
public/            ← the game (this folder is what GitHub Pages serves)
  index.html       HUD, canvas stage, side panel, modals
  style.css        theme + responsive layout
  game.js          engine: data tables, economy, military, world/AI, alliances, battle sim, renderers, UI
server/server.py   optional backend (stdlib only): static files + /api/save + /api/leaderboard
tests/e2e.mjs      Playwright headless-browser test suite (17 tests, screenshots)
.github/workflows/deploy.yml   CI: run tests → deploy public/ to GitHub Pages
deploy.sh          one-shot git init + gh repo create + Pages setup
```

## Run locally

```bash
npm install                      # installs Playwright (tests only; the game has no dependencies)
npm run serve                    # python3 server/server.py → http://127.0.0.1:8000  (cloud-save mode)
# or just open public/index.html directly: it runs fully offline with localStorage
```

## Headless browser tests

```bash
npx playwright install chromium
npm test                                         # starts the Python server, drives the real UI headlessly
npm run test:live                                # the same suite against the live GitHub Pages URL
```

The suite checks that the canvas actually renders by counting its colours, and it drives these flows through real
clicks: building on the map, upgrading, training troops, opening mystery boxes, general stat bars, scouting the fog,
claiming land, a full battle, AI growth over time, founding, donating to and chatting in an alliance, persistence
across reloads, the Python save API and leaderboard, the mobile layout, and a clean console. Screenshots go to
`tests/screenshots/`.

## Deploy to GitHub Pages

The whole thing is scripted: `./deploy.sh`. These are the equivalent manual commands:

```bash
git init -b main
git add -A
git commit -m "Ironcrown: kingdom strategy game"
gh repo create ironcrown --public --source=. --remote=origin --push
gh api -X POST repos/{owner}/ironcrown/pages -f build_type=workflow   # Pages is built by GitHub Actions
gh run watch                                                            # tests run, then public/ is deployed
```

After that, every push to `main` re-runs the Playwright tests and redeploys only if they pass.

## How to play

1. **Build** tab → pick a structure → click a tile inside the dashed border. Watch the builder count (🔨).
2. Build resource buildings first, then upgrade the **Main Hall** to unlock more.
3. Build an **Archery Range** and **Barracks** and train troops from the **Army** tab. Troops eat food.
4. **World** view → click a fogged tile → **Send scouts**. Scouting a kingdom gathers intel, which you need before attacking.
5. Claim neutral land next to your borders for production bonuses. With a Port you can reach the gem-cave islands.
6. Attack scouted rivals for loot and territory. Build towers and walls, because hostile kingdoms will raid you.
7. Spend gold and diamonds on **Mystery Boxes** for better generals, then appoint the best one.
8. Join or found an **Alliance** for shared bonuses and protection.

Console helpers: `ironcrown.state` and `ironcrown.debug.fastForward(600)`.
