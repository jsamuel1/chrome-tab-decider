// Dynamic ordering: pinned groups first, then groups by the chosen mode; tabs within groups likewise.

import { getSettings, getState } from './store.js';
import { hostOf, pageKey, realTitle, realUrl } from './urls.js';
import { catForGroup } from './organizer.js';
import { classifierReady } from './ai.js';

const lastUsed = (st, t) => Math.max(st.tabMeta[pageKey(realUrl(t))]?.lastAccessed || 0, t.lastAccessed || 0);

function orderTabs(tabs, mode, st, settings) {
  if (mode === 'manual') return tabs;
  const arr = tabs.slice();
  if (mode === 'title') return arr.sort((a, b) => realTitle(a).localeCompare(realTitle(b)));
  if (mode === 'mru') return arr.sort((a, b) => lastUsed(st, b) - lastUsed(st, a));
  // domain-mru: domains ordered by their most recent tab, tabs MRU inside each domain
  const byDomain = new Map();
  for (const t of arr) {
    const d = hostOf(realUrl(t));
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(t);
  }
  return [...byDomain.values()]
    .map((list) => list.sort((a, b) => lastUsed(st, b) - lastUsed(st, a)))
    .sort((a, b) => lastUsed(st, b[0]) - lastUsed(st, a[0]))
    .flat();
}

let sorting = false;

export async function sortAll() {
  if (sorting) return;
  sorting = true;
  try {
    const settings = await getSettings();
    if (!(await classifierReady(settings))) return;
    const st = await getState();
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (const w of windows) await sortWindow(w.id, settings, st);
  } catch (e) {
    console.warn('[TabSage] sort skipped:', e.message);
  } finally {
    sorting = false;
  }
}

async function sortWindow(windowId, settings, st) {
  const tabs = await chrome.tabs.query({ windowId });
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  const groups = new Map(); // gid -> tabs
  for (const t of tabs) {
    if (t.groupId === -1) continue;
    if (!groups.has(t.groupId)) groups.set(t.groupId, []);
    groups.get(t.groupId).push(t);
  }
  const info = [];
  for (const [gid, list] of groups) {
    const cat = st.categories[await catForGroup(gid)];
    info.push({
      gid, list, cat,
      pinned: !!cat?.pinned,
      recent: Math.max(...list.map((t) => lastUsed(st, t))),
      name: cat?.name || '',
      daily: cat?.kind === 'daily',
      isOther: cat?.id === 'other',
      firstIndex: list[0].index,
    });
  }
  const mode = settings.groupSort;
  info.sort((a, b) => {
    if (a.daily !== b.daily) return a.daily ? -1 : 1; // Daily first, whatever the sort mode
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.isOther !== b.isOther && mode !== 'manual') return a.isOther ? 1 : -1; // Other last
    if (mode === 'mru') return b.recent - a.recent;
    if (mode === 'count') return b.list.length - a.list.length || a.name.localeCompare(b.name);
    if (mode === 'alpha') return a.name.localeCompare(b.name);
    return a.firstIndex - b.firstIndex; // manual: keep current order (pinned still float up)
  });

  // Phase 1: groups in order, right after Chrome-pinned tabs.
  let index = pinnedCount;
  for (const g of info) {
    if (g.daily) try { await chrome.tabGroups.update(g.gid, { collapsed: false }); } catch {} // Daily is never collapsed
    const cur = (await chrome.tabs.query({ windowId, groupId: g.gid }));
    if (cur.length && cur[0].index !== index) await chrome.tabGroups.move(g.gid, { index });
    index += cur.length;
  }
  // Phase 2: tabs within each group.
  if (settings.tabSort === 'manual') return;
  for (const g of info) {
    const cur = await chrome.tabs.query({ windowId, groupId: g.gid });
    if (!cur.length) continue;
    const start = cur[0].index;
    const want = orderTabs(cur, settings.tabSort, st, settings);
    for (let i = 0; i < want.length; i++) {
      const live = await chrome.tabs.get(want[i].id);
      if (live.index !== start + i) await chrome.tabs.move(live.id, { index: start + i });
    }
  }
  // Optional: collapse groups that don't hold the active tab.
  if (settings.collapseInactiveGroups) {
    const [active] = await chrome.tabs.query({ windowId, active: true });
    for (const g of info) {
      const collapsed = !g.daily && (!active || active.groupId !== g.gid);
      try { await chrome.tabGroups.update(g.gid, { collapsed }); } catch {}
    }
  }
}
