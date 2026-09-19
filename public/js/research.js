/* ==========================================================================
   Research: universities study technologies one project each.
   ========================================================================== */
'use strict';

const researchCost = (id, lvl) => scaleCost(RESEARCH[id].base, Math.pow(1.8, lvl - 1));
function researchTime(id, lvl, uni) { return Math.round(RESEARCH[id].time * Math.pow(lvl, 1.3) / (1 + 0.15 * ((uni ? uni.level : 1) - 1))); }
const universities = () => S.buildings.filter((b) => b.type === 'university' && b.level > 0);
const inProgress = (id) => S.buildings.some((b) => b.research && b.research.id === id);
function freeUniversity(minLevel) {
  return universities().filter((b) => !b.research && b.build <= 0 && b.level >= minLevel).sort((a, b) => b.level - a.level)[0];
}
function researchError(id) {
  const r = RESEARCH[id], lvl = R(id);
  if (lvl >= r.max) return 'Fully researched';
  if (inProgress(id)) return 'Already being researched';
  if (!universities().length) return 'Build a University first (Main Hall 2)';
  if (r.hall && hallLevel() < r.hall) return `Requires Main Hall ${r.hall}`;
  if (!universities().some((b) => b.level >= r.uni)) return `Requires a level ${r.uni} University`;
  for (const q of r.req || []) if (!R(q)) return `Requires ${RESEARCH[q].name}`;
  if (!freeUniversity(r.uni)) return 'All universities are busy';
  if (!canAfford(researchCost(id, lvl + 1))) return 'Not enough resources';
  return null;
}
function startResearch(id) {
  const err = researchError(id);
  if (err) { toast(err, 'bad'); return false; }
  const lvl = R(id) + 1, uni = freeUniversity(RESEARCH[id].uni);
  pay(researchCost(id, lvl));
  const t = researchTime(id, lvl, uni);
  uni.research = { id, left: t, total: t };
  toast(`${RESEARCH[id].icon} Researching ${RESEARCH[id].name} ${lvl}`, 'good');
  UI.panelDirty = true;
  return true;
}
function completeResearch(b) {
  const id = b.research.id;
  b.research = null;
  S.research[id] = R(id) + 1;
  S.stats.researched++;
  const r = RESEARCH[id];
  log(`Research complete: ${r.name} ${S.research[id]} — ${r.desc(S.research[id])}.`, 'good');
  toast(`🎓 ${r.name} ${S.research[id]} complete!`, 'good');
  UI.panelDirty = true;
}
function stepResearch(b, dt) {
  if (!b.research || b.level < 1) return;
  b.research.left -= dt;
  if (b.research.left <= 0) completeResearch(b);
}
