/* ==========================================================================
   UI part 1: toasts, HUD, and the side-panel tab renderers.
   ========================================================================== */
'use strict';

function toast(text, kind = '') {
  const box = el('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = text;
  box.appendChild(t);
  while (box.children.length > 5) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 4200);
}

/* ---------- HUD ---------- */
function buildHud() {
  el('resources').innerHTML = RES.map((k) => `<div class="res" id="res-${k}" style="--c:${RES_META[k].color}">
    <span class="ico">${RES_META[k].icon}</span><div class="res-txt"><span class="val">0</span><span class="cap">/0</span></div><span class="rate"></span><i class="fill"></i></div>`).join('');
  el('version').textContent = 'v' + GAME_VERSION;
}
function bumpRes(keys) {
  for (const k of keys) { const n = el('res-' + k); if (n) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); } }
}
function updateHud() {
  const r = rates(), tb = territoryBonus(), u = upkeep();
  for (const k of RES) {
    const n = el('res-' + k), cap = capOf(k), v = r[k] * 60;
    n.querySelector('.val').textContent = fmt(S.res[k]);
    n.querySelector('.cap').textContent = '/' + fmt(cap);
    const rate = n.querySelector('.rate');
    rate.textContent = (v >= 0 ? '+' : '') + (Math.abs(v) >= 100 ? fmt(v) : v.toFixed(Math.abs(v) < 10 ? 1 : 0)) + '/m';
    rate.classList.toggle('neg', v < 0);
    n.querySelector('.fill').style.width = clamp((S.res[k] / cap) * 100, 0, 100) + '%';
    n.classList.toggle('full', S.res[k] >= cap);
    n.title = `${RES_META[k].name}: ${Math.floor(S.res[k])} / ${cap}\nNet ${v.toFixed(1)}/min · land bonus +${(tb[k] * 60).toFixed(1)}/min · multiplier ×${prodMult(k).toFixed(2)}` +
      (k === 'food' ? `\nTroop upkeep −${(u.food * 60).toFixed(1)}/min` : '') + (k === 'gold' && u.gold ? `\nShip upkeep −${(u.gold * 60).toFixed(1)}/min` : '');
  }
  const cal = calendar();
  el('kingdom-name').textContent = S.name;
  el('hall-label').textContent = `Main Hall ${hallLevel()} · ${playerTiles()}/${territoryLimit()} hexes`;
  el('calendar').textContent = `${cal.season.icon} ${cal.season.name} ${cal.day} · Y${cal.year}`;
  el('builders').textContent = `${buildersBusy()}/${builderCount()}`;
  const unis = universities();
  el('research-chip').textContent = unis.length ? `${unis.filter((b) => b.research).length}/${unis.length}` : '—';
  el('army-cap').textContent = `${totalHousing()}/${armyCap()}`;
  el('fleet-cap').textContent = `${shipCount(allShips())}/${navalCap()}`;
  el('power').textContent = fmt(totalPower());
  el('shield-chip').hidden = S.shield <= 0;
  el('shield-time').textContent = fmtTime(S.shield);
  el('log-dot').hidden = !UI.logUnread;
  if (!API.online) el('sync-label').textContent = 'local';
  // threat alerts
  const threats = S.aiArmies.filter((a) => a.kind === 'raid');
  const pir = S.aiFleets.filter((f) => f.owner === 'pirate' && isSeen(f.at));
  const alerts = threats.map((a) => `<button class="alert" data-action="focus-hex" data-arg="${a.at}">⚠ ${esc(S.kingdoms[a.kid].name)} army → capital · ETA ${fmtTime(etaAi(a))}</button>`)
    .concat(pir.map((p) => `<button class="alert pirate" data-action="focus-hex" data-arg="${p.at}">🏴‍☠️ Pirates sighted</button>`))
    .concat(S.pirateBlockade > 0 ? [`<span class="alert">⚓ Port blockaded ${fmtTime(S.pirateBlockade)}</span>`] : []);
  const html = alerts.join('');
  if (el('alerts').dataset.html !== html) { el('alerts').innerHTML = html; el('alerts').dataset.html = html; }
}

/* ---------- helpers ---------- */
const costHtml = (cost, have) => '<span class="cost">' + Object.entries(cost).filter(([, v]) => v > 0).map(([k, v]) =>
  `<span class="${have && have[k] < v ? 'short' : ''}" title="${RES_META[k].name}">${RES_META[k].icon}${fmt(v)}</span>`).join('') + '</span>';
const statBars = (st) => `
  <div class="stat-bar atk"><span>Attack</span><div class="track"><i style="width:${st.atk}%"></i></div><b>${st.atk}</b></div>
  <div class="stat-bar hp"><span>Health</span><div class="track"><i style="width:${st.hp}%"></i></div><b>${st.hp}</b></div>
  <div class="stat-bar spd"><span>Speed</span><div class="track"><i style="width:${st.spd}%"></i></div><b>${st.spd}</b></div>`;
const btn = (label, action, arg = '', o = {}) =>
  `<button class="btn ${o.cls || ''}" data-action="${action}" data-arg="${esc(arg)}" ${o.disabled ? 'disabled' : ''} ${o.title ? `title="${esc(o.title)}"` : ''} ${o.id ? `id="${o.id}"` : ''}>${label}</button>`;
const progress = (p, cls = '') => `<div class="progress ${cls}"><i style="width:${clamp(p * 100, 0, 100)}%"></i></div>`;
const unitList = (units, table) => Object.entries(units).filter(([k, n]) => n > 0 && table[k]).map(([k, n]) => `<span class="pill" title="${table[k].name}">${table[k].icon} ${n}</span>`).join('') || '<span class="muted small">empty</span>';
const hexName = (i) => `(${WG.col(i)},${WG.row(i)})`;
const pips = (lvl, max) => `<span class="pips">${'●'.repeat(lvl)}${'○'.repeat(max - lvl)}</span>`;
function relationBar(k) {
  const v = k.relation;
  if (k.atWar) return '<span class="rel war">⚔ At war</span>';
  const c = v > 20 ? 'var(--green)' : v < -20 ? 'var(--red)' : 'var(--gold)';
  const label = v > 40 ? 'Friendly' : v > 10 ? 'Cordial' : v > -10 ? 'Neutral' : v > -40 ? 'Hostile' : 'Enemy';
  return `<span class="rel" style="color:${c}">${label} (${Math.round(v)})</span>`;
}
function generalChip(gid) {
  if (!gid) return '<span class="muted small">No general</span>';
  const g = generalData(gid);
  return `<span class="gchip r-${g.rarity}">${g.icon} ${esc(g.name)} ${'★'.repeat(ownedGeneral(gid).stars)}</span>`;
}

/* ---------- panel ---------- */
function renderPanel(force) {
  if (!S) return;
  if (!force && (UI.pointerDown || (document.activeElement && el('panel').contains(document.activeElement) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)))) return;
  const fn = { info: renderInfo, research: renderResearch, army: renderArmy, navy: renderNavy, generals: renderGenerals, shop: renderShop, alliance: renderAlliance, log: renderLog }[UI.tab];
  const html = fn();
  if (html !== UI.lastPanelHtml) {
    const body = el('panel-body'), scroll = body.scrollTop;
    body.innerHTML = html; body.scrollTop = scroll;
    UI.lastPanelHtml = html;
  }
  el('tab-info-label').textContent = UI.view === 'world' ? 'Map' : 'Build';
  el('tab-info-icon').textContent = UI.view === 'world' ? '🧭' : '🏗️';
  UI.panelDirty = false;
}
function renderInfo() {
  if (UI.view === 'world') return renderWorldInfo();
  const b = S.buildings.find((x) => x.id === UI.selected);
  if (b) return renderBuildingInfo(b);
  if (UI.selHex >= 0 && obstacleAt(UI.selHex)) return renderObstacle(UI.selHex);
  return renderBuildList();
}
function renderObstacle(i) {
  const o = obstacleAt(i);
  return `<div class="row"><span class="big-ico">${o === 'tree' ? '🌲' : '🪨'}</span><div><h2>${o === 'tree' ? 'Trees' : 'Rocks'}</h2><div class="muted small">Blocking a building plot</div></div><span class="spacer"></span><button class="icon-btn" data-action="deselect">✕</button></div>
    <p class="small">Clear this hex to free space for building. You'll get ${o === 'tree' ? '🪵60 lumber' : '⛓️40 iron (and maybe a gem)'}.</p>
    ${btn('🪓 Clear for 🪙25', 'clear-obstacle', i, { cls: 'block', disabled: !inLand(i), title: inLand(i) ? '' : 'Outside your land' })}`;
}
function renderBuildList() {
  const hall = S.buildings.find((b) => b.type === 'hall');
  let h = `<h2>Build</h2><p class="muted small">Pick a structure, then click a free hex inside your golden border. Drag the map to look around; scroll to zoom. Click trees/rocks to clear them.</p>
    <div class="card hl"><div class="row"><span class="big-ico">🏰</span><div><b>Main Hall · level ${hall.level}</b><div class="small muted">Land radius ${landRadius()} · storage ${fmt(capOf('gold'))} · ${builderCount()} builders</div></div>
    <span class="spacer"></span>${btn('Open', 'select', hall.id, { cls: 'sm ghost' })}</div>
    ${hall.build > 0 ? `<div style="margin-top:8px">${progress(1 - hall.build / hall.buildTotal)}<div class="small muted">Upgrading… ${fmtTime(hall.build)}</div></div>` : ''}</div>`;
  for (const cat of ['resource', 'defense', 'military', 'naval', 'civic']) {
    const types = BUILD_ORDER.filter((t) => BUILDINGS[t].cat === cat);
    h += `<h3>${CAT_NAMES[cat]}</h3><div class="build-grid">`;
    for (const t of types) {
      const d = BUILDINGS[t], lock = buildLockReason(t), hardLock = d.hall && hallLevel() < d.hall;
      h += `<button class="build-item ${lock ? 'locked' : ''}" data-action="place" data-arg="${t}" data-type="${t}" ${lock ? `title="${esc(lock)}"` : ''}>
        <div class="bi-top"><span class="bi-ico">${d.icon}</span><b>${d.name}</b><span class="count">${countOf(t)}/${limitOf(t)}</span></div>
        ${hardLock ? `<div class="desc">🔒 Main Hall ${d.hall}</div>` : `<div>${costHtml(costFor(t, 1), S.res)}</div>`}
        <div class="desc">${lock && !hardLock ? '⛔ ' + esc(lock) : esc(d.desc)}</div></button>`;
    }
    h += '</div>';
  }
  return h;
}
function hallUnlocks(level) {
  const out = [];
  for (const t of BUILD_ORDER) { const a = limitOf(t, level - 1), bb = limitOf(t, level); if (bb > a) out.push(`${BUILDINGS[t].icon} ${BUILDINGS[t].name} ${a === 0 ? '(new!)' : `${a}→${bb}`}`); }
  return out;
}
function renderBuildingInfo(b) {
  const d = BUILDINGS[b.type], prod = productionOf(b);
  let h = `<div class="row"><span class="big-ico">${d.icon}</span><div><h2>${d.name}</h2><div class="muted small">Level ${b.level} / ${b.type === 'hall' ? MAX_HALL : hallLevel()}</div></div>
    <span class="spacer"></span><button class="icon-btn" data-action="deselect" title="Close">✕</button></div><p class="small muted">${esc(d.desc)}</p>`;
  if (b.build > 0) h += `<div class="card">${progress(1 - b.build / b.buildTotal)}<div class="small" style="margin-top:4px">${b.level === 0 ? 'Constructing' : 'Upgrading to level ' + (b.level + 1)}… <b>${fmtTime(b.build)}</b></div>
    ${S.items.hammer ? `<div style="margin-top:6px">${btn(`🔨 Builder's Hammer (${S.items.hammer})`, 'use-item', 'hammer', { cls: 'sm ghost' })}</div>` : ''}</div>`;
  h += '<dl class="kv">';
  if (prod) h += `<dt>Production</dt><dd>${RES_META[prod[0]].icon} ${(prod[1] * 60 * prodMult(prod[0])).toFixed(0)}/min${b.type !== 'hall' ? ` → ${(productionOf({ ...b, level: b.level + 1 })[1] * 60 * prodMult(prod[0])).toFixed(0)}` : ''}</dd>`;
  if (d.def) h += `<dt>Defense rating</dt><dd>🛡️ ${Math.round(d.def * Math.pow(Math.max(1, b.level), 1.25))}</dd>`;
  if (d.storage) h += `<dt>Storage bonus</dt><dd>+${Math.round(d.storage * b.level * 100)}%</dd>`;
  if (d.trains) h += `<dt>Unit level</dt><dd>${b.level} (+${12 * (b.level - 1)}% stats)</dd>`;
  if (d.builds) h += `<dt>Ship tier</dt><dd>${SHIP_TYPES.filter((t) => SHIPS[t].lvl <= b.level).map((t) => SHIPS[t].icon).join(' ')}</dd>`;
  if (b.type === 'hall') h += `<dt>Storage cap</dt><dd>${fmt(capOf('gold'))} (💎${capOf('diamonds')})</dd><dt>Territory limit</dt><dd>${territoryLimit()} hexes</dd><dt>Army housing</dt><dd>${armyCap()}</dd><dt>Divisions</dt><dd>${divisionLimit()}</dd>`;
  h += '</dl>';
  if (!(b.type === 'hall' && b.level >= MAX_HALL)) {
    const err = upgradeError(b);
    h += `<h3>Upgrade to level ${b.level + 1}</h3><div class="card"><div class="row wrap">${costHtml(costFor(b.type, b.level + 1), S.res)}<span class="small muted">⏱ ${fmtTime(buildTime(b.type, b.level + 1))}</span></div>
      ${b.type === 'hall' ? `<div class="small muted" style="margin-top:6px">Unlocks: ${hallUnlocks(b.level + 1).join(' · ') || 'bigger land'}; land radius ${landRadius()}→${landRadius() + 1}; more storage & builders.</div>` : ''}
      <div style="margin-top:8px">${btn('⬆ Upgrade', 'upgrade', b.id, { disabled: !!err, title: err || '', cls: 'block' })}</div>
      ${err ? `<div class="small muted" style="margin-top:4px">${esc(err)}</div>` : ''}</div>`;
  } else h += '<p class="muted">Maximum level reached. Long live the crown!</p>';
  if (d.trains) { h += '<h3>Training</h3>'; for (const u of d.trains) h += unitRow(u); }
  if (d.builds) { h += '<h3>Shipbuilding</h3>'; for (const t of SHIP_TYPES) h += shipRow(t); }
  if (d.research) h += `<h3>Research</h3>` + uniCard(b) + `<p class="small">${btn('🎓 Open research tree', 'tab', 'research', { cls: 'sm ghost' })}</p>`;
  if (b.type === 'port' && b.level > 0) {
    const sell = (0.5 + 0.1 * b.level + 0.1 * R('trade')).toFixed(2), buy = (2.2 - 0.15 * b.level - 0.1 * R('trade')).toFixed(2);
    h += `<h3>Market</h3><p class="small muted">Sell 200 goods for ${sell}🪙 each · buy 100 goods for ${buy}🪙 each.</p><div class="row wrap">`;
    for (const r of ['lumber', 'iron', 'food']) h += btn(`Sell 200 ${RES_META[r].icon}`, 'trade', 'sell:' + r, { cls: 'sm ghost' }) + btn(`Buy 100 ${RES_META[r].icon}`, 'trade', 'buy:' + r, { cls: 'sm ghost' });
    h += '</div>';
  }
  if (b.type === 'scoutlodge') h += `<p class="small muted">Send scouts from the 🗺️ World map: click any hex, then "Send scouts".</p>`;
  if (b.type !== 'hall') h += `<div style="margin-top:16px">${btn('Demolish', 'demolish', b.id, { cls: 'sm red' })}</div>`;
  return h;
}
function uniCard(b) {
  if (b.level < 1) return '<p class="small muted">Under construction.</p>';
  if (!b.research) return `<div class="card small">🎓 University L${b.level} — <b>idle</b>. Pick a project in the Research tab.</div>`;
  const r = RESEARCH[b.research.id];
  return `<div class="card small">🎓 University L${b.level}: ${r.icon} <b>${r.name} ${R(b.research.id) + 1}</b> ${progress(1 - b.research.left / b.research.total)} <span class="muted">${fmtTime(b.research.left)} left</span></div>`;
}
function unitRow(u) {
  const U = UNITS[u], t = trainerOf(u), st = unitStats(u, null), err = trainError(u), q = t ? t.queue : [];
  const vs = U.vs ? Object.entries(U.vs).map(([k, m]) => `×${m} vs ${(UNITS[k] || { name: 'towers' }).name}`).join(', ') : '';
  return `<div class="card"><div class="unit-row"><span class="unit-ico">${U.icon}</span><div><b>${U.name}</b> <span class="muted">× ${S.army[u]} at home</span>
    <div class="stats-mini">⚔ ${st.atk.toFixed(0)} · ❤ ${st.hp.toFixed(0)} · 💨 ${st.speed.toFixed(2)}${U.housing > 1 ? ' · 🏠' + U.housing : ''} · ⏱${trainTime(u).toFixed(1)}s${vs ? ' · ' + vs : ''}</div>
    <div>${costHtml(U.cost, S.res)}</div></div>
    <div class="row">${btn('+1', 'train', u + ':1', { cls: 'sm', disabled: !!err })}${btn('+5', 'train', u + ':5', { cls: 'sm', disabled: !!err })}</div></div>
    ${err ? `<div class="small muted" style="margin-top:4px">🔒 ${esc(err)}</div>` : ''}
    ${q.length && q.includes(u) ? `<div class="queue">${q.map((x, k) => `<span class="${k === 0 ? 'first' : ''}">${UNITS[x].icon}${k === 0 ? ' ' + fmtTime(t.trainLeft) : ''}</span>`).join('')}<button class="btn sm ghost" data-action="cancel-queue" data-arg="${t.id}" title="Cancel last">✕</button></div>` : ''}</div>`;
}
function shipRow(t) {
  const Sh = SHIPS[t], st = shipStats(t, null), err = shipError(t);
  const yards = S.buildings.filter((b) => b.type === 'shipyard' && b.queue.length);
  return `<div class="card"><div class="unit-row"><span class="unit-ico">${Sh.icon}</span><div><b>${Sh.name}</b> <span class="muted">× ${S.harbor[t]} in harbour</span>
    <div class="stats-mini">⚔ ${st.atk.toFixed(0)} · ❤ ${st.hp.toFixed(0)} · 💨 ${st.speed.toFixed(2)}${Sh.cap ? ' · 🚣 carries ' + Sh.cap : ''} · ⏱${shipTime(t).toFixed(0)}s</div>
    <div class="stats-mini">${Sh.desc}</div><div>${costHtml(shipCost(t), S.res)}</div></div>
    <div class="row">${btn('+1', 'build-ship', t + ':1', { cls: 'sm', disabled: !!err })}</div></div>
    ${err ? `<div class="small muted" style="margin-top:4px">🔒 ${esc(err)}</div>` : ''}
    ${yards.some((b) => b.queue.includes(t)) ? `<div class="queue">${yards.map((b) => b.queue.map((x, k) => `<span class="${k === 0 ? 'first' : ''}">${SHIPS[x].icon}${k === 0 ? ' ' + fmtTime(b.trainLeft) : ''}</span>`).join('') + `<button class="btn sm ghost" data-action="cancel-queue" data-arg="${b.id}">✕</button>`).join('')}</div>` : ''}</div>`;
}

/* ---------- Research tab ---------- */
function renderResearch() {
  const unis = S.buildings.filter((b) => b.type === 'university');
  let h = `<h2>Research</h2><p class="small muted">Universities study one technology at a time. Build more universities to research in parallel; upgrade them to unlock advanced tiers and study faster.</p>`;
  if (!unis.length) h += `<div class="card">🎓 You have no University yet. ${hallLevel() >= 2 ? btn('Build one', 'place', 'university', { cls: 'sm' }) : 'Reach <b>Main Hall 2</b> to build one.'}</div>`;
  else h += unis.map(uniCard).join('');
  for (const [cat, label] of Object.entries(RESEARCH_CATS)) {
    h += `<h3>${label}</h3>`;
    for (const [id, r] of Object.entries(RESEARCH)) {
      if (r.cat !== cat) continue;
      const lvl = R(id), err = researchError(id), maxed = lvl >= r.max, active = inProgress(id);
      h += `<div class="card research ${maxed ? 'done' : ''}"><div class="row"><span class="big-ico sm">${r.icon}</span><div style="flex:1"><b>${r.name}</b> ${pips(lvl, r.max)}
        <div class="small">${lvl ? `Now: ${r.desc(lvl)}` : '<span class="muted">Not researched</span>'}${!maxed ? ` → <b>${r.desc(lvl + 1)}</b>` : ''}</div>
        ${!maxed ? `<div class="row wrap small">${costHtml(researchCost(id, lvl + 1), S.res)}<span class="muted">⏱ ${fmtTime(researchTime(id, lvl + 1, freeUniversity(r.uni) || universities()[0]))}</span><span class="muted">🎓 L${r.uni}${r.req ? ' · needs ' + r.req.map((q) => RESEARCH[q].name).join(', ') : ''}</span></div>` : ''}</div>
        ${maxed ? '<span class="tag">✓</span>' : active ? '<span class="tag">⏳</span>' : btn('Study', 'research', id, { cls: 'sm', disabled: !!err, title: err || '' })}</div></div>`;
    }
  }
  return h;
}

/* ---------- Army tab ---------- */
function divisionCard(d) {
  const eta = etaOf(d), where = d.at === S.world.capital && !d.path.length ? 'At the capital' : `${d.path.length ? 'Marching' : 'Stationed'} at ${hexName(d.at)}`;
  return `<div class="card ${UI.selEntity && UI.selEntity.id === d.id ? 'hl' : ''}"><div class="row"><span class="swatch" style="background:${d.color}"></span><b>${esc(d.name)}</b><span class="spacer"></span><span class="small muted">⚡${fmt(armyPower(d.units, d.general))}</span></div>
    <div class="pills">${unitList(d.units, UNITS)}</div>
    <div class="small">${generalChip(d.general)} · ${where}${d.path.length ? ` · ${d.order ? d.order.type : 'move'} · ETA ${fmtTime(eta)}` : ''}${d.status === 'fighting' ? ' · ⚔ fighting' : ''}</div>
    <div class="row wrap" style="margin-top:6px">${btn('🗺️ Select', 'select-entity', 'division:' + d.id, { cls: 'sm' })}
      ${atHome(d) ? btn('➕ Reinforce', 'reinforce', d.id, { cls: 'sm ghost' }) + btn('Disband', 'disband', d.id, { cls: 'sm ghost' }) : btn('🏠 Return', 'return', 'division:' + d.id, { cls: 'sm ghost' })}
      ${btn('✏️', 'rename-entity', 'division:' + d.id, { cls: 'sm ghost', title: 'Rename' })}</div></div>`;
}
function renderArmy() {
  const gp = armyPower(S.army, S.castellan);
  let h = `<h2>Army</h2><dl class="kv"><dt>Housing (all troops + queue)</dt><dd>${totalHousing()} / ${armyCap()}</dd><dt>Garrison power</dt><dd>⚡ ${fmt(gp)}</dd>
    <dt>Defense rating</dt><dd>🛡️ ${fmt(defenseRating())}</dd><dt>Food upkeep</dt><dd>🌾 ${(upkeep().food * 60).toFixed(1)}/min</dd><dt>Castellan</dt><dd>${generalChip(S.castellan)}</dd></dl>
    <h3>Garrison (at the capital)</h3><div class="pills">${unitList(S.army, UNITS)}</div>
    <h3>Divisions · ${S.divisions.length}/${divisionLimit()}</h3>
    <p class="small muted">Group troops into divisions, give each a general, then command them on the 🗺️ World map: move, attack, explore ruins, capture forts, claim land and intercept raiders.</p>`;
  h += S.divisions.map(divisionCard).join('') || '<p class="small muted">No divisions in the field.</p>';
  h += `<div class="row">${btn('⚔️ Muster a new division', 'muster', '', { disabled: S.divisions.length >= divisionLimit() })}</div>`;
  if (S.boosts.warhorn || S.boosts.salve) h += `<p class="small">Next battle: ${S.boosts.warhorn ? '📯 War Horn ' : ''}${S.boosts.salve ? '🧪 Healing Salve' : ''}</p>`;
  h += '<h3>Train troops</h3>';
  for (const u of Object.keys(UNITS)) h += unitRow(u);
  return h;
}

/* ---------- Navy tab ---------- */
function fleetCard(f) {
  const where = fleetHome(f) ? 'In the home harbour' : `${f.path.length ? 'Sailing' : 'Anchored'} at ${hexName(f.at)}`;
  return `<div class="card ${UI.selEntity && UI.selEntity.id === f.id ? 'hl' : ''}"><div class="row"><span>⚓</span><b>${esc(f.name)}</b><span class="spacer"></span><span class="small muted">⚡${fmt(fleetPower(f.ships, f.general))} · 💨${fleetSpeed(f).toFixed(2)}</span></div>
    <div class="pills">${unitList(f.ships, SHIPS)}</div>
    <div class="small">${generalChip(f.general)} · ${where}${f.path.length ? ` · ETA ${fmtTime(etaOf(f))}` : ''}${f.status === 'fighting' ? ' · ⚔ fighting' : ''}</div>
    <div class="row wrap" style="margin-top:6px">${btn('🗺️ Select', 'select-entity', 'fleet:' + f.id, { cls: 'sm' })}
      ${fleetHome(f) ? btn('Disband', 'disband-fleet', f.id, { cls: 'sm ghost' }) : btn('🏠 Return', 'return', 'fleet:' + f.id, { cls: 'sm ghost' })}
      ${btn('✏️', 'rename-entity', 'fleet:' + f.id, { cls: 'sm ghost', title: 'Rename' })}</div></div>`;
}
function renderNavy() {
  let h = `<h2>Navy</h2><dl class="kv"><dt>Ships (all) / capacity</dt><dd>${shipCount(allShips())} + ${queuedShips()} queued / ${navalCap()}</dd><dt>Troop transport capacity</dt><dd>🚣 ${transportCapacity()}</dd>
    <dt>Ship upkeep</dt><dd>🪙 ${(upkeep().gold * 60).toFixed(1)}/min</dd>${S.winds > 0 ? `<dt>Favourable winds</dt><dd>🌬️ ${fmtTime(S.winds)}</dd>` : ''}</dl>
    <h3>Home harbour</h3><div class="pills">${unitList(S.harbor, SHIPS)}</div><p class="small muted">Ships in harbour defend your port from pirates.</p>
    <h3>Fleets · ${S.fleets.length}/${fleetLimit()}</h3>
    <p class="small muted">Group ships into fleets and sail them on the World map: explore, salvage shipwrecks, burn pirate coves, blockade enemy ports and hunt enemy fleets. Cogs & Galleons carry divisions across the sea automatically.</p>`;
  h += S.fleets.map(fleetCard).join('') || '<p class="small muted">No fleets at sea.</p>';
  h += `<div class="row">${btn('⚓ Form a new fleet', 'form-fleet', '', { disabled: S.fleets.length >= fleetLimit() || shipCount(S.harbor) === 0, title: shipCount(S.harbor) ? '' : 'Build ships first' })}</div><h3>Shipyard</h3>`;
  if (!countOf('shipyard')) h += `<div class="card small">🚢 No shipyard yet. ${hallLevel() >= 2 ? btn('Build one on the coast', 'place', 'shipyard', { cls: 'sm' }) : 'Reach <b>Main Hall 2</b>, then build one on the coast.'}</div>`;
  for (const t of SHIP_TYPES) h += shipRow(t);
  return h;
}

/* ---------- Generals tab ---------- */
function renderGenerals() {
  let h = `<h2>Generals</h2><p class="small muted">Assign generals to posts: each <b>division</b> or <b>fleet</b> can have one commander, and the <b>Castellan</b> leads your home garrison. Their Attack / Health / Speed boost the troops they lead; specialists add +15% to their unit type. Duplicates from Mystery Boxes add stars (+10% stats each).</p>
    <h3>Roster · ${S.generals.length}/${GENERALS.length} discovered</h3>`;
  const order = ['legendary', 'epic', 'rare', 'common'];
  const owned = [...S.generals].sort((a, b) => order.indexOf(generalData(a.id).rarity) - order.indexOf(generalData(b.id).rarity));
  const posts = [['none', '', 'Idle'], ['castellan', '', '🏰 Castellan']].concat(S.divisions.map((d) => ['division', d.id, '⚔️ ' + d.name])).concat(S.fleets.map((f) => ['fleet', f.id, '⚓ ' + f.name]));
  for (const og of owned) {
    const g = generalData(og.id), st = generalStats(og.id), post = generalPost(og.id);
    const cur = post.kind === 'none' ? 'none:' : post.kind === 'castellan' ? 'castellan:' : `${post.kind}:${post.id}`;
    h += `<div class="card general-card"><div class="general"><div class="portrait r-${g.rarity}">${g.icon}</div><div>
      <div class="rarity r-${g.rarity}">${RARITY[g.rarity].name}${g.spec ? ` · ${g.spec === 'fleet' ? '⚓ Admiral' : UNITS[g.spec].icon + ' ' + UNITS[g.spec].name + ' specialist'}` : ''}</div>
      <b>${g.name}</b> <span class="stars">${'★'.repeat(og.stars)}${'☆'.repeat(5 - og.stars)}</span>${statBars(st)}</div></div>
      <div class="row" style="margin-top:6px"><span class="small muted">Post</span><select data-assign="${og.id}">${posts.map(([k, id, label]) => `<option value="${k}:${id}" ${cur === `${k}:${id}` ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div></div>`;
  }
  for (let i = S.generals.length; i < GENERALS.length; i++) h += `<div class="card locked-general"><div class="portrait">❔</div><span class="small muted">Undiscovered — find in Mystery Boxes, ruins or pirate coves</span></div>`;
  h += '<h3>Items</h3>';
  for (const [k, it] of Object.entries(ITEMS)) {
    h += `<div class="card"><div class="row"><span class="big-ico sm">${it.icon}</span><div><b>${it.name}</b> <span class="muted">× ${S.items[k]}</span><div class="small muted">${it.desc}</div></div><span class="spacer"></span>
      ${btn('Use', 'use-item', k, { cls: 'sm', disabled: !S.items[k] || S.boosts[k] })}</div></div>`;
  }
  return h;
}

/* ---------- Shop tab ---------- */
function renderShop() {
  let h = `<h2>Mystery Boxes</h2><p class="small muted">Spend coins for a chance at rare generals, bundles of resources, or special items.</p>`;
  for (const b of BOXES) {
    h += `<div class="card"><div class="box-card"><div class="box-art" style="--glow:${b.glow}">${b.icon}</div><div><b>${b.name}</b>
      <div class="odds">${Object.entries(b.kinds).map(([k, v]) => `<span class="muted">${{ res: 'Resources', item: 'Item', general: 'General' }[k]} ${v}%</span>`).join('')}</div>
      <div class="odds">${Object.entries(b.rarity).filter(([, v]) => v).map(([r, v]) => `<span class="r-${r}">${RARITY[r].name} ${v}%</span>`).join('')}</div>
      <div class="row">${costHtml(b.cost, S.res)}<span class="spacer"></span>${btn('Open', 'open-box', b.id, { disabled: !canAfford(b.cost) })}</div></div></div></div>`;
  }
  return h + `<p class="small muted">Boxes opened: ${S.stats.boxesOpened}</p>`;
}

/* ---------- World (Map) panel ---------- */
function ordersFor(e, i) {
  if (i < 0) return [];
  const o = [], f = S.world.feat[i], owner = S.world.owner[i], seen = isSeen(i);
  if (isFleet(e)) {
    if (isWater(i)) o.push(['move', '⛵ Sail here']);
    if (f && f.type === 'wreck' && !f.salvaged && seen) o.push(['salvage', '⚓ Salvage wreck']);
    if (f && f.type === 'cove' && !f.destroyed && seen) o.push(['cove', '🏴‍☠️ Attack pirate cove']);
    const k = owner >= 0 ? S.kingdoms[owner] : null;
    if (k && k.coastal && seen && !(S.allianceId && k.allianceId === S.allianceId)) o.push(['blockade', `⚓ Blockade ${k.name}`]);
    const ef = S.aiFleets.find((x) => x.at === i && aiFleetHostile(x) && seen);
    if (ef) o.push(['hunt', `🎯 Hunt ${ef.owner === 'pirate' ? 'pirates' : 'enemy fleet'}`]);
  } else {
    if (isPassable(i) || (isWater(i) && canEmbark(e))) o.push(['move', '🚶 March here']);
    if (owner >= 0 && seen && !(S.allianceId && S.kingdoms[owner].allianceId === S.allianceId)) o.push(['attack', i === S.kingdoms[owner].capital ? `⚔️ Assault ${S.kingdoms[owner].name}` : '🏳️ Invade this hex']);
    if (f && seen && ((f.type === 'ruins' && !f.looted) || (f.type === 'cave' && !f.explored))) o.push(['explore', f.type === 'ruins' ? '🏛️ Explore ruins' : '🕳️ Explore cave']);
    if (f && f.type === 'fort' && !f.captured && seen) o.push(['capture', '🏯 Capture fort']);
    if (owner === -1 && seen && isPassable(i) && !(f && ['fort', 'ruins'].includes(f.type) && !(f.looted || f.captured))) o.push(['claim', '🏳️ March & claim']);
    const ea = S.aiArmies.find((x) => x.at === i && (x.kind === 'raid' || hostileToPlayer(S.kingdoms[x.kid])) && seen);
    if (ea) o.push(['intercept', '🛡️ Intercept army']);
  }
  return o;
}
function renderEntityCard(e) {
  const fleet = isFleet(e);
  let h = fleet ? fleetCard(e) : divisionCard(e);
  const i = UI.worldSel;
  const orders = ordersFor(e, i);
  h += `<h3>Orders ${i >= 0 ? 'for ' + hexName(i) : ''}</h3>`;
  if (i < 0) h += '<p class="small muted">Click a hex on the map to choose a destination or target. Right-click a hex to issue the default order instantly.</p>';
  else if (!orders.length) h += `<p class="small muted">${fleet ? 'Fleets can only sail on water.' : 'Your division cannot go there (mountains, or sea without transport ships).'}</p>`;
  else h += `<div class="orders">${orders.map(([k, label]) => btn(label, 'order', k, { cls: k === 'move' ? 'ghost' : k === 'attack' || k === 'hunt' || k === 'blockade' ? 'red' : '' })).join('')}</div>`;
  if (!fleet && i >= 0 && isWater(i) && !canEmbark(e)) h += `<p class="small muted">🚣 Transport capacity ${transportCapacity()} &lt; ${armyHousing(e.units)} troops — build Cogs to cross water.</p>`;
  h += `<div class="row" style="margin-top:8px">${btn('Deselect', 'deselect-entity', '', { cls: 'sm ghost' })}${btn('🎯 Center', 'focus-entity', '', { cls: 'sm ghost' })}</div>`;
  return h;
}
function renderWorldInfo() {
  const i = UI.worldSel, e = selectedEntity();
  let h = '';
  if (e) h += renderEntityCard(e);
  if (i < 0 && !e) {
    const tb = territoryBonus();
    h += `<h2>World Map</h2><p class="small muted">Drag to pan, scroll or pinch to zoom, and use the minimap to jump around. Click a hex to inspect it, and click one of your banners or ships to command it.</p>
      <dl class="kv"><dt>Territory</dt><dd>${playerTiles()} / ${territoryLimit()} hexes</dd><dt>Scouts at home</dt><dd>🔭 ${S.army.scout}</dd><dt>Divisions / fleets</dt><dd>${S.divisions.length} / ${S.fleets.length}</dd>
      <dt>Land bonus</dt><dd>${RES.filter((k) => tb[k] > 0).map((k) => `${RES_META[k].icon}+${(tb[k] * 60).toFixed(k === 'diamonds' ? 1 : 0)}/m`).join(' ') || 'none'}</dd></dl>`;
    if (S.divisions.length || S.fleets.length) h += '<h3>Your forces</h3>' + S.divisions.map((d) => `<div class="member clickable" data-action="select-entity" data-arg="division:${d.id}"><span class="swatch" style="background:${d.color}"></span><b>${esc(d.name)}</b><span class="spacer"></span><span class="small muted">${armyHousing(d.units)} troops · ${d.path.length ? 'moving' : hexName(d.at)}</span></div>`).join('')
      + S.fleets.map((f) => `<div class="member clickable" data-action="select-entity" data-arg="fleet:${f.id}"><span>⚓</span><b>${esc(f.name)}</b><span class="spacer"></span><span class="small muted">${shipCount(f.ships)} ships · ${f.path.length ? 'sailing' : hexName(f.at)}</span></div>`).join('');
  } else if (i >= 0) h += hexCard(i);
  if (S.missions.length) h += '<h3>Scout missions</h3>' + S.missions.map((m) => `<div class="card small">🔭 ${m.n} → ${hexName(m.hex)} ${progress(1 - m.left / m.total)} ${fmtTime(m.left)}</div>`).join('');
  h += '<h3>Known kingdoms</h3>';
  const known = S.kingdoms.filter((k) => isSeen(k.capital));
  h += known.map((k) => { const a = allianceOf(k.allianceId); return `<div class="member clickable" data-action="focus-kingdom" data-arg="${k.id}"><span class="dot" style="background:${k.color}"></span><div><b>${k.name}</b><div class="small muted">Keep ${k.hall} · ${kingdomTiles(k.id)} hexes${a ? ' · ' + a.emblem + ' ' + esc(a.name) : ''}</div></div><span class="spacer"></span><span class="small">${relationBar(k)}</span></div>`; }).join('') || '<p class="small muted">None yet — scout into the fog.</p>';
  return h;
}
function hexCard(i) {
  const { terrain, owner, feat } = S.world, seen = isSeen(i), ter = TERRAIN[terrain[i]], o = owner[i], f = feat[i];
  let h = `<div class="row"><h2>${seen ? ter.name : 'Unexplored'}</h2><span class="muted small">${hexName(i)}</span><span class="spacer"></span><button class="icon-btn" data-action="world-deselect">✕</button></div>`;
  if (seen) {
    h += `<p class="small">${ter.bonus ? 'Holding it gives ' + Object.entries(ter.bonus).map(([k, v]) => `${RES_META[k].icon}+${(v * 60).toFixed(0)}/min`).join(' ') + '. ' : ''}${isFinite(ter.cost) && terrain[i] !== T.WATER ? `Movement cost ×${ter.cost}.` : terrain[i] === T.MOUNTAIN ? 'Impassable to armies.' : 'Ships sail here; divisions need transports.'}</p>`;
    if (f) {
      const F = FEATURES[f.type];
      let state = '';
      if (f.type === 'cave') state = f.explored ? `Contains <b>${MINERALS[f.mineral].icon} ${MINERALS[f.mineral].name}</b> — hold this hex for ${Object.entries(MINERALS[f.mineral].bonus).map(([k, v]) => `${RES_META[k].icon}+${(v * 60).toFixed(1)}/min`).join('')}.` : 'Unexplored — minerals unknown.';
      if (f.type === 'ruins') state = f.looted ? 'Already plundered.' : `Danger tier ${f.tier} · guards ⚡~${f.guard}.`;
      if (f.type === 'fort') state = f.captured ? 'Your outpost.' : `Tier ${f.tier} · defenders ⚡~${f.guard}.`;
      if (f.type === 'wreck') state = f.salvaged ? 'Salvaged.' : `Tier ${f.tier} cargo.`;
      if (f.type === 'cove') state = f.destroyed ? 'Burned to the waterline.' : `Pirate strength ⚡~${f.power}.`;
      h += `<div class="card"><b>${F.icon} ${F.name}</b><div class="small">${state}</div><div class="small muted">${F.desc}</div></div>`;
    }
    if (o === -2) h += `<p class="card small">🏳️ Your territory${i === S.world.capital ? ' — the capital' : ''}.</p>`;
    if (o === -1 && terrain[i] !== T.WATER && terrain[i] !== T.MOUNTAIN) {
      const err = claimError(i);
      h += `<div class="card"><b>Neutral land</b><div class="row" style="margin-top:6px">${costHtml(claimCost(), S.res)}<span class="spacer"></span>${btn('🏳️ Claim', 'claim', i, { disabled: !!err, title: err || '' })}</div>${err ? `<div class="small muted">${esc(err)}</div>` : ''}</div>`;
    }
    if (o >= 0) h += kingdomCard(S.kingdoms[o]);
    const here = S.aiArmies.filter((a) => a.at === i).concat(S.aiFleets.filter((f2) => f2.at === i));
    for (const x of here) h += `<div class="card small">${x.ships ? `⛵ ${x.owner === 'pirate' ? 'Pirate fleet' : S.kingdoms[x.owner].name + ' fleet'} — ${shipCount(x.ships)} ships` : `⚔️ ${S.kingdoms[x.kid].name} army (${x.kind === 'raid' ? 'raiding you!' : x.kind === 'war' ? 'at war' : 'returning'}) — ${armyHousing(x.units)} troops`}</div>`;
  }
  const n = S.army.scout;
  h += `<h3>Scouting</h3><div class="card"><div class="row"><span>Send</span><select id="scout-count" style="width:70px">${Array.from({ length: Math.max(1, n) }, (_, k) => `<option>${k + 1}</option>`).join('')}</select><span class="small">of ${n} scouts</span><span class="spacer"></span>
    ${btn('🔭 Send', 'scout', i, { disabled: n < 1, title: n ? '' : 'Train scouts at the Scout Lodge' })}</div><div class="small muted" style="margin-top:4px">Travel ≈ ${fmtTime(scoutTime(i, 1))} · reveals the area, explores caves, gathers intel.</div></div>`;
  const forces = S.divisions.concat(S.fleets).filter((e) => ordersFor(e, i).length);
  if (forces.length && !selectedEntity()) h += '<h3>Send forces</h3>' + forces.map((e) => `<div class="member clickable" data-action="select-entity" data-arg="${isFleet(e) ? 'fleet' : 'division'}:${e.id}">${isFleet(e) ? '⚓' : `<span class="swatch" style="background:${e.color}"></span>`}<b>${esc(e.name)}</b><span class="spacer"></span><span class="small muted">select →</span></div>`).join('');
  return h;
}
function kingdomCard(k) {
  const intel = S.intel[k.id], a = allianceOf(k.allianceId), allied = S.allianceId && k.allianceId === S.allianceId;
  let h = `<div class="card hl"><div class="row"><span class="dot" style="background:${k.color};width:16px;height:16px"></span><div><b>${k.name}</b><div class="small muted">${k.ruler} · ${PERSONALITIES[k.personality].name}${k.coastal ? ' · coastal' : ''}</div></div></div>
    <dl class="kv" style="margin-top:8px"><dt>Relation</dt><dd>${relationBar(k)}</dd><dt>Alliance</dt><dd>${a ? a.emblem + ' ' + esc(a.name) : '—'}</dd>
    ${k.treaty > 0 ? `<dt>Treaty</dt><dd>🕊️ ${fmtTime(k.treaty)}</dd>` : ''}${k.tradePact ? '<dt>Trade pact</dt><dd>⚖️ +5% gold</dd>' : ''}`;
  if (intel) h += `<dt>Keep level</dt><dd>${intel.hall}</dd><dt>Army (est.)</dt><dd>⚡ ~${fmt(intel.power)}</dd><dt>Defenses (est.)</dt><dd>🛡️ ~${fmt(intel.defense)}</dd>${k.coastal ? `<dt>Navy (est.)</dt><dd>⚓ ~${fmt(intel.navy)}</dd>` : ''}<dt>Treasury</dt><dd>🪙${fmt(intel.res.gold)} 🪵${fmt(intel.res.lumber)}</dd><dt>Intel age</dt><dd>${fmtTime(S.time - intel.t)}</dd>`;
  else h += '<dt>Intel</dt><dd class="muted">Unknown — send scouts</dd>';
  h += `</dl><h3>Diplomacy</h3><div class="row wrap">${btn('🎁 Gift 🪙200', 'diplo', 'gift:' + k.id, { cls: 'ghost sm' })}
    ${k.atWar ? btn(`🕊️ Make peace 🪙${400 * k.hall}`, 'diplo', 'peace:' + k.id, { cls: 'sm' }) : btn('🕊️ Treaty 🪙400', 'diplo', 'treaty:' + k.id, { cls: 'ghost sm', title: 'Non-aggression for 20 min (relation 10+)' })}
    ${btn(k.tradePact ? '⚖️ End pact' : '⚖️ Trade pact', 'diplo', 'pact:' + k.id, { cls: 'ghost sm', title: 'Relation 35+: +5% gold' })}
    ${btn('💰 Demand tribute', 'diplo', 'tribute:' + k.id, { cls: 'ghost sm' })}
    ${!k.atWar && !allied ? btn('⚔️ Declare war', 'diplo', 'war:' + k.id, { cls: 'red sm' }) : ''}
    ${S.allianceId && allianceOf(S.allianceId).leader === 'P' && !allied ? btn('🤝 Invite', 'invite', k.id, { cls: 'blue sm' }) : ''}</div>
    <p class="small muted" style="margin-top:6px">To attack: select a division on the map, click their capital and choose <b>Assault</b>. Coastal kingdoms can be blockaded by fleets.</p></div>`;
  return h;
}

/* ---------- Alliance tab ---------- */
let leaderboardCache = { t: 0, data: null };
function renderAlliance() {
  const a = allianceOf(S.allianceId);
  let h = '';
  if (a) {
    const bonus = allianceBonus(), leader = a.leader === 'P';
    h += `<div class="row"><div class="emblem" style="background:${a.color}">${a.emblem}</div><div><h2>${esc(a.name)}</h2><div class="small muted">Level ${a.level} · ${a.members.length} members · ${a.open ? 'Open' : 'Invite only'}</div></div></div>
      <div style="margin:8px 0">${progress(a.level >= 10 ? 1 : a.xp / xpNeed(a.level))}<div class="small muted">${a.level >= 10 ? 'Max level' : `${fmt(a.xp)} / ${fmt(xpNeed(a.level))} XP`}</div></div>
      <div class="card"><b class="small">Shared bonuses</b><div class="small">🌾 +${Math.round(bonus.prod * 100)}% production · ⚔ +${Math.round(bonus.atk * 100)}% attack · 🛡 +${Math.round(bonus.def * 100)}% defense · ⏱ +${Math.round(bonus.train * 100)}% training</div>
      <div class="small muted">Allies never raid you and send reinforcements to defend your capital.</div></div><h3>Members</h3><div class="card">`;
    for (const m of a.members) {
      const k = m === 'P' ? null : S.kingdoms[m];
      h += `<div class="member"><span class="dot" style="background:${memberColor(m)}"></span><div><b>${esc(memberName(m))}</b> ${a.leader === m ? '👑' : ''}<div class="small muted">⚡ ${fmt(k ? k.power + k.defense : totalPower())}</div></div><span class="spacer"></span>${leader && m !== 'P' ? btn('Kick', 'kick', m, { cls: 'sm ghost' }) : ''}</div>`;
    }
    h += '</div>';
    if (leader) {
      const cands = S.kingdoms.filter((k) => k.allianceId !== a.id);
      h += `<h3>Manage</h3><div class="row wrap">${btn(a.open ? '🔓 Open recruitment' : '🔒 Invite only', 'toggle-open', '', { cls: 'sm ghost' })}</div>
        <div class="card" style="margin-top:8px"><b class="small">Invite kingdoms</b>` + (cands.map((k) => `<div class="member"><span class="dot" style="background:${k.color}"></span><div class="small"><b>${k.name}</b><div>${relationBar(k)}${k.allianceId ? ' · in ' + esc(allianceOf(k.allianceId).name) : ''}</div></div><span class="spacer"></span>${btn('Invite', 'invite', k.id, { cls: 'sm blue' })}</div>`).join('') || '<div class="small muted">Every kingdom has joined you!</div>') + '</div>';
    }
    h += `<h3>Donate</h3><div class="row wrap">${[['gold', 250], ['lumber', 250], ['iron', 150], ['food', 250], ['diamonds', 5]].map(([r, v]) => btn(`${RES_META[r].icon}${v}`, 'donate', `${r}:${v}`, { cls: 'sm ghost', disabled: S.res[r] < v })).join('')}</div>
      <h3>Alliance chat</h3><div class="chat" id="chat">${a.chat.slice(-30).map((c) => `<div><b style="color:${memberColor(c.who)}">${esc(c.who === 'P' ? S.name : S.kingdoms[c.who].name)}:</b> ${esc(c.text)}</div>`).join('') || '<span class="muted">No messages yet.</span>'}</div>
      <div class="row" style="margin-top:6px"><input type="text" id="chat-input" placeholder="Message your allies…" maxlength="140" />${btn('Send', 'chat-send', '', { cls: 'sm' })}</div>
      <div style="margin-top:14px">${btn('Leave alliance', 'leave', '', { cls: 'sm red' })}</div>`;
  } else {
    const d = UI.allianceDraft || (UI.allianceDraft = { name: '', color: ALLIANCE_COLORS[0], emblem: ALLIANCE_EMBLEMS[0] });
    h += `<h2>Alliances</h2><p class="small muted">Band together for shared production, attack, defense and training bonuses. Allies never raid you and reinforce you when attacked.</p>`;
    for (const x of S.alliances) {
      const can = hallLevel() >= x.minHall;
      h += `<div class="card"><div class="row"><div class="emblem" style="background:${x.color}">${x.emblem}</div><div><b>${esc(x.name)}</b><div class="small muted">Lvl ${x.level} · ${x.members.length} members · ${x.open ? 'Open' : 'Invite only'} · Hall ${x.minHall}+</div>
        <div class="small">${x.members.map((m) => `<span class="dot" style="background:${memberColor(m)};width:8px;height:8px"></span> ${esc(memberName(m))}`).join(' ')}</div></div><span class="spacer"></span>
        ${btn(x.open ? 'Join' : 'Request', 'join', x.id, { cls: 'sm', disabled: !can, title: can ? '' : `Requires Main Hall ${x.minHall}` })}</div></div>`;
    }
    h += `<h3>Found your own</h3><div class="card"><input type="text" id="alliance-name" placeholder="Alliance name" maxlength="28" value="${esc(d.name)}" />
      <div class="row" style="margin-top:8px"><span class="small muted">Emblem</span><div class="swatches">${ALLIANCE_EMBLEMS.map((e) => `<button class="${e === d.emblem ? 'sel' : ''}" style="background:#262d3b" data-action="emblem" data-arg="${e}">${e}</button>`).join('')}</div></div>
      <div class="row" style="margin-top:8px"><span class="small muted">Colour</span><div class="swatches">${ALLIANCE_COLORS.map((c) => `<button class="${c === d.color ? 'sel' : ''}" style="background:${c}" data-action="color" data-arg="${c}"></button>`).join('')}</div></div>
      <div class="row" style="margin-top:10px">${costHtml({ gold: 1000 }, S.res)}<span class="spacer"></span>${btn('Found alliance', 'create-alliance', '', { disabled: S.res.gold < 1000 })}</div></div>`;
  }
  const rows = [{ name: S.name + ' (you)', power: totalPower(), color: '#f2c14e', you: true }]
    .concat(S.kingdoms.map((k) => ({ name: isSeen(k.capital) ? k.name : '??? (unscouted)', power: k.power + k.defense + k.navy, color: k.color }))).sort((x, y) => y.power - x.power);
  h += '<h3>Realm ranking</h3><div class="card">' + rows.map((r, n) => `<div class="member"><b style="width:20px">${n + 1}</b><span class="dot" style="background:${r.color}"></span><span ${r.you ? 'style="color:var(--gold);font-weight:700"' : ''}>${esc(r.name)}</span><span class="spacer"></span><span class="small">⚡ ${fmt(r.power)}</span></div>`).join('') + '</div>';
  if (API.online) {
    if (Date.now() - leaderboardCache.t > 30000) { leaderboardCache.t = Date.now(); API.leaderboard().then((d) => { leaderboardCache.data = d; UI.panelDirty = true; }); }
    const lb = leaderboardCache.data;
    h += '<h3>Global ranking (server)</h3><div class="card">' + (lb && lb.length ? lb.map((p, n) => `<div class="member"><b style="width:20px">${n + 1}</b><span>${esc(p.name)}</span><span class="spacer"></span><span class="small">Hall ${p.hall} · ⚡ ${fmt(p.power)}</span></div>`).join('') : '<span class="small muted">Loading…</span>') + '</div>';
  }
  return h;
}

/* ---------- Log tab ---------- */
function renderLog() {
  UI.logUnread = false;
  const st = S.stats;
  return `<h2>Chronicle</h2><dl class="kv" style="margin-bottom:10px">
    <dt>Land battles won / lost</dt><dd>${st.battlesWon} / ${st.battlesLost}</dd><dt>Sea battles won / lost</dt><dd>${st.navalWon} / ${st.navalLost}</dd>
    <dt>Raids repelled / suffered</dt><dd>${st.raidsRepelled} / ${st.raidsLost}</dd><dt>Ruins explored · wrecks salvaged</dt><dd>${st.ruinsExplored} · ${st.wrecksSalvaged}</dd>
    <dt>Scouting missions · technologies</dt><dd>${st.scouted} · ${st.researched}</dd></dl>` +
    S.log.map((l) => `<div class="log-item ${l.kind}"><time>${fmtTime(l.t)}</time><span>${esc(l.text)}</span></div>`).join('');
}
