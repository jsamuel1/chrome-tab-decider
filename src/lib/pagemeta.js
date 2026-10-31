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

const DETAIL_KEYS = ['title', 'description', 'siteName', 'ogTitle', 'h1', 'lang'];

/** Page details as a content script reported them, cut back to the known items, each a string of at most 200 characters. */
export function cleanDetails(details) {
  if (!details || typeof details !== 'object') return null;
  const out = {};
  for (const k of DETAIL_KEYS) out[k] = typeof details[k] === 'string' ? details[k].slice(0, 200) : '';
  return out;
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

/** How many open tracked tabs have stored page details (a count only, for the smoke test). */
export function detailsCount(st, tabs) {
  return tabs.filter((t) => tracked(t) && st.tabMeta?.[pageKey(realUrl(t))]?.details).length;
}
