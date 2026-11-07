// Your most recently used tabs never move, and other tabs only move once the tab bar has been left
// alone, so Ctrl+Tab still finds the tab you were just on.
import test from 'node:test';
import assert from 'node:assert/strict';

const MIN = 60000;
const store = {
  state: {
    categories: { t: { id: 't', name: 'Travel', description: 'trips', kind: 'personal', parentId: null, color: 'blue', pinned: false, lastActive: 0, createdAt: 0 } },
    schemaVersion: 2,
  },
};
const alarms = [];
const grouped = [];
const moved = [];
let tabs = [];
let groups = [];
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) } },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: {
    query: async (q = {}) => tabs.filter((t) => (q.windowId === undefined || t.windowId === q.windowId) && (q.groupId === undefined || t.groupId === q.groupId) && (q.active === undefined || t.active === q.active)),
    group: async (o) => { grouped.push(...o.tabIds); for (const t of tabs) if (o.tabIds.includes(t.id)) t.groupId = o.groupId ?? 100; return o.groupId ?? 100; },
    get: async (id) => tabs.find((t) => t.id === id),
    move: async (id, o) => { moved.push(['tab', id, o.index]); },
  },
  tabGroups: { query: async () => groups, update: async () => {}, get: async (id) => groups.find((g) => g.id === id) || {}, move: async (id, o) => { moved.push(['group', id, o.index]); } },
  windows: { getAll: async () => [{ id: 1 }], getLastFocused: async () => ({ id: 9, focused: true }) },
  alarms: { create: (name, o) => alarms.push([name, o]) },
};

const { markActivity, organize, groupCat } = await import('../src/lib/organizer.js');
const { sortAll } = await import('../src/lib/sorter.js');
const { setAiForTest } = await import('../src/lib/ai.js');
const { getState } = await import('../src/lib/store.js');

setAiForTest(async (type, payload) => {
  if (type === 'decider.status') return { downloaded: true, device: 'webgpu' };
  if (type === 'decider.choice') return { labels: payload.options.map((o) => o.name), choice: 'Travel', confidence: 0.9 };
  return { error: 'not in test' };
});

const now = Date.now();
const tab = (id, extra = {}) => ({ id, windowId: 1, url: `https://trip.example.com/${id}`, title: `Travel day ${id}`, groupId: -1, index: id, ...extra });
const reset = () => {
  grouped.length = moved.length = alarms.length = 0;
  groups = [];
  groupCat.clear();
};

test('while you are busy nothing is grouped, and a run is booked for when the tab bar goes quiet', async () => {
  reset();
  tabs = [tab(1), tab(2), tab(3)];
  markActivity(Date.now() - 30 * 1000);
  await organize({ reason: 'busy' });
  assert.deepEqual(grouped, [], 'tabs were grouped while you were busy');
  assert.ok(alarms.some(([name]) => name === 'organize-quiet'), 'no run was booked for later');
});

test('once quiet, other tabs are grouped but your most recently used ones stay where they are', async () => {
  reset();
  // keepRecent is 5 by default: tabs 6-10 were used most recently, 1-5 earlier
  tabs = Array.from({ length: 10 }, (_, i) => tab(i + 1, { lastAccessed: now - (10 - i) * MIN }));
  markActivity(Date.now() - 60 * MIN);
  await organize({ reason: 'quiet' });
  assert.deepEqual(grouped.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test('the sorter waits for a quiet tab bar, and never reorders a group holding a recent tab', async () => {
  reset();
  const st = await getState();
  st.categories.w = { id: 'w', name: 'Work', kind: 'personal', parentId: null, color: 'red', pinned: false, createdAt: 0 };
  groups = [{ id: 11, windowId: 1, title: 'Travel' }, { id: 12, windowId: 1, title: 'Work' }];
  groupCat.set(11, 't');
  groupCat.set(12, 'w');
  // group 11 holds a recent tab (2); group 12 holds only old tabs, in the wrong order by title
  tabs = [
    tab(1, { groupId: 11, index: 0, title: 'b', lastAccessed: now - 90 * MIN }),
    tab(2, { groupId: 11, index: 1, title: 'a', lastAccessed: now - MIN }),
    tab(3, { groupId: 12, index: 2, title: 'z', lastAccessed: 0 }),
    tab(4, { groupId: 12, index: 3, title: 'y', lastAccessed: 0 }),
  ];
  store.settings = { tabSort: 'title', groupSort: 'manual', keepRecent: 1 };

  markActivity(Date.now() - 10 * 1000);
  await sortAll();
  assert.deepEqual(moved, [], 'the sorter moved tabs while you were busy');

  markActivity(Date.now() - 60 * MIN);
  await sortAll();
  assert.ok(!moved.some(([kind, id]) => (kind === 'tab' && (id === 1 || id === 2)) || (kind === 'group' && id === 11)), `the group with your recent tab was rearranged: ${JSON.stringify(moved)}`);
  assert.ok(moved.some(([kind, id]) => kind === 'tab' && (id === 3 || id === 4)), 'the other group was not sorted');
  delete store.settings;
});
