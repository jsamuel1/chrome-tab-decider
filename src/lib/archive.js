// Trim ad-hoc tabs that haven't been revisited in N days: close them but keep them searchable.

import { getSettings, getState, updateState, uid } from './store.js';
import { hostOf, isGroupable, lazyUrl, realTitle, realUrl } from './urls.js';
import { catForGroup, organize } from './organizer.js';
import { OTHER_ID } from './categories.js';

export async function runArchive({ dryRun = false } = {}) {
  const settings = await getSettings();
  if (!settings.archiveEnabled) return [];
  const st = await getState();
  const cutoff = Date.now() - settings.archiveDays * 864e5;
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const victims = [];
  for (const t of tabs) {
    if (!isGroupable(t) || t.active || t.audible || t.pinned) continue;
    const catId = await catForGroup(t.groupId);
    const cat = catId && st.categories[catId];
    if (cat?.pinned) continue;
    if (settings.archiveScope === 'other' && catId !== OTHER_ID) continue;
    const meta = st.tabMeta[realUrl(t)];
    const last = Math.max(meta?.lastAccessed || 0, t.lastAccessed || 0, meta ? 0 : Date.now());
    if (last < cutoff) victims.push({ t, cat, last });
  }
  if (dryRun) return victims.map((v) => realUrl(v.t));

  await updateState((s) => {
    const existing = new Set(s.archive.map((a) => a.url));
    for (const { t, cat, last } of victims) {
      const url = realUrl(t);
      if (existing.has(url)) s.archive = s.archive.filter((a) => a.url !== url);
      s.archive.unshift({
        id: uid('a'), url, title: realTitle(t), favIconUrl: t.favIconUrl || '',
        domain: hostOf(url), catName: cat?.name || '',
        archivedAt: Date.now(), lastAccessed: last,
      });
      delete s.tabMeta[url];
    }
    if (s.archive.length > settings.archiveMax) s.archive.length = settings.archiveMax;
  }, { immediate: true });
  if (victims.length) await chrome.tabs.remove(victims.map((v) => v.t.id));
  return victims.map((v) => realUrl(v.t));
}

/** Search open tabs + archive. */
export async function search(query, limit = 60) {
  const st = await getState();
  const q = query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const match = (s) => terms.every((w) => s.includes(w));
  const tabs = await chrome.tabs.query({});
  const open = [];
  for (const t of tabs) {
    const url = realUrl(t);
    const title = realTitle(t);
    const catId = await catForGroup(t.groupId);
    const catName = st.categories[catId]?.name || '';
    if (!q || match(`${title} ${url} ${catName}`.toLowerCase())) {
      open.push({ kind: 'open', tabId: t.id, windowId: t.windowId, url, title, favIconUrl: t.favIconUrl, catName });
    }
  }
  const archived = st.archive
    .filter((a) => !q || match(`${a.title} ${a.url} ${a.catName}`.toLowerCase()))
    .slice(0, limit)
    .map((a) => ({ kind: 'archived', ...a }));
  return { open: open.slice(0, limit), archived, archiveTotal: st.archive.length };
}

export async function reopenArchived(id, { lazy = false } = {}) {
  const st = await getState();
  const item = st.archive.find((a) => a.id === id);
  if (!item) return null;
  const tab = await chrome.tabs.create({ url: lazy ? lazyUrl(item) : item.url, active: !lazy });
  await updateState((s) => {
    s.archive = s.archive.filter((a) => a.id !== id);
    s.tabMeta[item.url] = { firstSeen: Date.now(), lastAccessed: Date.now() };
  });
  setTimeout(() => organize({ reason: 'reopen' }), 800);
  return tab.id;
}

export async function deleteArchived(id) {
  await updateState((s) => {
    s.archive = id === '*' ? [] : s.archive.filter((a) => a.id !== id);
  }, { immediate: true });
}
