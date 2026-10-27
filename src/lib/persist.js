// Snapshot open tabs/groups; on browser start, recreate anything missing as lazy placeholders
// (no page loads until you click the tab) and put everything back into its group.

import { getSettings, getState, updateState, flushState } from './store.js';
import { isGroupable, lazyUrl, realTitle, realUrl } from './urls.js';
import { catForGroup } from './organizer.js';

export async function snapshot() {
  const st = await getState();
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  if (!windows.length) return; // browser shutting down: keep the previous snapshot
  const out = [];
  for (const w of windows) {
    const groups = await chrome.tabGroups.query({ windowId: w.id });
    const gmeta = {};
    for (const g of groups) gmeta[g.id] = { title: g.title, color: g.color, collapsed: g.collapsed, catId: await catForGroup(g.id) };
    out.push({
      focused: w.focused,
      tabs: w.tabs
        .filter((t) => t.pinned || isGroupable(t))
        .map((t) => ({
          url: realUrl(t),
          title: realTitle(t),
          favIconUrl: t.favIconUrl && !t.favIconUrl.startsWith('chrome-extension://') ? t.favIconUrl : '',
          pinned: t.pinned,
          group: t.groupId !== -1 ? gmeta[t.groupId] : null,
        })),
    });
  }
  st.snapshot = { savedAt: Date.now(), windows: out.filter((w) => w.tabs.length) };
  await updateState(() => {});
}

/** Wait until Chrome's own session restore stops creating tabs. */
async function settle(maxMs = 12000, quietMs = 2500) {
  const t0 = Date.now();
  let last = Date.now();
  let prevCount = -1;
  while (Date.now() - t0 < maxMs) {
    const n = (await chrome.tabs.query({})).length;
    if (n !== prevCount) {
      prevCount = n;
      last = Date.now();
    } else if (Date.now() - last > quietMs) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function restore() {
  const settings = await getSettings();
  const st = await getState();
  const snap = st.snapshot;
  if (!settings.restoreOnStartup || !snap?.windows?.length) return { restored: 0 };
  await settle();

  const open = await chrome.tabs.query({});
  const openUrls = new Set(open.map((t) => realUrl(t)));
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });

  // Match snapshot windows to live windows by URL overlap.
  const used = new Set();
  let restored = 0;
  for (const sw of snap.windows) {
    const missing = sw.tabs.filter((t) => !openUrls.has(t.url));
    if (!missing.length) continue;
    let best = null;
    let bestScore = -1;
    for (const w of windows) {
      if (used.has(w.id)) continue;
      const urls = new Set(w.tabs.map((t) => realUrl(t)));
      const score = sw.tabs.filter((t) => urls.has(t.url)).length;
      if (score > bestScore) [best, bestScore] = [w, score];
    }
    let windowId;
    // A live window that shares tabs (Chrome restored part of it) or the lone startup window.
    if (best && (bestScore > 0 || windows.length === 1)) {
      windowId = best.id;
      used.add(best.id);
    } else {
      const first = missing.shift();
      const w = await chrome.windows.create({ url: lazyUrl(first), focused: false });
      windowId = w.id;
      if (first.pinned) await chrome.tabs.update(w.tabs[0].id, { pinned: true });
      restored++;
    }
    for (const t of missing) {
      await chrome.tabs.create({ windowId, url: lazyUrl(t), active: false, pinned: !!t.pinned });
      openUrls.add(t.url);
      restored++;
    }
  }
  await flushState();
  return { restored };
}

/** After organize has rebuilt groups, re-apply the collapsed state from the snapshot. */
export async function restoreCollapsed() {
  const st = await getState();
  const snap = st.snapshot;
  if (!snap) return;
  const collapsedNames = new Set();
  for (const w of snap.windows) for (const t of w.tabs) if (t.group?.collapsed && t.group.title) collapsedNames.add(t.group.title);
  for (const g of await chrome.tabGroups.query({})) {
    if (g.title && collapsedNames.has(g.title) && !g.collapsed) {
      try { await chrome.tabGroups.update(g.id, { collapsed: true }); } catch {}
    }
  }
}
