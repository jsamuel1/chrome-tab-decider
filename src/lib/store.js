// Persistent settings and organizer state (chrome.storage.local).

export const DEFAULT_SETTINGS = {
  enabled: true,
  // Grouping
  domainKey: 'hostname',        // 'hostname' (mail.google.com) | 'registrable' (google.com)
  maxGroups: 8,                 // top categories that get their own group; the rest go to "Other"
  otherGroupName: 'Other',
  minConfidence: 0.35,          // decider confidence below this → Other
  autoDiscover: true,           // re-run category discovery when "Other" grows
  otherRediscoverThreshold: 6,  // tabs in Other (from ≥3 domains) before re-discovery
  collapseInactiveGroups: false,
  // Sorting
  groupSort: 'mru',             // 'mru' | 'count' | 'alpha' | 'manual'
  tabSort: 'domain-mru',        // 'domain-mru' | 'mru' | 'title' | 'manual'
  sortDelaySec: 20,             // wait this long after activity before re-sorting
  // Archive (trim ad-hoc tabs)
  archiveEnabled: true,
  archiveDays: 7,
  archiveScope: 'unpinned',     // 'unpinned' (any tab not in a pinned group) | 'other' (only the Other group)
  archiveMax: 5000,
  // Persistence
  restoreOnStartup: true,
  // AI
  model: 'decider-v1-2610-q4f16',
  autoDownload: true,           // fetch the classifier into the browser cache on startup (loads on first use)
  customModel: { repo: '', modelFile: '', dataFile: '', configFile: 'config.json' },
  device: 'webgpu',             // 'webgpu' | 'wasm'
  useLLM: true,                 // Chrome built-in Prompt API for category discovery
  idleUnloadMin: 10,
  seedCategories: '',           // optional comma-separated categories always offered
};

const DEFAULT_STATE = {
  categories: {},   // id -> { id, name, description, color, pinned, lastActive, createdAt, source }
  domainMap: {},    // domainKey -> { catId, confidence, source: 'decider'|'llm'|'heuristic'|'user', at }
  tabMeta: {},      // realUrl -> { firstSeen, lastAccessed }
  snapshot: null,   // last persisted window/group/tab layout
  archive: [],      // [{ id, url, title, favIconUrl, domain, catName, archivedAt, lastAccessed }]
  lastDiscovery: 0,
  stats: { organizedAt: 0, lastEngine: '' },
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function setSettings(patch) {
  const s = await getSettings();
  const next = { ...s, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

let cached = null;
let writeTimer = null;

export async function getState() {
  if (cached) return cached;
  const { state } = await chrome.storage.local.get('state');
  cached = { ...structuredClone(DEFAULT_STATE), ...(state || {}) };
  return cached;
}

/** Mutate the cached state then persist (debounced). */
export async function updateState(fn, { immediate = false } = {}) {
  const st = await getState();
  const r = await fn(st);
  if (immediate) await flushState();
  else {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushState, 400);
  }
  return r;
}

export async function flushState() {
  clearTimeout(writeTimer);
  if (cached) await chrome.storage.local.set({ state: cached });
}

export function uid(prefix = 'c') {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}
