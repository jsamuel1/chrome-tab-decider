// The organizer: each open page → one folder → flat Chrome tab groups.

import { getSettings, getState, updateState } from './store.js';
import { hostOf, isGroupable, pageKey, realUrl } from './urls.js';
import { DAILY_ID, OTHER_ID, ensureDaily, ensureOther, findByName, mergeCategories } from './categories.js';
import { ai, classifierReady, deciderStatus } from './ai.js';
import { candidateTerms } from './bm25.js';
import { profileText } from './profile.js';
import { bookmarkFolders, bookmarkHint } from './bookmarks.js';
import { groupTitle, isRename, nameFromTitle, planGroups } from './grouping.js';
import { decisionOrder, decisionState, pageText, shortlist, shouldMove } from './decide.js';
import { sortAll } from './sorter.js';
import { applyReason, whyOptions } from './reasons.js';
import { carryUse, planPins, startCooldown } from './usage.js';

// Tab group changes we caused (so they aren't mistaken for the user teaching us).
export const expectedGroupChange = new Map(); // tabId -> groupId | '*'
// Tabs the user pulled out of a group by hand this session: leave them alone.
export const manualTabs = new Set();
// groupId -> catId for this browser session (group ids are not stable across restarts).
export const groupCat = new Map();

const QUIET_MS = 2 * 60 * 1000;   // filed pages are only re-decided after this long without tab or group events
const SLOW_BUDGET = 5;            // decisions per run on the WebAssembly engine
const ACCEPT = 0.6;               // P(true) a discovered folder name needs
const DISCOVER_EVERY = 10 * 60 * 1000;
const MAX_TERMS = 6;
const LONG = 30 * 60 * 1000;      // the first question may wait for the model to load

let chain = Promise.resolve();
export { classifierReady };
export let lastEngine = '';
// Kept in session storage too: the service worker restarts after half a minute idle, and many events
// that wake it (title changes, page details) do not count as activity.
let lastActivity = 0;
// Names the classifier turned down this session, so they are not asked about again and again.
const rejected = new Set();

/** A tab or group event from the user: filed pages wait for a quiet moment before being re-decided. */
export function markActivity(at = Date.now()) {
  lastActivity = at;
  return chrome.storage.session?.set({ lastActivity: at }).catch(() => {});
}

// When the user was last busy. Unknown (a fresh browser session) counts as just now, so nothing moves
// until the tab bar has really been quiet.
async function activityAt() {
  if (!lastActivity) {
    const stored = await chrome.storage.session?.get('lastActivity').catch(() => null);
    if (stored?.lastActivity) lastActivity = stored.lastActivity;
    else await markActivity(Date.now());
  }
  return lastActivity;
}

// The tab the user is looking at right now: the active tab of the last-focused normal window.
async function lookingAtNow() {
  const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (!w) return undefined;
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  return tabs.find((t) => t.active && t.windowId === w.id)?.id;
}

/** Serialize organize runs. */
export function organize(opts = {}) {
  const run = chain.then(() => _organize(opts)).catch((e) => console.error('[TabSage] organize failed', e));
  chain = run;
  return run;
}

// Tabs we are unpinning ourselves, so the change is not mistaken for the user's.
const expectedUnpin = new Set();

const realCats = (st) => Object.values(st.categories).filter((c) => c.id !== OTHER_ID && c.id !== DAILY_ID);
const keyOf = (t) => pageKey(realUrl(t));

function catByTitle(st, title) {
  const cats = Object.values(st.categories);
  return cats.find((c) => groupTitle(c, st.profile) === title) || cats.find((c) => c.shownTitle === title) || findByName(st, title)
    // a work group titled under a company the profile no longer names
    || cats.find((c) => c.kind === 'work' && title.endsWith(` · ${c.name}`));
}

// A short fingerprint of a page's details: when they change, the page is decided again.
function detailsSig(details) {
  if (!details) return '';
  const s = JSON.stringify(details);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// One tab per page: two tabs on the same page share a decision.
function onePerPage(tabs) {
  const seen = new Set();
  return tabs.filter((t) => {
    const k = keyOf(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Ask the classifier which folder one page belongs in; null when it could not answer. */
async function decide(st, settings, tab, folders) {
  const key = keyOf(tab);
  const details = st.tabMeta[key]?.details;
  const page = pageText(tab, details);
  const at = Date.now();
  const sig = detailsSig(details);
  const other = st.categories[OTHER_ID];
  const list = shortlist(page, realCats(st), st.reasons);
  if (!list.length) return { catId: OTHER_ID, confidence: 0, source: 'decider', at, sig };

  const host = hostOf(realUrl(tab));
  const inList = new Set(list.map((c) => c.id));
  const reasons = st.reasons
    .filter((r) => inList.has(r.catId) || (r.scope === 'site' && r.host === host))
    .map((r) => ({ ...r, folder: st.categories[r.catId]?.name }));
  const state = decisionState(page, { profile: st.profile, hint: bookmarkHint(realUrl(tab), await folders()), reasons });
  const options = [...list, other];
  try {
    const r = await ai('decider.choice', {
      settings, state,
      instructions: 'Which folder should this browser tab go in?',
      options: options.map((c) => ({ name: c.name, description: c.description })),
    }, LONG);
    if (r.error) return null;
    lastEngine = 'decider';
    const cat = options[r.labels.indexOf(r.choice)] || other;
    return { catId: r.confidence < settings.minConfidence ? OTHER_ID : cat.id, confidence: r.confidence, source: 'decider', at, sig };
  } catch (e) {
    console.warn('[TabSage] decider failed', e);
    return null;
  }
}

// The words of a candidate term as they are written in the user's own tabs ("acme" → "Acme").
function displayName(term, texts) {
  const re = new RegExp(term.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'iu');
  for (const t of texts) {
    const m = t.match(re);
    if (m) return m[0].replace(/\s+/g, ' ');
  }
  return term;
}

function folderState(st, texts) {
  const who = profileText(st.profile);
  const lines = texts.slice(0, 8).map((t) => `- ${t.split('\n').join(' · ').slice(0, 150)}`);
  return `${who ? `${who}\n\n` : ''}Browser tabs:\n${lines.join('\n')}`.slice(0, 1499);
}

/**
 * New folders from the user's own tabs: terms several pages in Other share but most open pages do not,
 * plus names from Chrome's built-in model when it is there. The classifier accepts or rejects each name.
 */
async function discover(st, settings, pages, inOther) {
  const text = new Map(pages.map((t) => [keyOf(t), pageText(t, st.tabMeta[keyOf(t)]?.details)]));
  const otherKeys = inOther.map(keyOf);
  const names = candidateTerms(pages.map((t) => ({ id: keyOf(t), text: text.get(keyOf(t)) })), { max: 24 })
    .map((c) => ({ term: c.term, keys: c.docIds.filter((id) => otherKeys.includes(id)) }))
    .filter((c) => c.keys.length >= 2)
    .slice(0, MAX_TERMS)
    .map((c) => ({ name: displayName(c.term, c.keys.map((k) => text.get(k))), description: '', keys: c.keys }));

  if (settings.useLLM) {
    try {
      const items = inOther.map((t) => ({ domain: hostOf(realUrl(t)), title: text.get(keyOf(t)).split('\n')[0] }));
      const existing = realCats(st).map((c) => ({ name: c.name, description: c.description }));
      const r = await ai('llm.discover', { items, existing, max: 3, mode: 'incremental' });
      if (!r.error) for (const c of r.categories || []) names.push({ name: c.name, description: c.description || '', keys: otherKeys });
    } catch (e) {
      console.warn('[TabSage] built-in model discovery failed', e);
    }
  }

  const added = [];
  for (const c of names) {
    const name = String(c.name || '').trim();
    if (!name || findByName(st, name) || rejected.has(name.toLowerCase())) continue;
    try {
      const r = await ai('decider.noul', {
        settings,
        state: folderState(st, c.keys.map((k) => text.get(k))),
        instructions: `Would "${name}" be a sensible name for a folder holding these browser tabs?`,
      }, LONG);
      if (r.error) break;
      const yes = r.probs?.[r.labels.indexOf('true')] ?? 0;
      if (yes >= ACCEPT) added.push(...mergeCategories(st, [{ name, description: c.description, isNew: true }], 'discovered'));
      else rejected.add(name.toLowerCase());
    } catch (e) {
      console.warn('[TabSage] folder check failed', e);
      break;
    }
  }
  st.lastDiscovery = Date.now();
  return added;
}

/** Adopt user-created, named groups as categories. */
async function adoptUserGroups(st) {
  const groups = await chrome.tabGroups.query({});
  for (const g of groups) {
    if (groupCat.has(g.id)) {
      // keep category name in sync with user renames
      const cat = st.categories[groupCat.get(g.id)];
      if (cat && g.title && cat.id !== OTHER_ID && isRename(cat, g.title, st.profile)) cat.name = nameFromTitle(cat, g.title, st.profile);
      continue;
    }
    if (!g.title) continue;
    let cat = catByTitle(st, g.title);
    if (!cat) [cat] = mergeCategories(st, [{ name: g.title, description: '', color: g.color }], 'user');
    groupCat.set(g.id, cat.id);
  }
}

async function _organize({ rediscover = false, categories = null, reason = '' } = {}) {
  const settings = await getSettings();
  if (!settings.enabled) return;
  const status = await deciderStatus(settings);
  if (!(await classifierReady(settings, status))) return { skipped: 'model-not-ready' };
  const st = await getState();
  ensureOther(st, settings);
  await adoptUserGroups(st);
  if (categories?.length) mergeCategories(st, categories, 'llm');

  // tabs sitting in an unnamed group the user made by hand, or pulled out by hand: leave them be
  const eligible = (tabs) => tabs.filter((t) => isGroupable(t) && !manualTabs.has(t.id) && (t.groupId === -1 || groupCat.has(t.groupId)));
  const all = await chrome.tabs.query({ windowType: 'normal' });
  const candidates = eligible(all);
  const now = Date.now();
  for (const t of all.filter((t) => isGroupable(t) && !manualTabs.has(t.id))) {
    const u = keyOf(t);
    if (!st.tabMeta[u]) st.tabMeta[u] = { firstSeen: now, lastAccessed: t.lastAccessed || now };
  }

  const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const focusedWindowId = focused?.id ?? null;
  // The tab the user is looking at is never re-decided (and, checked again just before grouping, never moved).
  const lookingAt = candidates.find((t) => t.active && t.windowId === focusedWindowId)?.id;
  const pages = onePerPage(decisionOrder(candidates, { activeTabIds: candidates.filter((t) => t.active).map((t) => t.id), focusedWindowId }));

  // The WebAssembly engine is slow, so it works through tabs a few at a time.
  let device = status.device;
  let used = 0;
  let more = false;
  const room = () => {
    if (device === 'wasm' && used >= SLOW_BUDGET) more = true;
    return !more;
  };
  let folders = null;
  // Ask about one page; `choose` turns the answer into the entry to keep. While the classifier
  // thinks, the user may place the page by hand (or something else may decide it): that wins.
  const ask = async (t, choose = (cur, next) => next) => {
    used++;
    const key = keyOf(t);
    const before = st.pageMap[key];
    const r = await decide(st, settings, t, () => (folders ||= bookmarkFolders().catch(() => [])));
    if (!device) device = (await deciderStatus(settings))?.device; // the engine picks its device when it loads
    const cur = st.pageMap[key];
    if (!r || cur?.fixed || (cur && cur !== before && (cur.at || 0) > (before?.at || 0))) return;
    st.pageMap[key] = choose(cur, r);
  };

  for (const [k, m] of Object.entries(st.pageMap)) if (!st.categories[m.catId]) delete st.pageMap[k];

  // --- 1. a site the user placed by hand fixes its pages without asking the classifier
  for (const t of pages) {
    const rule = st.siteRules[hostOf(realUrl(t))];
    if (!rule || !st.categories[rule.catId]) continue;
    const m = st.pageMap[keyOf(t)];
    if (m?.fixed && m.source === 'user') continue; // this very page was placed by hand
    if (m?.source !== 'site' || m.catId !== rule.catId) st.pageMap[keyOf(t)] = { catId: rule.catId, confidence: 1, source: 'site', at: now, fixed: true };
  }

  // --- 2. new pages, and pages whose details changed
  for (const t of pages) {
    const m = st.pageMap[keyOf(t)];
    if (m && (m.fixed || (m.sig || '') === detailsSig(st.tabMeta[keyOf(t)]?.details))) continue;
    if (!room()) break;
    await ask(t);
  }

  // --- 3. Other is filling up → find new folders in the tabs. Other's pages are already filed, so
  // the new folders reach them through step 4, at a quiet moment.
  const inOther = () => pages.filter((t) => {
    const m = st.pageMap[keyOf(t)];
    return m?.catId === OTHER_ID && !m.fixed;
  });
  if (settings.autoDiscover && inOther().length >= 3 && (rediscover || now - st.lastDiscovery > DISCOVER_EVERY) && room()) {
    const added = await discover(st, settings, pages, inOther());
    // pages decided earlier in this run, even within the same millisecond, were decided without these folders
    const latest = Math.max(0, ...Object.values(st.pageMap).map((m) => m.at || 0));
    for (const c of added) c.createdAt = Math.max(c.createdAt || 0, latest + 1);
  }

  // --- 4. new folders, reasons and profile edits reach filed pages only at a quiet moment, and only clearly better answers move them
  const changedAt = Math.max(0, st.profile.updatedAt || 0, ...realCats(st).map((c) => c.createdAt || 0), ...st.reasons.map((r) => r.at || 0));
  const stale = pages.filter((t) => {
    const m = st.pageMap[keyOf(t)];
    return m && !m.fixed && m.at < changedAt && t.id !== lookingAt;
  });
  const busySince = stale.length ? await activityAt() : 0;
  if (stale.length && Date.now() - busySince < QUIET_MS) {
    chrome.alarms.create('organize-quiet', { when: busySince + QUIET_MS + 5000 });
  } else {
    for (const t of stale) {
      if (!room()) break;
      await ask(t, (cur, next) => (shouldMove(cur, next, { cats: st.categories }) ? next : { ...cur, at: next.at }));
    }
  }
  if (more) chrome.alarms.create('organize-more', { delayInMinutes: 0.5 });

  // --- 5. pinned tabs and the Daily group. The tabs are read again, as the classifier may have taken
  // a while and the user may have moved, closed or switched tabs.
  let live = await chrome.tabs.query({ windowType: 'normal' });
  followPins(st, live, await pinTabs(), now);
  const looking = await lookingAtNow();
  const { daily, changed } = await applyPins(st, settings, live, eligible(live), looking, now);
  if (changed) live = await chrome.tabs.query({ windowType: 'normal' });
  await rememberPinTabs(st, live);
  if (daily.size) ensureDaily(st);

  // --- 6. folders → groups: the lowest-ranked fold into their parents. Daily pages show in Daily.
  const fresh = eligible(live);
  const idOf = (t) => (daily.has(keyOf(t)) ? DAILY_ID : st.pageMap[keyOf(t)]?.catId);
  const counts = new Map();
  for (const t of fresh) {
    const id = idOf(t);
    if (st.categories[id]) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const plan = planGroups(Object.values(st.categories), counts, settings.maxGroups);
  const byWindow = new Map();
  for (const t of fresh) {
    const id = idOf(t);
    if (!st.categories[id]) continue; // the decider could not place it: leave the tab be
    const catId = plan.get(id) || OTHER_ID;
    if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, new Map());
    const m = byWindow.get(t.windowId);
    if (!m.has(catId)) m.set(catId, []);
    m.get(catId).push(t);
  }

  // --- 7. apply to Chrome tab groups, per window
  for (const [windowId, cats] of byWindow) {
    const groups = await chrome.tabGroups.query({ windowId });
    const gidFor = new Map();
    for (const g of groups) {
      const cid = groupCat.get(g.id);
      if (cid && !gidFor.has(cid)) gidFor.set(cid, g.id);
    }
    for (const [catId, tabs] of cats) {
      const cat = st.categories[catId];
      const title = groupTitle(cat, st.profile);
      let gid = gidFor.get(catId);
      const pending = tabs.filter((t) => gid === undefined || t.groupId !== gid);
      const looking = pending.length ? await lookingAtNow() : undefined;
      const moving = pending.filter((t) => t.id !== looking).map((t) => t.id);
      try {
        if (gid === undefined) {
          if (!moving.length) continue;
          moving.forEach((id) => expectedGroupChange.set(id, '*'));
          gid = await chrome.tabs.group({ tabIds: moving, createProperties: { windowId } });
          groupCat.set(gid, catId);
          gidFor.set(catId, gid);
          cat.shownTitle = title;
          await chrome.tabGroups.update(gid, { title, color: cat.color });
        } else {
          if (moving.length) {
            moving.forEach((id) => expectedGroupChange.set(id, gid));
            await chrome.tabs.group({ tabIds: moving, groupId: gid });
          }
          const g = groups.find((x) => x.id === gid);
          if (g && (g.title !== title || g.color !== cat.color)) {
            cat.shownTitle = title;
            await chrome.tabGroups.update(gid, { title, color: cat.color });
          }
        }
      } catch (e) {
        console.warn('[TabSage] grouping failed (user dragging?)', e.message);
      }
    }
  }

  // --- 8. tidy: decisions for closed pages (hand-placed ones are kept), and stale categories
  const open = new Set(all.map(keyOf));
  for (const [k, m] of Object.entries(st.pageMap)) if (!m.fixed && !open.has(k)) delete st.pageMap[k];
  const mapped = new Set([st.siteRules, st.pageMap].flatMap((m) => Object.values(m).map((x) => x.catId)));
  for (const c of realCats(st)) {
    if (!c.pinned && !mapped.has(c.id) && now - c.createdAt > 14 * 864e5) delete st.categories[c.id];
  }

  st.stats = { organizedAt: now, lastEngine, reason };
  await updateState(() => {}, { immediate: true });
  await sortAll();
}

const pinnable = (t) => !t.incognito && isGroupable({ ...t, pinned: false });

/**
 * Pin and unpin tabs by how much their pages are used; returns the pages for the Daily group.
 * Pages the user pinned or placed by hand are left alone, and so is the tab being looked at.
 */
async function applyPins(st, settings, live, fresh, looking, now) {
  const open = [];
  for (const t of live) if (t.pinned && pinnable(t)) open.push({ key: keyOf(t), tabId: t.id, pinned: true, userPinned: !st.ourPins[keyOf(t)] });
  for (const t of fresh) {
    const m = st.pageMap[keyOf(t)];
    if (m?.fixed && m.source === 'user') continue;
    open.push({ key: keyOf(t), tabId: t.id, pinned: false, userPinned: false, inDaily: groupCat.get(t.groupId) === DAILY_ID });
  }
  const plan = planPins(open, st.usage, {
    now, pinMax: settings.pinnedMax, dailyMax: settings.dailyMax, ourPins: st.ourPins, cooldown: st.pinCooldown,
  });
  let changed = false;
  for (const key of plan.unpin) {
    for (const t of live.filter((x) => x.pinned && x.id !== looking && keyOf(x) === key)) {
      expectedUnpin.add(t.id);
      try {
        await chrome.tabs.update(t.id, { pinned: false });
        delete st.ourPins[key];
        changed = true;
      } catch (e) {
        expectedUnpin.delete(t.id);
        console.warn('[TabSage] unpin failed', e.message);
      }
    }
  }
  for (const key of plan.pin) {
    const t = fresh.find((x) => x.id !== looking && keyOf(x) === key);
    if (!t) continue;
    // pinning takes the tab out of its group, which is not the user pulling it out
    if (t.groupId !== -1) expectedGroupChange.set(t.id, '*');
    try {
      await chrome.tabs.update(t.id, { pinned: true });
      st.ourPins[key] = now;
      changed = true;
    } catch (e) {
      expectedGroupChange.delete(t.id);
      console.warn('[TabSage] pin failed', e.message);
    }
  }
  return { daily: new Set(plan.daily), changed };
}

// tabId -> page for the tabs we pinned, kept in session storage so a closed or navigated tab can be
// traced back to its page. Session storage is emptied when the browser restarts.
async function pinTabs() {
  return (await chrome.storage.session?.get('ourPinTabs').catch(() => null))?.ourPinTabs || {};
}

const savePinTabs = (tabs) => chrome.storage.session?.set({ ourPinTabs: tabs }).catch(() => {});

async function rememberPinTabs(st, live) {
  const tabs = {};
  for (const t of live) if (t.pinned && st.ourPins[keyOf(t)]) tabs[t.id] = keyOf(t);
  await savePinTabs(tabs);
}

// A tab we pinned that moved to another page (a link clicked in a pinned web app) is still our pin:
// the pin follows the tab, and the new page keeps the old one's standing. Pages we pinned earlier this
// session that no pinned tab holds any more are forgotten, so a later pin of yours there is yours.
function followPins(st, live, pinned, now) {
  for (const t of live) {
    const from = pinned[t.id];
    const to = keyOf(t);
    if (!t.pinned || !from || from === to || !st.ourPins[from]) continue;
    st.ourPins[to] = st.ourPins[from];
    st.usage = carryUse(st.usage, from, to, now);
  }
  const held = new Set(live.filter((t) => t.pinned).map(keyOf));
  for (const key of Object.values(pinned)) if (!held.has(key)) delete st.ourPins[key];
}

/** A pinned tab went to another page: if we had pinned it, the pin follows the tab. */
export async function notePinnedNavigated(tab) {
  const pinned = await pinTabs();
  if (!pinned[tab.id]) return;
  const live = await chrome.tabs.query({ windowType: 'normal' });
  if (!live.some((t) => t.id === tab.id)) live.push(tab);
  const now = Date.now();
  const st = await updateState((st) => {
    followPins(st, live.map((t) => (t.id === tab.id ? tab : t)), pinned, now);
    return st;
  });
  const tabs = {};
  for (const [id, key] of Object.entries(pinned)) if (Number(id) !== tab.id) tabs[id] = key;
  if (st.ourPins[keyOf(tab)]) tabs[tab.id] = keyOf(tab);
  await savePinTabs(tabs);
}

/** A tab was closed: if it held a page we pinned, that page stays unpinned for a while. */
export async function noteTabClosed(tabId) {
  const pinned = await pinTabs();
  const key = pinned[tabId];
  if (!key) return;
  delete pinned[tabId];
  await savePinTabs(pinned);
  await dropPin(key);
}

/** A tab was unpinned: if we did not do it and we had pinned that page, it stays unpinned for a while. */
export async function noteUnpinned(tab) {
  if (expectedUnpin.delete(tab.id)) return;
  const pinned = await pinTabs();
  const key = pinned[tab.id] || keyOf(tab);
  if (pinned[tab.id]) {
    delete pinned[tab.id];
    await savePinTabs(pinned);
  }
  await dropPin(key);
}

async function dropPin(key) {
  await updateState((st) => {
    if (!st.ourPins[key]) return;
    delete st.ourPins[key];
    st.pinCooldown = startCooldown(st.pinCooldown, key, Date.now());
  });
}

/** groupId → catId, recovering from a service-worker restart via the group title. */
export async function catForGroup(groupId) {
  if (groupId == null || groupId === -1) return null;
  if (groupCat.has(groupId)) return groupCat.get(groupId);
  try {
    const g = await chrome.tabGroups.get(groupId);
    const cat = g.title && catByTitle(await getState(), g.title);
    if (cat) {
      groupCat.set(groupId, cat.id);
      return cat.id;
    }
  } catch {}
  return null;
}

/** The user moved a tab into one of our groups: that page stays there, and the tab asks why. */
export async function learnFromUser(tab, groupId) {
  // a move you make is final: any question about an earlier move is withdrawn first
  await withdrawWhy(tab.id);
  if (groupId === -1) {
    manualTabs.add(tab.id);
    return;
  }
  manualTabs.delete(tab.id);
  const url = realUrl(tab);
  const d = hostOf(url);
  const catId = await catForGroup(groupId);
  if (!catId || !d) return;
  // a page you put in Daily yourself stays there, outside the ranking (and is not asked why)
  const st = await updateState((st) => {
    st.pageMap[pageKey(url)] = { catId, confidence: 1, source: 'user', at: Date.now(), fixed: true };
    return st;
  });
  if (tab.active && !tab.incognito) await askWhy(tab, st.categories[catId], st.profile, d);
  organize({ reason: 'user-move' });
}

const WHY_MS = 10 * 60 * 1000; // an answer that comes later than this is not taken
// tabId -> the question its "Why?" card is showing. Kept in session storage too, as the service
// worker may restart while the user types an answer.
const whyAsked = new Map();

// Show the "Why?" card in the tab, injected only now. The answers stay here; the card only learns
// their labels and sends back the id of the one chosen.
async function askWhy(tab, cat, profile, host) {
  if (!cat || cat.id === DAILY_ID) return;
  const options = whyOptions(cat, profile, host);
  const ask = { url: pageKey(realUrl(tab)), catId: cat.id, options, at: Date.now() };
  whyAsked.set(tab.id, ask);
  await chrome.storage.session?.set({ [`why${tab.id}`]: ask }).catch(() => {});
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['why.js'] });
    await chrome.tabs.sendMessage(tab.id, {
      target: 'why',
      question: `Why does this belong in ${groupTitle(cat, profile)}?`,
      options: options.map(({ id, label }) => ({ id, label })),
    });
  } catch {} // pages the extension may not script (the Web Store, chrome:// pages)
}

// Forget the question a tab was asked, and take its card off the page.
async function withdrawWhy(tabId) {
  const k = `why${tabId}`;
  const asked = whyAsked.delete(tabId) || (await chrome.storage.session?.get(k).catch(() => null))?.[k];
  if (!asked) return;
  await chrome.storage.session?.remove(k).catch(() => {});
  await chrome.tabs.sendMessage(tabId, { target: 'why', close: true }).catch(() => {});
}

async function takeWhy(tabId) {
  const k = `why${tabId}`;
  let ask = whyAsked.get(tabId);
  if (!ask) ask = (await chrome.storage.session?.get(k).catch(() => null))?.[k];
  whyAsked.delete(tabId);
  await chrome.storage.session?.remove(k).catch(() => {});
  return ask && Date.now() - ask.at < WHY_MS ? ask : null;
}

/** The answer from a tab's "Why?" card. Only the question that tab was asked, for the page it is still on, counts. */
export async function saveWhy(tab, { optionId, text } = {}) {
  const ask = await takeWhy(tab.id);
  if (!ask || pageKey(realUrl(tab)) !== ask.url) return false;
  const opt = ask.options.find((o) => o.id === optionId);
  const typed = typeof text === 'string' ? text.trim() : '';
  if (!opt && !typed) return false;
  const saved = await updateState((st) => {
    if (!st.categories[ask.catId]) return false;
    applyReason(st, { url: ask.url, catId: ask.catId, optionId: opt?.id || 'text', text: typed || opt.text, scope: opt?.scope || 'page' });
    return true;
  }, { immediate: true });
  if (saved) organize({ reason: 'why' });
  return saved;
}
