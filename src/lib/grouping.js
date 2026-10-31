// How folders become flat Chrome tab groups.

import { OTHER_ID, DAILY_ID } from './categories.js';

export function groupTitle(cat, profile) {
  const company = String(profile?.company || '').trim();
  if (cat.kind === 'company') return company || cat.name;
  if (cat.kind === 'work' && company) return `${company} · ${cat.name}`;
  return cat.name;
}

/** The folder name a group title stands for, so a renamed work group keeps its company prefix out of the name. */
export function nameFromTitle(cat, title, profile) {
  const company = String(profile?.company || '').trim();
  const prefix = cat.kind === 'work' && company ? `${company} · ` : '';
  return prefix && title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

// True when key a sorts before key b, comparing element by element.
function before(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * Which category's group each category with open tabs shows in.
 *
 * Every category with open tabs starts as its own group. While there are more groups than
 * `maxGroups` (Daily never counts, Other counts once anything is in it), one group at a time is
 * folded into its parent: the nearest ancestor that is already a group, or the nearest parent with
 * no open tabs of its own (which then becomes a group), or, with no parent at all, into Other.
 * The fold chosen each time is the cheapest: pinned groups last, then the fold that sends the
 * fewest tabs to Other, then one that removes a group outright, then the smallest group. The
 * limit is therefore checked against the groups the plan really opens, after folding.
 */
export function planGroups(cats, counts, maxGroups) {
  const list = Array.isArray(cats) ? cats : Object.values(cats);
  const byId = new Map(list.map((c) => [c.id, c]));
  const count = (id) => counts.get(id) || 0;
  const limit = Math.max(0, Number(maxGroups) || 0);
  const open = list.filter((c) => count(c.id) > 0);

  const parentOf = (c) => {
    const p = byId.get(c.parentId);
    if (p) return p;
    if (c.kind === 'work') return list.find((x) => x.kind === 'company') || null;
    return null;
  };

  // Current groups (Daily is kept aside) and where each folded category went.
  const groups = new Map();
  const target = new Map();
  const filed = [];
  for (const c of open) {
    if (c.id === DAILY_ID) continue;
    filed.push(c);
    groups.set(c.id, { id: c.id, pinned: !!c.pinned, tabs: count(c.id) });
  }
  // Other's own tabs take a slot even when Other is not in the list given.
  if (count(OTHER_ID) > 0 && !groups.has(OTHER_ID)) {
    filed.push({ id: OTHER_ID });
    groups.set(OTHER_ID, { id: OTHER_ID, pinned: false, tabs: count(OTHER_ID) });
  }
  const follow = (id) => {
    while (!groups.has(id) && target.has(id)) id = target.get(id);
    return id;
  };

  // Where a group would fold: its nearest ancestor that is a group (or was folded, following it),
  // else its nearest parent with no open tabs; with no parent, Other.
  const destOf = (id) => {
    const seen = new Set([id]);
    for (let t = parentOf(byId.get(id)); t && !seen.has(t.id); t = parentOf(t)) {
      seen.add(t.id);
      if (t.id === OTHER_ID) break;
      if (t.id === DAILY_ID) continue;
      const d = groups.has(t.id) ? t.id : target.has(t.id) ? follow(t.id) : t.id;
      if (d === id) break; // a parent loop leads back here
      return d;
    }
    return OTHER_ID;
  };

  while (groups.size > limit) {
    let best = null;
    for (const g of groups.values()) {
      if (g.id === OTHER_ID) continue;
      const dest = destOf(g.id);
      const key = [g.pinned ? 1 : 0, dest === OTHER_ID ? g.tabs : 0, groups.has(dest) ? 0 : 1, g.tabs];
      if (!best || before(key, best.key)) {
        best = { g, dest, key };
      }
    }
    if (!best) break; // only Other is left; a limit of 0 cannot be met
    const { g, dest } = best;
    groups.delete(g.id);
    target.set(g.id, dest);
    const into = groups.get(dest);
    if (into) into.tabs += g.tabs;
    else groups.set(dest, { id: dest, pinned: !!byId.get(dest)?.pinned, tabs: g.tabs });
  }

  const plan = new Map();
  for (const c of filed) plan.set(c.id, follow(c.id));
  if (count(DAILY_ID) > 0) plan.set(DAILY_ID, DAILY_ID);
  return plan;
}
