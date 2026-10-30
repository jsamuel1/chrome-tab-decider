// TabSage service worker: wires Chrome events to the organizer, sorter, persistence and archive.

import { getSettings, setSettings, getState, updateState, flushState, DEFAULT_SETTINGS } from './lib/store.js';
import { organize, learnFromUser, expectedGroupChange, manualTabs, catForGroup, groupCat } from './lib/organizer.js';
import { sortAll } from './lib/sorter.js';
import { snapshot, restore, restoreCollapsed } from './lib/persist.js';
import { runArchive, search, reopenArchived, deleteArchived } from './lib/archive.js';
import { ai, closeOffscreen, ensureOffscreen, unloadIfIdle } from './lib/ai.js';
import { modelError } from './engine/models.js';
import { realUrl, domainKey } from './lib/urls.js';
import { OTHER_ID, mergeCategories } from './lib/categories.js';

// ---------- debouncers
const timers = {};
function debounce(key, ms, fn) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => {
    delete timers[key];
    fn();
  }, ms);
}
const scheduleOrganize = (reason, ms = 1500) => debounce('organize', ms, () => organize({ reason }));
const scheduleSnapshot = (ms = 1500) => debounce('snapshot', ms, () => snapshot());
const scheduleSort = async () => {
  const s = await getSettings();
  debounce('sort', s.sortDelaySec * 1000, () => sortAll().then(() => scheduleSnapshot()));
};

let startingUp = false;

// ---------- lifecycle
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  setupAlarms();
  if (reason === 'install') chrome.runtime.openOptionsPage();
  organize({ reason: 'installed' }).then(() => scheduleSnapshot(500));
  prefetchModel('install');
});

/** Download the classifier into the browser cache (no GPU session until it is needed). */
async function prefetchModel(why) {
  const settings = await getSettings();
  if (!settings.autoDownload || modelError(settings)) return;
  try {
    const r = await ai('decider.prefetch', { settings }, 2 * 60 * 60 * 1000);
    if (!r.cached) {
      console.info(`[TabSage] model downloaded (${why})`);
      organize({ reason: 'model-downloaded', reassign: 'heuristic' });
    }
  } catch (e) {
    console.warn('[TabSage] model download skipped:', e.message);
  }
}

chrome.runtime.onStartup.addListener(async () => {
  startingUp = true;
  setupAlarms();
  try {
    const { restored } = await restore();
    console.info(`[TabSage] restored ${restored} lazy tabs`);
    await organize({ reason: 'startup' });
    await restoreCollapsed();
  } finally {
    startingUp = false;
    scheduleSnapshot(500);
  }
  prefetchModel('startup');
});

function setupAlarms() {
  chrome.alarms.create('archive', { periodInMinutes: 60, delayInMinutes: 5 });
  chrome.alarms.create('snapshot', { periodInMinutes: 5 });
  chrome.alarms.create('idle', { periodInMinutes: 2 });
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'archive') {
    const closed = await runArchive();
    if (closed.length) console.info(`[TabSage] archived ${closed.length} tabs`);
  } else if (a.name === 'snapshot') {
    if (!startingUp) snapshot();
  } else if (a.name === 'idle') {
    const s = await getSettings();
    unloadIfIdle(s.idleUnloadMin).catch(() => {});
  }
});

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'organize-now') organize({ reason: 'shortcut' });
});

// ---------- tab events
chrome.tabs.onCreated.addListener(() => {
  if (startingUp) return;
  scheduleSnapshot();
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if ('groupId' in info) {
    const exp = expectedGroupChange.get(tabId);
    if (exp !== undefined) {
      expectedGroupChange.delete(tabId);
    } else if (!startingUp) {
      learnFromUser(tab, info.groupId);
    }
    scheduleSnapshot();
  }
  if (startingUp) return;
  if (info.status === 'complete' || info.url || info.title) {
    if (info.url) manualTabs.delete(tabId); // navigated somewhere new: eligible again
    scheduleOrganize('tab-updated');
    scheduleSnapshot();
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = realUrl(tab);
    const now = Date.now();
    await updateState(async (st) => {
      st.tabMeta[url] = { ...(st.tabMeta[url] || { firstSeen: now }), lastAccessed: now };
      const catId = await catForGroup(tab.groupId);
      if (catId && st.categories[catId]) st.categories[catId].lastActive = now;
    });
    scheduleSort();
  } catch {}
});

chrome.tabs.onRemoved.addListener((tabId, { isWindowClosing }) => {
  manualTabs.delete(tabId);
  if (isWindowClosing) return; // window/browser closing: keep the snapshot as-is for restore
  scheduleSnapshot();
});

chrome.windows.onRemoved.addListener(() => scheduleSnapshot(6000));

chrome.tabGroups.onUpdated.addListener(async (g) => {
  if (startingUp) return;
  // user renamed / recolored a group → keep the category in sync
  const catId = await catForGroup(g.id);
  if (catId) {
    await updateState((st) => {
      const c = st.categories[catId];
      if (!c) return;
      if (g.title && g.title !== c.name && catId !== OTHER_ID) c.name = g.title;
      if (g.color && g.color !== c.color) c.color = g.color;
    });
  } else if (g.title) {
    scheduleOrganize('group-named', 800);
  }
  scheduleSnapshot();
});
chrome.tabGroups.onRemoved.addListener((g) => groupCat.delete(g.id));

// ---------- messages from popup / options / offscreen
const api = {
  async status() {
    const settings = await getSettings();
    const st = await getState();
    let engine = null;
    const problem = modelError(settings);
    if (problem) engine = { error: problem };
    else try { engine = await ai('decider.status', { settings }, 15000); } catch (e) { engine = { error: e.message }; }
    let llm = 'unknown';
    try { llm = (await ai('llm.availability', {}, 15000)).availability; } catch {}
    const groups = await chrome.tabGroups.query({});
    const tabs = await chrome.tabs.query({});
    const cats = [];
    for (const c of Object.values(st.categories)) {
      const gids = [];
      for (const g of groups) if ((await catForGroup(g.id)) === c.id) gids.push(g.id);
      const n = tabs.filter((t) => gids.includes(t.groupId)).length;
      const domains = Object.entries(st.domainMap).filter(([, m]) => m.catId === c.id).map(([d]) => d);
      cats.push({ ...c, tabCount: n, groupIds: gids, domains });
    }
    cats.sort((a, b) => (b.pinned - a.pinned) || (b.tabCount - a.tabCount));
    return { settings, engine, llm, categories: cats, archiveCount: st.archive.length, stats: st.stats, snapshotAt: st.snapshot?.savedAt };
  },
  organize: ({ rediscover, categories }) => organize({ rediscover, categories, reason: 'manual' }).then(() => scheduleSnapshot(300)),
  sort: () => sortAll(),
  search: ({ query }) => search(query || ''),
  reopen: ({ id, lazy }) => reopenArchived(id, { lazy }),
  deleteArchived: ({ id }) => deleteArchived(id),
  archiveNow: () => runArchive(),
  archivePreview: () => runArchive({ dryRun: true }),
  async focusTab({ tabId, windowId }) {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  },
  async setPinned({ catId, pinned }) {
    await updateState((st) => { if (st.categories[catId]) st.categories[catId].pinned = pinned; }, { immediate: true });
    await organize({ reason: 'pin' });
  },
  async renameCategory({ catId, name }) {
    await updateState((st) => { if (st.categories[catId]) st.categories[catId].name = name; }, { immediate: true });
    await organize({ reason: 'rename' });
  },
  async deleteCategory({ catId }) {
    if (catId === OTHER_ID) return;
    await updateState((st) => {
      delete st.categories[catId];
      for (const [d, m] of Object.entries(st.domainMap)) if (m.catId === catId) delete st.domainMap[d];
    }, { immediate: true });
    await organize({ reason: 'delete-category' });
  },
  async addCategory({ name, description }) {
    await updateState((st) => { mergeCategories(st, [{ name, description }], 'user'); }, { immediate: true });
    await organize({ reason: 'add-category', reassign: 'heuristic' });
  },
  async forgetDomain({ domain }) {
    await updateState((st) => { delete st.domainMap[domain]; }, { immediate: true });
    await organize({ reason: 'forget-domain' });
  },
  getSettings: () => getSettings(),
  async setSettings({ patch }) {
    const s = await setSettings(patch);
    if ('maxGroups' in patch || 'domainKey' in patch || 'otherGroupName' in patch) organize({ reason: 'settings' });
    if ('groupSort' in patch || 'tabSort' in patch) sortAll();
    if ('model' in patch || 'customModel' in patch || patch.autoDownload) prefetchModel('settings');
    return s;
  },
  // Long engine calls (load, self-test) go from the page straight to the offscreen document,
  // so they don't depend on this worker outliving them.
  ensureEngine: () => ensureOffscreen(),
  // re-check domains that were placed by fallbacks now that the decider is ready
  modelReady: () => organize({ reason: 'model-ready', reassign: 'heuristic' }),
  async unloadModel() { await closeOffscreen(); },
  async exportData() {
    const { settings, state } = await chrome.storage.local.get(['settings', 'state']);
    return { settings, state: { ...state, tabMeta: undefined } };
  },
  async resetAll() {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    groupCat.clear();
    chrome.runtime.reload();
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;
  const h = api[msg.type];
  if (!h) return false;
  Promise.resolve()
    .then(() => h(msg))
    .then((r) => sendResponse({ ok: true, result: r }))
    .catch((e) => {
      console.error('[TabSage]', msg.type, e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    });
  return true;
});

self.addEventListener('unhandledrejection', (e) => console.warn('[TabSage] unhandled', e.reason));
