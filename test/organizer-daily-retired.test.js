// The Daily group was replaced by the Recent side panel. After the update its tabs are taken out of
// the old group once, and the group is not mistaken for one you named yourself.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = {
  state: {
    categories: {
      t: { id: 't', name: 'Travel', description: 'trips', kind: 'personal', parentId: null, color: 'blue', pinned: false, lastActive: 0, createdAt: 0 },
      daily: { id: 'daily', name: 'Daily', description: 'the pages you use most', kind: 'daily', parentId: null, color: 'grey', pinned: false, lastActive: 0, createdAt: 0 },
    },
    schemaVersion: 2,
  },
};
const ungrouped = [];
let tabs = [
  { id: 1, windowId: 1, url: 'https://trip.example.com/1', title: 'Travel day 1', groupId: 70, index: 0 },
  { id: 2, windowId: 1, url: 'https://trip.example.com/2', title: 'Travel day 2', groupId: 70, index: 1 },
];
let groups = [{ id: 70, windowId: 1, title: 'Daily', color: 'grey' }];
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) } },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: {
    query: async (q = {}) => tabs.filter((t) => q.groupId === undefined || t.groupId === q.groupId),
    group: async (o) => o.groupId ?? 100,
    ungroup: async (ids) => {
      ungrouped.push(...ids);
      for (const t of tabs) if (ids.includes(t.id)) t.groupId = -1;
      groups = groups.filter((g) => tabs.some((t) => t.groupId === g.id));
    },
  },
  tabGroups: { query: async () => groups, update: async () => {}, get: async (id) => groups.find((g) => g.id === id) || {} },
  windows: { getAll: async () => [], getLastFocused: async () => ({ id: 9, focused: true }) },
  alarms: { create: () => {} },
};

const { markActivity, organize } = await import('../src/lib/organizer.js');
const { setAiForTest } = await import('../src/lib/ai.js');
const { getState } = await import('../src/lib/store.js');

setAiForTest(async (type, payload) => {
  if (type === 'decider.status') return { downloaded: true, device: 'webgpu' };
  if (type === 'decider.choice') return { labels: payload.options.map((o) => o.name), choice: 'Travel', confidence: 0.9 };
  return { error: 'not in test' };
});

test('the old Daily group is emptied once, and Daily does not come back as a folder', async () => {
  markActivity(Date.now() - 60 * 60000);
  await organize({ reason: 'after-update' });
  const st = await getState();
  assert.deepEqual(ungrouped.sort(), [1, 2], 'the tabs were not taken out of the old Daily group');
  assert.ok(!Object.values(st.categories).some((c) => c.name === 'Daily'), 'Daily came back as a folder');

  ungrouped.length = 0;
  groups = [{ id: 71, windowId: 1, title: 'Daily', color: 'grey' }];
  tabs[0].groupId = 71;
  await organize({ reason: 'later' });
  assert.deepEqual(ungrouped, [], 'a group you named Daily yourself, later, was emptied');
});
