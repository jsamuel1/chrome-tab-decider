// Persistent settings and organizer state (chrome.storage.local).

export const DEFAULT_SETTINGS = {
  enabled: true,
  // Grouping
  maxGroups: 8,                 // top categories that get their own group; the rest go to "Other"
  otherGroupName: 'Other',
  minConfidence: 0.35,          // decider confidence below this → Other
  autoDiscover: true,           // re-run category discovery when "Other" grows
  otherRediscoverThreshold: 6,  // tabs in Other (from ≥3 domains) before re-discovery
  collapseInactiveGroups: false,
  pinnedMax: 5,                 // most-used pages TabSage keeps as Chrome pinned tabs
  dailyMax: 8,                  // next tier, kept in the Daily group
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
};

const DEFAULT_STATE = {
  categories: {},   // id -> { id, name, description, color, pinned, lastActive, createdAt, source, kind, parentId, isNew, shownTitle }
  pageMap: {},      // pageKey -> { catId, confidence, source: 'decider'|'user'|'site', at, fixed, sig }
  siteRules: {},    // host -> { catId, reasonId }
  reasons: [],      // [{ id, catId, text, scope: 'page'|'site', host, url, at, optionId }]
  usage: {},        // pageKey -> { score, at }
  ourPins: {},      // pageKey -> time we pinned it
  pinCooldown: {},  // pageKey -> time before which we do not pin it again
  profile: { company: '', companyDomains: [], work: '', projects: [], style: 'specific-work', categories: [], onboarded: false },
  tabMeta: {},      // pageKey -> { firstSeen, lastAccessed, details }, only for pages open in a tab
  snapshot: null,   // last persisted window/group/tab layout
  archive: [],      // [{ id, url, title, favIconUrl, domain, catName, archivedAt, lastAccessed }]
  lastDiscovery: 0,
  stats: { organizedAt: 0, lastEngine: '' },
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// Settings with a range: a value from Settings is rounded and kept inside it (0 turns the feature off).
const RANGES = { pinnedMax: [0, 20], dailyMax: [0, 30] };

/** `patch` with its numbers kept in their ranges. */
export function cleanSettings(patch) {
  const out = { ...patch };
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (!(k in out)) continue;
    const n = Math.round(Number(out[k]));
    out[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULT_SETTINGS[k];
  }
  return out;
}

/** True when a change to these settings changes how tabs are grouped or pinned, so tabs are organized again. */
export const regroups = (patch) => ['maxGroups', 'otherGroupName', 'pinnedMax', 'dailyMax'].some((k) => k in (patch || {}));

export async function setSettings(patch) {
  const s = await getSettings();
  const next = { ...s, ...cleanSettings(patch) };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export const SCHEMA_VERSION = 2;

/** Record that the user put every page on `host` in `catId`. A changed decision gets a new reason. */
export function setSiteRule(st, host, catId, at = Date.now()) {
  const cur = st.siteRules[host];
  if (cur && cur.catId === catId) return cur;
  const reason = { id: uid('r'), catId, text: 'Moved here by hand', scope: 'site', host, url: '', at };
  // the reason behind an earlier rule for this site no longer holds
  st.reasons = st.reasons.filter((r) => !(r.scope === 'site' && r.host === host));
  st.reasons.push(reason);
  st.siteRules[host] = { catId, reasonId: reason.id };
  return st.siteRules[host];
}

/** Bring state saved by an older version up to the current shape. Safe to run repeatedly. */
export function migrate(st) {
  const fresh = structuredClone(DEFAULT_STATE);
  for (const k of ['pageMap', 'siteRules', 'reasons', 'usage', 'ourPins', 'pinCooldown', 'profile']) {
    if (st[k] === undefined) st[k] = fresh[k];
  }
  for (const c of Object.values(st.categories || {})) {
    if (c.kind === undefined) c.kind = 'personal';
    if (c.parentId === undefined) c.parentId = null;
    if (c.isNew === undefined) c.isNew = false;
  }
  // tabMeta used to be keyed by the full URL; it is keyed by pageKey (no #fragment) now, so fold old keys in.
  if (st.tabMeta) {
    for (const [k, m] of Object.entries(st.tabMeta)) {
      const i = k.indexOf('#');
      if (i === -1) continue;
      const key = k.slice(0, i);
      const cur = st.tabMeta[key];
      st.tabMeta[key] = cur ? {
        ...m, ...cur,
        firstSeen: Math.min(cur.firstSeen ?? Infinity, m.firstSeen ?? Infinity),
        lastAccessed: Math.max(cur.lastAccessed || 0, m.lastAccessed || 0),
      } : m;
      delete st.tabMeta[k];
    }
  }
  // Only state from before the page-based model has a domainMap: its hand-made corrections become site rules.
  if ((st.schemaVersion || 1) < SCHEMA_VERSION) {
    if (st.domainMap) {
      for (const [host, m] of Object.entries(st.domainMap)) {
        if (m.source === 'user') setSiteRule(st, host, m.catId, m.at || Date.now());
      }
      delete st.domainMap;
    }
    st.schemaVersion = SCHEMA_VERSION;
  }
  return st;
}

let cached = null;
let writeTimer = null;

export async function getState() {
  if (cached) return cached;
  const { state } = await chrome.storage.local.get('state');
  cached = migrate({ ...structuredClone(DEFAULT_STATE), ...(state || {}) });
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
