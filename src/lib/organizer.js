// The organizer: domain clusters → categories → Chrome tab groups.

import { getSettings, getState, updateState } from './store.js';
import { domainKey, isGroupable, realTitle, realUrl } from './urls.js';
import { OTHER_ID, ensureOther, findByName, mergeCategories, seedList } from './categories.js';
import { heuristicAssign, heuristicDiscover, hostHint } from './heuristics.js';
import { ai } from './ai.js';
import { sortAll } from './sorter.js';

// Tab group changes we caused (so they aren't mistaken for the user teaching us).
export const expectedGroupChange = new Map(); // tabId -> groupId | '*'
// Tabs the user pulled out of a group by hand this session: leave them alone.
export const manualTabs = new Set();
// groupId -> catId for this browser session (group ids are not stable across restarts).
export const groupCat = new Map();

let chain = Promise.resolve();
export let lastEngine = '';

/** Serialize organize runs. */
export function organize(opts = {}) {
  const run = chain.then(() => _organize(opts)).catch((e) => console.error('[TabSage] organize failed', e));
  chain = run;
  return run;
}

function clusterTabs(tabs, settings) {
  const clusters = new Map();
  for (const t of tabs) {
    const url = realUrl(t);
    const d = domainKey(url, settings.domainKey);
    if (!d) continue;
    if (!clusters.has(d)) clusters.set(d, { domain: d, tabs: [] });
    clusters.get(d).tabs.push(t);
  }
  return clusters;
}

function clusterState(c) {
  const titles = [...new Set(c.tabs.map((t) => realTitle(t).trim()).filter(Boolean))].slice(0, 12);
  return `Website: ${c.domain}\nOpen tabs on this website:\n${titles.map((t) => `- ${t.slice(0, 110)}`).join('\n') || '- (untitled)'}`;
}

async function discover(st, settings, tabs, mode) {
  const items = tabs.map((t) => ({ domain: domainKey(realUrl(t), settings.domainKey), title: realTitle(t) }));
  const existing = Object.values(st.categories).filter((c) => c.id !== OTHER_ID).map((c) => ({ name: c.name, description: c.description }));
  let found = null;
  let engine = 'heuristic';
  if (settings.useLLM) {
    try {
      const r = await ai('llm.discover', { items, existing, max: settings.maxGroups, mode });
      if (!r.error) {
        found = r.categories;
        engine = 'llm';
      }
    } catch (e) {
      console.warn('[TabSage] LLM discovery failed, using keywords', e);
    }
  }
  if (!found) found = mode === 'incremental' ? [] : heuristicDiscover(items, settings.maxGroups);
  mergeCategories(st, [...seedList(settings), ...found], engine);
  st.lastDiscovery = Date.now();
  console.info(`[TabSage] discovery (${mode}, ${engine}):`, found.map((c) => c.name));
  return found;
}

/** Choose a category for one domain cluster. */
async function assign(st, settings, cluster, cats) {
  const other = st.categories[OTHER_ID];
  const options = [...cats.filter((c) => c.id !== OTHER_ID).slice(0, 20), other];
  if (options.length === 1) return { catId: OTHER_ID, confidence: 1, source: 'none' };
  const state = clusterState(cluster);
  const mk = (cat, confidence, source) => ({ catId: cat?.id || OTHER_ID, confidence, source });

  // 1) Strands Decider (WebGPU)
  try {
    const r = await ai('decider.choice', {
      settings, state,
      instructions: 'Which folder should these browser tabs go in?',
      options: options.map((c) => ({ name: c.name, description: c.description })),
    }, 30 * 60 * 1000);
    if (!r.error) {
      lastEngine = 'decider';
      const cat = options[r.labels.indexOf(r.choice)];
      if (r.confidence < settings.minConfidence) return mk(other, r.confidence, 'decider');
      return mk(cat, r.confidence, 'decider');
    }
  } catch (e) {
    console.warn('[TabSage] decider failed', e);
  }
  // 2) Built-in LLM
  if (settings.useLLM) {
    try {
      const r = await ai('llm.assign', { state, names: options.map((c) => c.name) });
      if (!r.error) {
        lastEngine = 'llm';
        return mk(findByName(st, r.folder) || other, 0.5, 'llm');
      }
    } catch (e) {
      console.warn('[TabSage] llm assign failed', e);
    }
  }
  // 3) Keywords / host hints
  lastEngine = 'heuristic';
  const titles = cluster.tabs.map(realTitle);
  const h = heuristicAssign(cluster.domain, titles, options.filter((c) => c.id !== OTHER_ID));
  if (h) return mk(h, 0.3, 'heuristic');
  const hint = hostHint(cluster.domain);
  if (hint) {
    const [cat] = mergeCategories(st, [{ name: hint, description: `${hint} sites` }], 'heuristic');
    return mk(cat, 0.3, 'heuristic');
  }
  return mk(other, 0, 'heuristic');
}

/** Adopt user-created, named groups as categories (and teach their domains). */
async function adoptUserGroups(st, settings) {
  const groups = await chrome.tabGroups.query({});
  for (const g of groups) {
    if (groupCat.has(g.id)) {
      // keep category name in sync with user renames
      const cat = st.categories[groupCat.get(g.id)];
      if (cat && g.title && cat.name !== g.title && cat.id !== OTHER_ID) cat.name = g.title;
      continue;
    }
    if (!g.title) continue;
    let cat = findByName(st, g.title);
    if (!cat) [cat] = mergeCategories(st, [{ name: g.title, description: '', color: g.color }], 'user');
    groupCat.set(g.id, cat.id);
  }
}

async function _organize({ rediscover = false, categories = null, reassign = null, reason = '' } = {}) {
  const settings = await getSettings();
  if (!settings.enabled) return;
  const st = await getState();
  ensureOther(st, settings);
  await adoptUserGroups(st, settings);

  const all = await chrome.tabs.query({ windowType: 'normal' });
  const groupable = all.filter((t) => isGroupable(t) && !manualTabs.has(t.id));
  // tabs sitting in an unnamed group the user made by hand: leave them be
  const unknownGroup = (t) => t.groupId !== -1 && !groupCat.has(t.groupId);
  const candidates = groupable.filter((t) => !unknownGroup(t));
  const now = Date.now();
  for (const t of groupable) {
    const u = realUrl(t);
    if (!st.tabMeta[u]) st.tabMeta[u] = { firstSeen: now, lastAccessed: t.lastAccessed || now };
  }

  // --- 1. discovery (single pass over titles)
  if (categories?.length) mergeCategories(st, categories, 'llm');
  const realCats = () => Object.values(st.categories).filter((c) => c.id !== OTHER_ID);
  if (rediscover || realCats().length === 0) {
    if (candidates.length) await discover(st, settings, candidates, 'full');
    if (rediscover) {
      for (const [d, m] of Object.entries(st.domainMap)) if (m.source !== 'user') delete st.domainMap[d];
    }
  }

  // --- 2. assignment, one decision per domain (same domain always groups together)
  const clusters = clusterTabs(candidates, settings);
  const counts = () => {
    const n = new Map();
    for (const c of clusters.values()) {
      const id = st.domainMap[c.domain]?.catId;
      if (id) n.set(id, (n.get(id) || 0) + c.tabs.length);
    }
    return n;
  };
  const rankedCats = () => {
    const n = counts();
    return realCats().sort((a, b) => (b.pinned - a.pinned) || ((n.get(b.id) || 0) - (n.get(a.id) || 0)) || a.name.localeCompare(b.name));
  };
  const needs = (c) => {
    const m = st.domainMap[c.domain];
    if (!m || !st.categories[m.catId]) return true;
    if (reassign && m.source === reassign) return true;
    return false;
  };
  for (const c of clusters.values()) {
    if (!needs(c)) continue;
    const r = await assign(st, settings, c, rankedCats());
    st.domainMap[c.domain] = { ...r, at: Date.now() };
  }

  // --- 3. Other is filling up → incremental discovery, then re-ask for those domains
  if (settings.autoDiscover) {
    const otherClusters = [...clusters.values()].filter((c) => st.domainMap[c.domain]?.catId === OTHER_ID && st.domainMap[c.domain]?.source !== 'user');
    const otherTabs = otherClusters.flatMap((c) => c.tabs);
    if (otherTabs.length >= settings.otherRediscoverThreshold && otherClusters.length >= 3 && now - st.lastDiscovery > 10 * 60 * 1000) {
      const added = await discover(st, settings, otherTabs, 'incremental');
      if (added.length) for (const c of otherClusters) st.domainMap[c.domain] = { ...(await assign(st, settings, c, rankedCats())), at: Date.now() };
    }
  }

  // --- 4. only the top N categories get their own group
  const n = counts();
  const ranked = rankedCats().filter((c) => (n.get(c.id) || 0) > 0);
  const pinned = ranked.filter((c) => c.pinned);
  const keep = new Set([...pinned, ...ranked.filter((c) => !c.pinned).slice(0, Math.max(0, settings.maxGroups - pinned.length))].map((c) => c.id));
  const effective = (domain) => {
    const id = st.domainMap[domain]?.catId || OTHER_ID;
    return keep.has(id) ? id : OTHER_ID;
  };

  // --- 5. apply to Chrome tab groups, per window
  const byWindow = new Map();
  for (const c of clusters.values()) {
    const catId = effective(c.domain);
    for (const t of c.tabs) {
      if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, new Map());
      const m = byWindow.get(t.windowId);
      if (!m.has(catId)) m.set(catId, []);
      m.get(catId).push(t);
    }
  }
  for (const [windowId, cats] of byWindow) {
    const groups = await chrome.tabGroups.query({ windowId });
    const gidFor = new Map();
    for (const g of groups) {
      const cid = groupCat.get(g.id);
      if (cid && !gidFor.has(cid)) gidFor.set(cid, g.id);
    }
    for (const [catId, tabs] of cats) {
      const cat = st.categories[catId];
      let gid = gidFor.get(catId);
      const moving = tabs.filter((t) => t.groupId !== gid || gid === undefined).map((t) => t.id);
      try {
        if (gid === undefined) {
          moving.forEach((id) => expectedGroupChange.set(id, '*'));
          gid = await chrome.tabs.group({ tabIds: moving, createProperties: { windowId } });
          groupCat.set(gid, catId);
          gidFor.set(catId, gid);
          await chrome.tabGroups.update(gid, { title: cat.name, color: cat.color });
        } else {
          if (moving.length) {
            moving.forEach((id) => expectedGroupChange.set(id, gid));
            await chrome.tabs.group({ tabIds: moving, groupId: gid });
          }
          const g = groups.find((x) => x.id === gid);
          if (g && (g.title !== cat.name || g.color !== cat.color)) await chrome.tabGroups.update(gid, { title: cat.name, color: cat.color });
        }
      } catch (e) {
        console.warn('[TabSage] grouping failed (user dragging?)', e.message);
      }
    }
  }

  // --- 6. tidy stale categories (no tabs, no mappings, not pinned, > 14 days)
  const mapped = new Set(Object.values(st.domainMap).map((m) => m.catId));
  for (const c of realCats()) {
    if (!c.pinned && !mapped.has(c.id) && now - c.createdAt > 14 * 864e5) delete st.categories[c.id];
  }

  st.stats = { organizedAt: now, lastEngine, reason };
  await updateState(() => {}, { immediate: true });
  await sortAll();
}

/** groupId → catId, recovering from a service-worker restart via the group title. */
export async function catForGroup(groupId) {
  if (groupId == null || groupId === -1) return null;
  if (groupCat.has(groupId)) return groupCat.get(groupId);
  try {
    const g = await chrome.tabGroups.get(groupId);
    const cat = g.title && findByName(await getState(), g.title);
    if (cat) {
      groupCat.set(groupId, cat.id);
      return cat.id;
    }
  } catch {}
  return null;
}

/** The user moved a tab into one of our groups: remember that for its whole domain. */
export async function learnFromUser(tab, groupId) {
  const settings = await getSettings();
  const d = domainKey(realUrl(tab), settings.domainKey);
  if (groupId === -1) {
    manualTabs.add(tab.id);
    return;
  }
  manualTabs.delete(tab.id);
  const catId = await catForGroup(groupId);
  if (!catId || !d) return;
  await updateState((st) => {
    st.domainMap[d] = { catId, confidence: 1, source: 'user', at: Date.now() };
  });
  organize({ reason: 'user-move' });
}
