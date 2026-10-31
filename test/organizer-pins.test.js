// Most-used pages are pinned or shown in Daily, but never while the classifier is missing, never the
// tab being looked at, and never a pin the user made.
import test from 'node:test';
import assert from 'node:assert/strict';

const DAY = 864e5;
const store = { state: { categories: {}, schemaVersion: 2 } };
const session = {};
const updated = [];
const grouped = [];
const collapsedCalls = [];
const moved = [];
let ready = true;
let groups = [];
let nextGid = 100;
let tabs = [];
globalThis.chrome = {
  storage: {
    local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) },
    session: { get: async (k) => (k in session ? { [k]: session[k] } : {}), set: async (o) => Object.assign(session, o) },
  },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: {
    query: async () => structuredClone(tabs),
    group: async (o) => {
      grouped.push(o);
      const gid = o.groupId ?? nextGid++;
      if (o.groupId === undefined) groups.push({ id: gid, windowId: 1, title: '', color: '' });
      for (const t of tabs) if (o.tabIds.includes(t.id)) t.groupId = gid;
      return gid;
    },
    get: async (id) => structuredClone(tabs.find((x) => x.id === id)),
    move: async () => {},
    update: async (id, o) => {
      updated.push([id, o]);
      const t = tabs.find((x) => x.id === id);
      Object.assign(t, o);
      if (o.pinned) t.groupId = -1;
    },
  },
  tabGroups: {
    query: async () => structuredClone(groups),
    update: async (gid, o) => {
      if ('collapsed' in o) collapsedCalls.push([gid, o.collapsed]);
      Object.assign(groups.find((g) => g.id === gid) || {}, o);
    },
    get: async (id) => groups.find((g) => g.id === id) || {},
    move: async (gid, o) => { moved.push([gid, o.index]); },
  },
  windows: { getAll: async () => [{ id: 1 }], getLastFocused: async () => ({ id: 1, focused: true }) },
  alarms: { create: () => {} },
  bookmarks: { getTree: async () => [] },
};

const { setAiForTest } = await import('../src/lib/ai.js');
const { getState } = await import('../src/lib/store.js');
const { recordUse } = await import('../src/lib/usage.js');
const { sortAll } = await import('../src/lib/sorter.js');
const { organize, noteTabClosed, noteUnpinned, notePinnedNavigated, learnFromUser, groupCat } = await import('../src/lib/organizer.js');

setAiForTest(async (type, payload) => {
  if (type === 'decider.status') return { downloaded: ready, device: 'webgpu' };
  if (type === 'decider.choice') {
    const labels = payload.options.map((o) => o.name);
    return { labels, choice: labels.at(-1), confidence: 0.9 };
  }
  return { error: 'not in test' };
});

const url = (n) => `https://site${n}.example.com/`;
const tab = (n, extra = {}) => ({ id: n, windowId: 1, url: url(n), title: `Site ${n}`, groupId: -1, active: false, pinned: false, ...extra });
const reset = async (tabList, uses = {}) => {
  const st = await getState();
  st.categories = {};
  st.pageMap = {};
  st.usage = {};
  st.ourPins = {};
  st.pinCooldown = {};
  for (const [n, count] of Object.entries(uses)) for (let i = 0; i < count; i++) st.usage = recordUse(st.usage, url(n), Date.now());
  updated.length = grouped.length = collapsedCalls.length = moved.length = 0;
  groups = [];
  groupCat.clear();
  ready = true;
  tabs = tabList;
  delete session.ourPinTabs;
  return st;
};

test('the most-used pages are pinned and the next tier goes in a Daily group', async () => {
  const st = await reset([1, 2, 3, 4, 5, 6, 7, 8].map((n) => tab(n)), { 1: 80, 2: 70, 3: 60, 4: 50, 5: 40, 6: 30, 7: 20, 8: 0 });
  await organize({ reason: 'test' });
  assert.deepEqual(tabs.filter((t) => t.pinned).map((t) => t.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(Object.keys(st.ourPins).sort(), [1, 2, 3, 4, 5].map(url).sort());
  const dailyGid = groupCat.entries().find(([, c]) => c === 'daily')[0];
  assert.deepEqual(tabs.filter((t) => t.groupId === dailyGid).map((t) => t.id), [6, 7]);
  assert.equal(st.categories.daily.kind, 'daily');
  assert.ok(!tabs.find((t) => t.id === 8).pinned);
});

test('nothing is pinned or put in Daily while the classifier is not downloaded', async () => {
  await reset([tab(1), tab(2)], { 1: 10, 2: 10 });
  ready = false;
  await organize({ reason: 'test' });
  assert.deepEqual(updated, []);
  assert.deepEqual(grouped, []);
});

test('the tab being looked at is not pinned', async () => {
  await reset([tab(1, { active: true }), tab(2)], { 1: 50, 2: 10 });
  await organize({ reason: 'test' });
  assert.ok(!tabs[0].pinned);
  assert.ok(tabs[1].pinned);
});

test('a pin the user made is never unpinned, even when the page is not used', async () => {
  const st = await reset([tab(1, { pinned: true }), tab(2)], { 2: 10 });
  await organize({ reason: 'test' });
  assert.ok(tabs[0].pinned);
  assert.ok(!updated.some(([id, o]) => id === 1 && o.pinned === false));
  assert.equal(st.ourPins[url(1)], undefined);
});

test('a page we pinned that falls out of the top is unpinned', async () => {
  const st = await reset([tab(1, { pinned: true }), tab(2), tab(3)], { 1: 1, 2: 40, 3: 30 });
  st.ourPins[url(1)] = Date.now() - DAY;
  const settings = (await chrome.storage.local.get('settings')).settings;
  store.settings = { ...settings, pinnedMax: 2 };
  await organize({ reason: 'test' });
  delete store.settings;
  assert.deepEqual(tabs.filter((t) => t.pinned).map((t) => t.id), [2, 3]);
  assert.equal(st.ourPins[url(1)], undefined);
  assert.equal(st.pinCooldown[url(1)], undefined, 'our own unpin is not a reason to keep the page unpinned');
});

test('closing or unpinning a page we pinned keeps it unpinned for a while', async () => {
  const st = await reset([tab(1), tab(2)], { 1: 50, 2: 40 });
  await organize({ reason: 'test' });
  assert.ok(tabs.every((t) => t.pinned));
  assert.deepEqual(Object.keys(session.ourPinTabs).map(Number).sort(), [1, 2]);

  await noteTabClosed(1);
  assert.ok(st.pinCooldown[url(1)] > Date.now() + 2 * DAY);
  assert.equal(st.ourPins[url(1)], undefined);

  await noteUnpinned({ ...tab(2), pinned: false });
  assert.ok(st.pinCooldown[url(2)] > Date.now() + 2 * DAY);

  await noteUnpinned(tab(9)); // a page we never pinned
  assert.equal(st.pinCooldown[url(9)], undefined);
});

test('a page in its cooldown is not pinned again', async () => {
  const st = await reset([tab(1)], { 1: 50 });
  st.pinCooldown[url(1)] = Date.now() + DAY;
  await organize({ reason: 'test' });
  assert.ok(!tabs[0].pinned);
});

test('the Daily group sorts first and is never collapsed', async () => {
  const st = await reset([tab(1, { pinned: true }), tab(2, { groupId: 11, index: 1 }), tab(3, { groupId: 12, index: 2 })]);
  tabs.forEach((t, i) => { t.index = i; });
  st.categories.c1 = { id: 'c1', name: 'Work', description: '', color: 'blue', pinned: true, kind: 'personal', parentId: null };
  st.categories.daily = { id: 'daily', name: 'Daily', description: '', color: 'grey', pinned: false, kind: 'daily', parentId: null };
  groups = [{ id: 11, windowId: 1, title: 'Work', collapsed: false }, { id: 12, windowId: 1, title: 'Daily', collapsed: true }];
  store.settings = { ...(store.settings || {}), collapseInactiveGroups: true };
  await sortAll();
  delete store.settings;
  assert.deepEqual(moved[0], [12, 1], 'Daily was not moved to just after the pinned tabs');
  assert.ok(!collapsedCalls.some(([gid, collapsed]) => gid === 12 && collapsed), 'Daily was collapsed');
  assert.ok(collapsedCalls.some(([gid, collapsed]) => gid === 12 && !collapsed === true), 'a collapsed Daily was not opened');
});

const withSettings = async (patch, fn) => {
  store.settings = { ...(await chrome.storage.local.get('settings')).settings, ...patch };
  try { await fn(); } finally { delete store.settings; }
};

test('a pin we made follows its tab to a new page, and a later pin of yours on the old page stays yours', async () => {
  const st = await reset([tab(1), tab(2), tab(3)], { 1: 50, 2: 1, 3: 1 });
  await withSettings({ pinnedMax: 1, dailyMax: 0 }, async () => {
    await organize({ reason: 'test' });
    assert.deepEqual(tabs.filter((t) => t.pinned).map((t) => t.id), [1]);

    tabs[0].url = 'https://site1.example.com/inbox/42'; // a link followed inside the pinned tab
    await organize({ reason: 'test' });
    assert.deepEqual(Object.keys(st.ourPins), ['https://site1.example.com/inbox/42']);
    assert.deepEqual(session.ourPinTabs, { 1: 'https://site1.example.com/inbox/42' });
    assert.ok(tabs[0].pinned, 'the moved tab keeps its standing and is not unpinned at once');

    tabs.push(tab(4, { pinned: true })); // you pin the old page yourself
    for (let i = 0; i < 200; i++) st.usage = recordUse(st.usage, url(2), Date.now());
    updated.length = 0;
    await organize({ reason: 'test' });
    assert.ok(!tabs[0].pinned, 'our pin, now on a new page, can still be unpinned');
    assert.ok(tabs.find((t) => t.id === 4).pinned);
    assert.ok(!updated.some(([id, o]) => id === 4 && o.pinned === false), 'your own pin was unpinned');
    assert.deepEqual(st.ourPins, {});
  });
});

test('a pin we made that moved page and is then closed or unpinned still starts the cooldown', async () => {
  const st = await reset([tab(1), tab(2)], { 1: 50, 2: 40 });
  await organize({ reason: 'test' });
  assert.ok(tabs.every((t) => t.pinned));

  const moved1 = 'https://site1.example.com/inbox/42';
  tabs[0].url = moved1;
  await notePinnedNavigated(structuredClone(tabs[0])); // before any organize run
  assert.ok(st.ourPins[moved1]);
  assert.equal(st.ourPins[url(1)], undefined);
  await noteTabClosed(1);
  assert.ok(st.pinCooldown[moved1] > Date.now() + 2 * DAY);
  assert.equal(st.ourPins[moved1], undefined);

  tabs[1].url = 'https://site2.example.com/later';
  await notePinnedNavigated(structuredClone(tabs[1]));
  await noteUnpinned({ ...tabs[1], pinned: false });
  assert.ok(st.pinCooldown['https://site2.example.com/later'] > Date.now() + 2 * DAY);
  assert.deepEqual(st.ourPins, {});
});

test('a tab you put in Daily yourself stays there', async () => {
  const st = await reset([tab(1), tab(2), tab(3), tab(4)], { 1: 50, 2: 20, 4: 10 });
  await withSettings({ pinnedMax: 0, dailyMax: 2 }, async () => {
    await organize({ reason: 'test' });
    const dgid = [...groupCat.entries()].find(([, c]) => c === 'daily')[0];
    assert.deepEqual(tabs.filter((t) => t.groupId === dgid).map((t) => t.id), [1, 2]);

    tabs[2].groupId = dgid; // "Add tab to group > Daily" on a tab never used, into a full Daily
    await learnFromUser(structuredClone(tabs[2]), dgid);
    await organize({ reason: 'test' });
    assert.equal(tabs[2].groupId, dgid, 'your tab was moved out of Daily');
    assert.deepEqual(tabs.filter((t) => t.groupId === dgid).map((t) => t.id), [1, 2, 3], 'your tab pushed one out of Daily');
    assert.equal(st.pageMap[url(3)].source, 'user');
  });
});
