// Your recent tabs: which ones TabSage keeps still, and what the popup lists under Recent.

import { isGroupable, pageKey, realUrl } from './urls.js';

const DAY = 864e5;

/**
 * The ids of the n most recently used tabs in each window. TabSage never moves these, so the tab you
 * were just on stays where Ctrl+Tab and Ctrl+Shift+Tab expect it. A tab never visited is not recent.
 */
export function heldTabIds(tabs, n) {
  const held = new Set();
  if (!(n > 0)) return held;
  const byWindow = new Map();
  for (const t of tabs) {
    if (!(t.lastAccessed > 0)) continue;
    if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
    byWindow.get(t.windowId).push(t);
  }
  for (const list of byWindow.values()) {
    list.sort((a, b) => b.lastAccessed - a.lastAccessed).slice(0, n).forEach((t) => held.add(t.id));
  }
  return held;
}

const faded = (e, now, halfLifeDays) => (e ? e.score * 0.5 ** (Math.max(0, now - e.at) / (halfLifeDays * DAY)) : 0);

/**
 * The popup's two lists: the most recently used tabs, newest first, then the open pages you use
 * most that are not already in Recent. Chrome's own pages and extension pages are left out.
 */
export function recentLists(tabs, usage, now, { recent = 10, used = 10, halfLifeDays = 7 } = {}) {
  const listable = tabs.filter((t) => isGroupable({ ...t, pinned: false }));
  const rec = listable
    .filter((t) => t.lastAccessed > 0)
    .sort((a, b) => b.lastAccessed - a.lastAccessed)
    .slice(0, recent);
  const inRecent = new Set(rec.map((t) => t.id));
  const score = (t) => faded(usage?.[pageKey(realUrl(t))], now, halfLifeDays);
  const top = listable
    .filter((t) => !inRecent.has(t.id) && score(t) > 0)
    .sort((a, b) => score(b) - score(a))
    .slice(0, used);
  return { recent: rec, used: top };
}
