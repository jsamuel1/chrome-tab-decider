// The organizer decides each page on its own, honours hand-made corrections kept in siteRules,
// and does not re-decide a page whose address only changes after "#".
import test from 'node:test';
import assert from 'node:assert/strict';

const DAY = 864e5;
const store = {
  state: {
    categories: {
      c1: { id: 'c1', name: 'Work', color: 'blue', pinned: false, lastActive: 0, createdAt: 0 },
      c2: { id: 'c2', name: 'Fun', color: 'red', pinned: false, lastActive: 0, createdAt: 0 },
      c3: { id: 'c3', name: 'Old', color: 'green', pinned: false, lastActive: 0, createdAt: Date.now() - 30 * DAY },
    },
    // saved by the site-based version: two hand-made corrections and one classifier decision
    domainMap: {
      'a.com': { catId: 'c1', source: 'user', at: 1 },
      'gone.com': { catId: 'c3', source: 'user', at: 1 },
      'b.com': { catId: 'c2', source: 'decider', at: 1 },
    },
  },
};
const grouped = [];
const titles = new Map();
const alarms = [];
let nextGid = 100;
const tabs = [
  { id: 1, windowId: 1, url: 'https://a.com/x', title: 'A page', groupId: -1 },
  { id: 2, windowId: 1, url: 'https://b.com/y#inbox', title: 'B page', groupId: -1 },
];
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) } },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: {
    query: async () => tabs,
    group: async (o) => { const gid = o.groupId ?? nextGid++; grouped.push({ ...o, gid }); return gid; },
  },
  tabGroups: { query: async () => [], update: async (gid, o) => { titles.set(gid, o.title); }, get: async () => ({}) },
  windows: { getAll: async () => [], getLastFocused: async () => ({ id: 9, focused: true }) },
  alarms: { create: (name, o) => alarms.push([name, o]) },
};

const { organize, learnFromUser, groupCat } = await import('../src/lib/organizer.js');
const { setAiForTest } = await import('../src/lib/ai.js');
const { getState, migrate } = await import('../src/lib/store.js');

const asked = [];
setAiForTest(async (type, payload) => {
  if (type === 'decider.status') return { downloaded: true, device: 'webgpu' };
  if (type === 'decider.choice') {
    asked.push(payload.state);
    return { labels: payload.options.map((o) => o.name), choice: 'Fun', confidence: 0.9 };
  }
  return { error: 'not in test' };
});

test('a host the user placed by hand is fixed without asking the classifier', async () => {
  await organize({ reason: 'test' });
  const st = await getState();
  assert.equal(st.siteRules['a.com'].catId, 'c1');
  assert.ok(!asked.some((s) => s.includes('a.com')), 'classifier was asked about a.com');
  assert.equal(asked.length, 1, 'only b.com should have been decided');
  assert.deepEqual(
    { catId: st.pageMap['https://a.com/x'].catId, fixed: st.pageMap['https://a.com/x'].fixed },
    { catId: 'c1', fixed: true },
  );
  assert.equal(st.pageMap['https://b.com/y'].catId, 'c2');
  assert.equal(st.domainMap, undefined);
  const groupOf = (tabId) => titles.get(grouped.findLast((g) => g.tabIds.includes(tabId)).gid);
  assert.equal(groupOf(1), 'Work');
  assert.equal(groupOf(2), 'Fun');
});

test('a tab whose address changes only after "#" is not decided again', async () => {
  tabs[1].url = 'https://b.com/y#sent';
  tabs[1].title = 'B page (sent)';
  await organize({ reason: 'hash-change' });
  assert.equal(asked.length, 1, 'the page was decided again');
});

test('a category only a site rule points to is not tidied away', async () => {
  const st = await getState();
  assert.ok(st.categories.c3, 'the category of a hand-made correction was deleted');
  assert.equal(st.reasons.find((r) => r.id === st.siteRules['gone.com'].reasonId).catId, 'c3');
});

test('a correction made by hand survives a restart, and so do the classifier decisions', async () => {
  groupCat.set(200, 'c2');
  await learnFromUser(tabs[0], 200);
  await organize({ reason: 'after-move' });
  const saved = migrate(structuredClone(store.state)); // what getState builds after a restart
  assert.equal(saved.siteRules['a.com'].catId, 'c2');
  assert.equal(saved.pageMap['https://a.com/x'].catId, 'c2');
  assert.equal(saved.pageMap['https://a.com/x'].fixed, true);
  assert.equal(saved.pageMap['https://b.com/y']?.source, 'decider', 'the classifier decisions were thrown away on restart');
});
