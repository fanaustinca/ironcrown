# 👑 Ironcrown `v3.2.0`

A browser kingdom-strategy game and living world simulation. Build a kingdom on a hex map, research technologies at
universities, raise armies and navies, group them into divisions and fleets, explore ruins, caves, forts and
shipwrecks, fight pirates, and trade with, ally or conquer six AI kingdoms that grow on their own.

**▶ Play: https://fanaustinca.github.io/ironcrown/**

It's pure HTML5 Canvas + vanilla JavaScript with no build step and no dependencies. It also runs straight from
`public/index.html` on disk. An optional Python server adds cloud saves and a global leaderboard.

## Features

| Area | What's in it |
|---|---|
| **One map, small hexes** | The whole world is a single grid of about 16,500 small hexes. Land, sea, your city, enemy cities, armies and battles all share it, so there's no scale jump when zooming. You can build on any hex you own, and terrain boosts production (mills in forests, mines on hills, farms on plains). Enemy capitals are procedural cities (keep, buildings, walls, towers), and AI land shows farms, mines and villages. Every army, guard, fleet and battle is on the same map. |
| **Hex kingdom** | A **Main Hall with no maximum level**; each level claims another ring of land and scales limits, builders and divisions. The coastline has curves, beaches, foam and shallow-water bands. You can clear trees and rocks, paint walls by dragging, and build 18 building types. |
| **Economy** | Gold, Iron, Diamonds, Lumber and Food, plus storage caps and Warehouses. Upkeep is food for troops and gold for ships. Four seasons affect harvests and marching. There's a Port market, and offline progress runs for up to 8 hours. |
| **Research** | Universities run one project each: 26 technologies in 4 trees, each with up to 3 levels. They include faster ships, faster horses, better armour, siege engineering, cartography, banking and engineering. |
| **Army & divisions** | Archers, Swordsmen, Pikemen, Horsemen and Catapults, with counter bonuses. There's no army cap, only upkeep. You group troops into named divisions, each led by its own general, which you can resize, split or merge, and march them on the map to assault capitals, invade hexes, explore ruins and caves, capture forts and intercept raiders. Idle divisions guard their hex and its neighbours. |
| **On-map battles** | There's no separate battle screen: fights happen where the armies meet. A command bar lets you set each division's formation (Line / Wedge / Square / Skirmish), stance (Advance / Hold / Charge / Retreat) and target priority mid-battle. **Coalition battles:** every force within one hex joins, so your divisions fight together, enemy armies fight beside their garrison and towers, and allies join you. 3-way battles happen when a third side is hostile to both. The enemy picks counter-formations. |
| **Scouts** | Scout parties are units: dispatch one, click any point on the map, and every hex along the route is revealed. They also explore caves and gather intel. |
| **Territory** | Claim explored land anywhere; the price rises with distance from your borders. Each owned hex can hold a Farmstead, Lumber Camp, Mine, Village, Watchtower, Fortress or Dock (levels 1–3). Raiders target your least-defended hexes. |
| **Navy & fleets** | Seamen trained at the Port crew every ship. The Shipyard builds Sloops, Cogs, Galleys, Frigates, Galleons and the Man o' War. Grouped into fleets, they can sail, salvage wrecks, burn pirate coves, blockade coastal kingdoms and hunt enemy fleets. Cogs and Galleons ferry divisions across the sea. |
| **Graphics** | ✨ High (procedural grass, rock, sand, snow and water textures, hill-shading, water caustics and glints, cloud shadows), 🎨 Classic, or 🔷 Low-poly, switchable live in Settings. |
| **World simulation** | A procedurally generated hex continent with islands, lakes, mountains, hills, forests, deserts and swamps, under a fog of war. Six AI kingdoms expand, upgrade, build, keep guard armies and navy patrols, and march armies on each other and on you. Pirates roam. |
| **Generals** | 17 generals in 4 rarities, each with Attack / Health / Speed bars. There's one general per division, and each general holds only one post. You can own several copies of a general and merge copies to promote (+★). You can hire more at the Tavern. Specialists and admirals get extra bonuses. |
| **Diplomacy & alliances** | Gifts, non-aggression treaties, trade pacts, tribute, war and peace. You can join AI alliances or found your own, then invite, donate and chat. Allies reinforce you. |
| **Mystery boxes** | Three boxes with their odds shown. Rewards are generals, resources or items. |
| **Battles** | An animated land and naval battle simulator with towers, cannons, catapult splash and ship broadsides. You can watch at 1×/2×/4×, skip, or auto-resolve. |
| **Camera** | Drag to pan, scroll or pinch to zoom, a minimap, and zoom buttons. In Settings you can switch to drag, WASD/arrows, or both, and turn on edge scrolling. |
| **UI** | Detailed HUD with calendar, builders, research, housing, navy and power. It also has threat alerts with ETAs, rich tooltips, a 14-section help guide (`H` / `?`), settings, and a version label. |

## Project layout

```
public/                 ← the game; GitHub Pages serves this folder
  index.html            HUD, map canvas, side panel, modals
  style.css
  js/                   classic scripts sharing one global scope (load order in index.html)
    data.js             constants & data tables (buildings, units, ships, research, generals…)
    util.js             RNG, noise, formatting, HexGrid (odd-r), A* pathfinding
    state.js            save format, settings, persistence, backend sync, calendar
    economy.js          kingdom hex land, obstacles, construction, production, bonuses
    military.js         unit/ship stats, training, shipbuilding, divisions, fleets, generals, boxes
    research.js         universities & technology
    world.js            world generation, features, territory, scouting
    sim.js              movement & orders, AI kingdoms/armies/fleets, pirates, raids, diplomacy, step()
    alliances.js
    battle.js           on-map land & naval battles: formations, stances, targets
    render-common.js    camera, organic coastlines, building art, particles
    gfx.js              graphics quality: procedural textures, hill-shading, low-poly mode
    render-city.js      buildings on the map (yours + procedural AI cities), villagers, effects
    render-world.js     world map, fog of war, minimap
    help.js             in-game help guide
    ui-panels.js        HUD & side-panel tabs
    ui-actions.js       modals, actions, map input (drag / keys / edge / pinch / wheel)
    main.js             game loop, boot, test hooks, dev cheats
server/server.py        optional backend (stdlib only): static files + /api/save + /api/leaderboard
tests/e2e.mjs           Playwright headless-browser suite (40 tests + screenshots)
.github/workflows/deploy.yml   CI: run tests → deploy public/ to GitHub Pages
deploy.sh               one-shot git init + gh repo create + Pages setup
```

## Run locally

```bash
npm install          # Playwright, for the tests only
npm run serve        # python3 server/server.py → http://127.0.0.1:8000 (with cloud saves)
# …or just open public/index.html in a browser
```

## Developer cheats (F12)

Open DevTools (F12) → Console and type `cheats.help()`. The commands include `cheats.god()`, `cheats.res(1e5)`,
`cheats.hall(6)`, `cheats.army(50)`, `cheats.ships(5)`, `cheats.researchAll()`, `cheats.generals()`,
`cheats.reveal()`, `cheats.time(600)`, `cheats.speed(5)`, `cheats.season(3)`, `cheats.raid()`, `cheats.pirates()`,
`cheats.peace()`, `cheats.war(kid)`, `cheats.seamen(100)` and `cheats.generals(2)`.

## Tests

```bash
npx playwright install chromium
npm test             # starts the Python server and drives the real UI headlessly
npm run test:live    # the same suite against the live GitHub Pages URL
```

The suite covers:

- the welcome screen and version label
- hex rendering
- camera drag, zoom and keyboard mode
- the help guide
- building, clearing obstacles and upgrading the hall
- research
- training and mustering a division with a general
- world marching, scouting and fog
- shipyard → ships → fleet → sailing and salvage
- ruins exploration
- a watched capital assault
- an AI raid march
- diplomacy, mystery boxes and alliances
- AI growth, cheats, persistence, the Python API, mobile layout and a clean console

## Deploy to GitHub Pages

```bash
./deploy.sh                      # or manually:
git init -b main && git add -A && git commit -m "Ironcrown"
gh repo create ironcrown --public --source=. --remote=origin --push
gh api -X POST repos/{owner}/ironcrown/pages -f build_type=workflow
```

After that, every push to `main` runs the Playwright tests and deploys `public/` if they pass.
