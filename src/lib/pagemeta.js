// What TabSage keeps about open pages (st.tabMeta, keyed by pageKey): only pages open in a tab it organises.

import { isGroupable, pageKey, realUrl } from './urls.js';

/** Tabs whose pages we may remember: groupable, in a normal window, and never incognito. */
export function tracked(tab, windowType = 'normal') {
  return !!tab && !tab.incognito && windowType === 'normal' && isGroupable(tab);
}

/** The tabMeta key for a pageDetails message, or null when the sender's tab is not one we keep details for. */
export function detailsKey(sender, url, windowType) {
  const tab = sender?.tab;
  if (!url || !tracked(tab, windowType)) return null;
  if (sender.frameId !== undefined && sender.frameId !== 0) return null;
  const key = pageKey(url);
  return key && key === pageKey(realUrl(tab)) ? key : null;
}

/** Forget pages that are no longer open in a tracked tab. `tabs` are the tabs of normal windows. */
export function pruneTabMeta(st, tabs) {
  const open = new Set(tabs.filter((t) => tracked(t)).map((t) => pageKey(realUrl(t))));
  let removed = 0;
  for (const k of Object.keys(st.tabMeta)) {
    if (!open.has(k)) {
      delete st.tabMeta[k];
      removed++;
    }
  }
  return removed;
}
