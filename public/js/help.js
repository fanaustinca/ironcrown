/* ==========================================================================
   In-game help guide (opened with the ? button, or the H / ? keys).
   ========================================================================== */
'use strict';

const HELP = [
  { id: 'start', icon: '🚀', title: 'Getting started', html: `
    <p>You rule a small kingdom in a world of rival realms, pirates and forgotten ruins. The game runs in real time, and your economy keeps working while you're away (up to 8 hours).</p>
    <ol>
      <li><b>Build economy first.</b> Open the <b>🏗️ Build</b> tab, pick a Gold Mine, Lumber Mill or Farm, and click a free hex inside your golden border.</li>
      <li><b>Upgrade the Main Hall</b> (click the castle). Each level grows your hexagonal land by one ring and unlocks new buildings, including Ports, Shipyards, Universities and Stables at level 2.</li>
      <li><b>Train troops</b> in the <b>⚔️ Army</b> tab and group them into <b>divisions</b>.</li>
      <li>Switch to the <b>🗺️ World</b> view (top-left, or press <kbd>M</kbd>) to explore, claim land, fight and trade.</li>
      <li>Build a <b>University</b> and start <b>🎓 Research</b> early, because it multiplies everything.</li>
    </ol>
    <p class="tip">Tip: hover over anything for a tooltip. The top bar shows every resource with its storage cap and income per minute. Hover a resource for a full breakdown.</p>` },
  { id: 'camera', icon: '🎥', title: 'Camera & controls', html: `
    <table class="keys">
      <tr><td>Drag with mouse or finger</td><td>Move the map (default)</td></tr>
      <tr><td>Scroll wheel / pinch</td><td>Zoom in & out</td></tr>
      <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows</td><td>Move the map (enable in Settings → Camera)</td></tr>
      <tr><td><kbd>+</kbd> <kbd>−</kbd> / zoom buttons</td><td>Zoom</td></tr>
      <tr><td><kbd>Space</kbd> / ⌖ button</td><td>Recenter on your capital</td></tr>
      <tr><td><kbd>K</kbd> / <kbd>M</kbd></td><td>Kingdom view / World map</td></tr>
      <tr><td>Left-click</td><td>Select a building, hex, division or fleet</td></tr>
      <tr><td>Right-click (World)</td><td>Give the selected division/fleet the default order for that hex</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Cancel placement / deselect / close dialogs</td></tr>
      <tr><td><kbd>H</kbd> or <kbd>?</kbd></td><td>This help guide</td></tr>
    </table>
    <p>Open <b>⚙️ Settings</b> in the top bar to choose how the camera moves: <b>Drag</b>, <b>Keyboard</b> or <b>Both</b>. You can also invert dragging, turn on edge scrolling, change the zoom speed and toggle the minimap. On the World map, click or drag the <b>minimap</b> in the corner to jump anywhere.</p>` },
  { id: 'kingdom', icon: '🏰', title: 'Kingdom & buildings', html: `
    <p>Your kingdom is a hex map around the <b>Main Hall</b>. The glowing golden hexagon is your land, and the faint dashed ring shows where the next Hall level will expand it. The sea lies to the east, and coastal buildings (Port, Shipyard) must touch it.</p>
    <ul>
      <li><b>Placing:</b> Build tab → choose → click a hex. Green is valid, red explains why not. Walls can be <b>painted by dragging</b>.</li>
      <li><b>Trees & rocks</b> block some hexes. Click them and pay 🪙25 to clear them, which gives lumber or iron.</li>
      <li><b>Upgrading:</b> click a building → Upgrade. A building's level can't exceed the Main Hall's level.</li>
      <li><b>Builders:</b> each construction or upgrade takes a builder (🔨 in the top bar). More builders come with Hall levels and the Engineering research.</li>
      <li><b>Demolish</b> refunds 40% of the cost.</li>
    </ul>
    <table class="keys"><tr><th>Building</th><th>Unlocks at Hall</th><th>Does</th></tr>
      ${BUILD_ORDER.map((t) => `<tr><td>${BUILDINGS[t].icon} ${BUILDINGS[t].name}</td><td>${BUILDINGS[t].hall || 1}</td><td>${BUILDINGS[t].desc}</td></tr>`).join('')}</table>` },
  { id: 'resources', icon: '💰', title: 'Resources & seasons', html: `
    <p>There are five resources: 🪙 Gold, ⛓️ Iron, 💎 Diamonds, 🪵 Lumber and 🌾 Food. They flow in automatically from mines, mills, farms, the Main Hall (taxes), Ports (trade) and the <b>land you hold on the World map</b>.</p>
    <ul>
      <li><b>Storage</b> is capped by the Main Hall. Warehouses and the Banking research raise it. A full bar turns gold.</li>
      <li><b>Upkeep:</b> every soldier eats food, and every ship costs a little gold. Keep your income positive!</li>
      <li><b>Seasons</b> pass every 10 in-game days (15 minutes). Spring +10% food, autumn +15% food, <b>winter −30% food and slower marches</b>. The map turns snowy.</li>
      <li><b>Market:</b> a Port lets you sell surplus goods for gold, or buy what you lack.</li>
    </ul>` },
  { id: 'research', icon: '🎓', title: 'Universities & research', html: `
    <p>Build a <b>University</b> (Main Hall 2) and open the <b>🎓 Research</b> tab. Each university studies <b>one technology at a time</b>, so build more to research in parallel. A university's level decides which tier it can study (🎓 L1–L3) and makes it study faster.</p>
    <p>Technologies have up to 3 levels (● pips), and some need prerequisites. Highlights:</p>
    <ul>
      ${Object.values(RESEARCH).map((r) => `<li>${r.icon} <b>${r.name}</b>: ${r.desc(1)} per level${r.max > 1 ? ` (max ${r.max})` : ''}</li>`).join('')}
    </ul>
    <p class="tip">"Faster ships" = Navigation + Lateen Sails. "Faster horses" = Horse Breeding. "Better armour" = Iron Armour and Heavy Cavalry.</p>` },
  { id: 'army', icon: '⚔️', title: 'Army & divisions', html: `
    <p>Train troops in the <b>⚔️ Army</b> tab (or by clicking a military building). New troops join the <b>garrison</b> at your capital, which defends against raids.</p>
    <table class="keys"><tr><th>Unit</th><th>Trained at</th><th>Strengths</th></tr>
      ${Object.entries(UNITS).map(([k, u]) => `<tr><td>${u.icon} ${u.name}</td><td>${BUILDINGS[u.from].name}</td><td>${u.vs ? Object.entries(u.vs).map(([v, m]) => `×${m} vs ${(UNITS[v] || { name: 'towers' }).name}`).join(', ') : k === 'scout' ? 'Explores and spies' : '—'}${u.research ? ' · needs ' + RESEARCH[u.research].name : ''}</td></tr>`).join('')}</table>
    <h4>Divisions</h4>
    <ul>
      <li>Click <b>Muster a new division</b>, name it, choose troops with the sliders and pick a general.</li>
      <li>Divisions appear as <b>banners</b> on the World map. Select one (click the banner, or use Select in the Army tab), then click any hex to see its <b>orders</b>:
        <b>March</b>, <b>Assault</b> an enemy capital, <b>Invade</b> an enemy hex, <b>Explore</b> ruins or caves, <b>Capture</b> a fort, <b>March & claim</b> neutral land, or <b>Intercept</b> an enemy army.</li>
      <li>Right-click a hex to give the default order instantly. The route is drawn as a dashed line with an ETA.</li>
      <li>Terrain matters: forests, hills and swamps are slow, and <b>mountains are impassable</b>. To cross water, divisions board transport ships automatically if your Cogs and Galleons have enough capacity.</li>
      <li>Divisions back at the capital can be <b>reinforced</b> or <b>disbanded</b>. They also help defend the capital while they're home.</li>
      <li>The number of divisions you can field grows with the Main Hall.</li>
    </ul>` },
  { id: 'generals', icon: '🎖️', title: 'Generals & items', html: `
    <p>Generals have <b>Attack, Health and Speed</b> ratings (the bars) that boost the troops they lead. <b>Specialists</b> add +15% to one unit type, and <b>Admirals</b> (⚓) add +15% to ships.</p>
    <ul>
      <li>In the <b>🎖️ Generals</b> tab, set each general's <b>Post</b>: a division, a fleet, or <b>Castellan</b> (leads the home garrison).</li>
      <li>You start with Sir Aldric. Find more in <b>Mystery Boxes</b>, rarely in <b>ruins</b>, and from destroyed <b>pirate coves</b>.</li>
      <li>Duplicates add ★ stars (+10% stats each, max 5★).</li>
    </ul>
    <h4>Items</h4><ul>${Object.values(ITEMS).map((i) => `<li>${i.icon} <b>${i.name}</b>: ${i.desc}</li>`).join('')}</ul>` },
  { id: 'navy', icon: '⚓', title: 'Navy & fleets', html: `
    <p>Build a <b>Shipyard</b> on the coast (Main Hall 2), then build ships from the <b>⚓ Navy</b> tab. Higher shipyard levels unlock bigger ships.</p>
    <table class="keys"><tr><th>Ship</th><th>Shipyard</th><th>Role</th></tr>
      ${Object.values(SHIPS).map((s) => `<tr><td>${s.icon} ${s.name}</td><td>L${s.lvl}</td><td>${s.desc}</td></tr>`).join('')}</table>
    <ul>
      <li>New ships wait in the <b>home harbour</b>, where they guard your port against pirates. <b>Form a fleet</b> to send them out, with an admiral if you have one.</li>
      <li>Select a fleet on the World map to: <b>Sail</b>, <b>Salvage</b> shipwrecks, <b>Attack pirate coves</b>, <b>Blockade</b> a coastal kingdom (sink its navy and plunder its harbour), or <b>Hunt</b> enemy fleets.</li>
      <li>Fleets reveal the fog as they sail. <b>Cogs</b> and <b>Galleons</b> give your divisions transport capacity to cross the sea to islands.</li>
      <li>🏴‍☠️ <b>Pirates</b> sail from their coves and prey on your fleets and harbour. If your harbour has no ships, they steal gold and blockade your port.</li>
    </ul>` },
  { id: 'world', icon: '🗺️', title: 'World map & exploration', html: `
    <p>The World map is a procedurally generated hex continent with seas, islands, lakes and varied terrain:</p>
    <ul>${Object.values(TERRAIN).map((t) => `<li><b>${t.name}</b>: ${t.cost === Infinity ? (t.name === 'Sea' ? 'ships only' : 'impassable') : 'move cost ×' + t.cost}${t.bonus ? ' · holding it gives ' + Object.entries(t.bonus).map(([k, v]) => RES_META[k].icon + '+' + (v * 60).toFixed(0) + '/min').join(' ') : ''}</li>`).join('')}</ul>
    <h4>Points of interest</h4>
    <ul>${Object.values(FEATURES).map((f) => `<li>${f.icon} <b>${f.name}</b>: ${f.desc}</li>`).join('')}</ul>
    <h4>Fog of war & scouting</h4>
    <p>Unexplored land is hidden. Click any hex → <b>Send scouts</b>. They travel there, reveal a wide area, explore caves and gather <b>intel</b> on nearby kingdoms. Divisions and fleets also reveal hexes as they move. Scout Lodge levels and Cartography increase vision.</p>
    <h4>Territory</h4>
    <p>Your borders are hexagonal and gold. <b>Claim</b> neutral hexes next to your land (the cost rises with size), or march a division anywhere and choose <b>March & claim</b>. Captured forts become <b>outposts</b> that let you claim within 2 hexes of them. The territory limit grows with the Main Hall and Administration.</p>` },
  { id: 'combat', icon: '🛡️', title: 'Combat, raids & defense', html: `
    <ul>
      <li>Battles are simulated with squads, arrows, cannonballs and towers. By default you <b>watch</b> them (1×/2×/4× or Skip), and in Settings you can switch to <b>auto-resolve</b>.</li>
      <li><b>Counters:</b> Pikemen crush cavalry, Horsemen ride down archers and catapults, Archers shred pikemen, Swordsmen beat archers up close, and Catapults smash towers.</li>
      <li><b>Raids:</b> hostile kingdoms send armies that march across the map. You get a red ⚠ alert with an ETA. <b>Intercept</b> them with a division, or let your garrison, towers, walls and home divisions defend when they arrive. If they win, they plunder resources and may take a border hex.</li>
      <li>Towers, Cannons and Arcane Spires fight in defense battles. Walls strengthen them. Masonry and Fortification research help too.</li>
      <li><b>Field Medicine</b> saves part of your casualties. War Horns and Healing Salves boost your next battle.</li>
      <li>Winning an assault on a capital loots its treasury and can seize border hexes.</li>
    </ul>` },
  { id: 'diplomacy', icon: '🕊️', title: 'AI kingdoms & diplomacy', html: `
    <p>Six AI kingdoms live on the map. Each has a personality (Aggressive, Expansionist, Builder, Balanced). They <b>expand</b> their borders, <b>upgrade</b> their keeps, <b>build</b> defenses, <b>train</b> armies, keep <b>navies</b>, and <b>march on each other</b>. You can watch their armies move once you've scouted the area.</p>
    <p>Click a kingdom's land → <b>Diplomacy</b>:</p>
    <ul>
      <li>🎁 <b>Gift</b>: improve relations (better with Diplomacy research).</li>
      <li>🕊️ <b>Treaty</b>: 20 minutes of non-aggression (relation 10+).</li>
      <li>⚖️ <b>Trade pact</b>: +5% gold per pact (relation 35+).</li>
      <li>💰 <b>Demand tribute</b>: works if you're much stronger, and angers them.</li>
      <li>⚔️ <b>Declare war</b> / 🕊️ <b>Make peace</b>. Kingdoms at war raid you often and their fleets attack yours.</li>
    </ul>
    <p>Relation ranges from −100 (enemy) to +100 (friendly). Kingdoms below −35 or at war are hostile on the map.</p>` },
  { id: 'alliances', icon: '🤝', title: 'Alliances', html: `
    <ul>
      <li>Join one of the AI alliances (some are invite-only and may decline), or <b>found your own</b> for 🪙1000.</li>
      <li>Alliances give shared bonuses to production, attack, defense and training speed. Allies never raid you and they <b>reinforce your capital</b> in raids.</li>
      <li>Donate resources to level the alliance up (max 10). As leader you can invite or kick kingdoms and toggle open recruitment.</li>
      <li>Alliance chat is where your allies gossip and react to you.</li>
    </ul>` },
  { id: 'shop', icon: '🎁', title: 'Mystery boxes', html: `
    <p>The <b>🎁 Shop</b> sells three boxes, with their odds shown on each card:</p>
    <ul>${BOXES.map((b) => `<li>${b.icon} <b>${b.name}</b> (${Object.entries(b.cost).map(([k, v]) => RES_META[k].icon + v).join('')}): generals ${b.kinds.general}%, items ${b.kinds.item}%, resources ${b.kinds.res}%. Legendary chance ${b.rarity.legendary}%.</li>`).join('')}</ul>` },
  { id: 'saves', icon: '💾', title: 'Saving, settings & version', html: `
    <ul>
      <li>The game autosaves to this browser every 15 seconds and when you leave. If the optional Python server is running, it also syncs to the cloud and shows a global leaderboard.</li>
      <li>☰ Menu → Export/Import moves a save between browsers, and Reset starts over.</li>
      <li>⚙️ Settings holds the camera mode, zoom speed, edge scrolling, grid lines, particles, minimap and battle mode.</li>
      <li>The version number appears in the bottom-left corner of the map and in the menu.</li>
      <li><b>Developer cheats:</b> open the browser console (F12) and type <code>cheats.help()</code>.</li>
    </ul>` },
];
