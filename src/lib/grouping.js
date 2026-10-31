// How folders become flat Chrome tab groups.

import { OTHER_ID, DAILY_ID } from './categories.js';

export function groupTitle(cat, profile) {
  const company = String(profile?.company || '').trim();
  if (cat.kind === 'company') return company || cat.name;
  if (cat.kind === 'work' && company) return `${company} · ${cat.name}`;
  return cat.name;
}

/** Which category's group each category with open tabs shows in. Over the limit, the lowest ranked fold into their parent. */
export function planGroups(cats, counts, maxGroups) {
  const list = Array.isArray(cats) ? cats : Object.values(cats);
  const byId = new Map(list.map((c) => [c.id, c]));
  const plan = new Map();
  const open = list.filter((c) => (counts.get(c.id) || 0) > 0);

  const ranked = [];
  for (const c of open) {
    if (c.id === DAILY_ID || c.id === OTHER_ID) plan.set(c.id, c.id);
    else ranked.push(c);
  }
  ranked.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || counts.get(b.id) - counts.get(a.id));

  // Other takes a slot when it has tabs; Daily never does.
  const slots = Math.max(0, maxGroups - (plan.has(OTHER_ID) ? 1 : 0));
  const kept = new Set(ranked.slice(0, slots).map((c) => c.id));

  const parentOf = (c) => {
    const p = byId.get(c.parentId);
    if (p) return p;
    if (c.kind === 'work') return list.find((x) => x.kind === 'company') || null;
    return null;
  };
  for (const c of ranked) {
    if (kept.has(c.id)) { plan.set(c.id, c.id); continue; }
    let target = parentOf(c);
    const seen = new Set([c.id]);
    // A parent that was folded itself passes the tabs further up.
    while (target && !kept.has(target.id) && !seen.has(target.id) && (counts.get(target.id) || 0) > 0) {
      seen.add(target.id);
      target = parentOf(target);
    }
    plan.set(c.id, target && !seen.has(target.id) ? target.id : OTHER_ID);
  }
  return plan;
}
