// A tab pulled out of a group by hand stays out after the service worker restarts, and incognito
// tabs are neither decided, remembered nor learnt from.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = {
  state: {
    categories: { c1: { id: 'c1', name: 'Projects', kind: 'personal', parentId: null, color: 'blue', pinned: false, lastActive: 0, createdAt: Date.now() } },
    schemaVersion: 2,
  },
};
const session = {};
const grouped = [];
let tabs = [];
globalThis.chrome = {
  storage: {
    local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) },
    session: {
      get: async (k) => ({ [k]: structuredClone(session[k]) }),
      set: async (o) => Object.assign(session, structuredClone(o)),
      remove: async (k) => { delete session[k]; },
    },
  },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  scripting: { executeScript: async () => {} },
  tabs: {
    query: async () => tabs,
    group: async (o) => { grouped.push(o); return o.groupId ?? 70; },
    sendMessage: async () => {},
  },
  tabGroups: { query: async () => [], update: async () => {}, get: async () => ({}) },
  windows: { getAll: async () => [], getLastFocused: async () => ({ id: 9, focused: true }) },
  alarms: { create: () => {} },
};

const { organize, learnFromUser, manualTabs, clearManual } = await import('../src/lib/organizer.js');
const { setAiForTest } = await import('../src/lib/ai.js');
const { getState } = await import('../src/lib/store.js');

const asked = [];
setAiForTest(async (type, payload) => {
  if (type === 'decider.status') return { downloaded: true, device: 'webgpu' };
  if (type === 'decider.choice') {
    asked.push(payload.state);
    return { labels: payload.options.map((o) => o.name), choice: 'Projects', confidence: 0.9 };
  }
  return { error: 'not in test' };
});

const groupedTab = (id) => grouped.some((g) => g.tabIds.includes(id));

test('a tab pulled out of its group by hand is not put back after the worker restarts', async () => {
  tabs = [{ id: 1, windowId: 1, url: 'https://a.example.com/projects', title: 'Projects board', groupId: -1 }];
  await learnFromUser(tabs[0], -1);
  manualTabs.clear(); // the worker restarted: memory is empty, session storage is not
  await organize({ reason: 'after-restart' });
  assert.ok(!groupedTab(1), 'the tab the user pulled out was grouped again');

  // once it goes to another page it is TabSage's to file again
  await clearManual(1);
  manualTabs.clear();
  await organize({ reason: 'navigated' });
  assert.ok(groupedTab(1), 'a tab that moved on was never filed again');
});

test('incognito tabs are not decided, remembered or learnt from', async () => {
  grouped.length = 0;
  asked.length = 0;
  const secret = 'https://secret.example.com/projects';
  tabs = [{ id: 5, windowId: 2, url: secret, title: 'Projects secret', groupId: -1, incognito: true }];
  await organize({ reason: 'incognito' });
  const st = await getState();
  assert.equal(asked.length, 0, 'an incognito page was decided');
  assert.equal(st.pageMap[secret], undefined);
  assert.equal(st.tabMeta[secret], undefined);
  assert.ok(!groupedTab(5));

  const { groupCat } = await import('../src/lib/organizer.js');
  groupCat.set(80, 'c1');
  await learnFromUser({ ...tabs[0], groupId: 80 }, 80);
  assert.equal(st.pageMap[secret], undefined, 'a move by hand in incognito was written down');
  assert.ok(!JSON.stringify(store.state).includes('secret.example.com'), 'the incognito address reached storage');
});
