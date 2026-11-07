// TabSage's Recent page, kept as the first pinned tab in each window: at the top of the vertical tab
// bar, and one Cmd/Ctrl+1 away.

export const RECENT_PAGE = chrome.runtime.getURL('recent.html');

/** Whether a tab is TabSage's Recent page. */
export function isRecentTab(t) {
  const url = t?.url || t?.pendingUrl || '';
  return url.split('#')[0] === RECENT_PAGE;
}

/**
 * What to do so each window in `windows` has exactly one Recent tab, pinned and first. Windows in
 * `closedIn` are ones where you closed it, and are left without one. Returns window ids to `create`
 * one in, tab ids to `move` back to the front (and pin), and duplicate tab ids to `remove`.
 */
export function planRecentTabs(tabs, { windows, closedIn = [], enabled = true }) {
  const plan = { create: [], move: [], remove: [] };
  if (!enabled) return plan;
  const skip = new Set(closedIn);
  for (const w of windows) {
    if (skip.has(w)) continue;
    const mine = tabs.filter((t) => t.windowId === w && isRecentTab(t))
      .sort((a, b) => (b.pinned - a.pinned) || a.index - b.index);
    if (!mine.length) {
      plan.create.push(w);
      continue;
    }
    const [keep, ...extra] = mine;
    plan.remove.push(...extra.map((t) => t.id));
    if (!keep.pinned || keep.index !== 0) plan.move.push(keep.id);
  }
  return plan;
}
