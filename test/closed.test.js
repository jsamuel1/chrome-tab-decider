// Reopening a tab TabSage closed brings back its Back history when Chrome still has it in recently closed.
import test from 'node:test';
import assert from 'node:assert/strict';

const calls = { restore: [], create: [] };
let recent = [];
const store = { state: { archive: [], tabMeta: {}, categories: {}, schemaVersion: 2 } };
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) } },
  runtime: { getURL: (p) => `chrome-extension://x/${p}`, id: 'x' },
  sessions: {
    getRecentlyClosed: async () => recent,
    restore: async (sessionId) => { calls.restore.push(sessionId); return { tab: { id: 77, url: 'restored' } }; },
  },
  tabs: { create: async (o) => { calls.create.push(o); return { id: 88 }; }, query: async () => [] },
  tabGroups: { query: async () => [] },
  windows: { getAll: async () => [] },
  alarms: { create: () => {} },
};

const { closedTabFor } = await import('../src/lib/closed.js');
const { reopenArchived } = await import('../src/lib/archive.js');
const { getState } = await import('../src/lib/store.js');

const { lazyUrl } = await import('../src/lib/urls.js');
const lazy = (u) => lazyUrl({ url: u, title: 'x' });

test('the newest closed tab on the page is chosen; whole closed windows are not', () => {
  const entries = [
    { lastModified: 30, window: { sessionId: 'w1', tabs: [{ url: 'https://a.com/x', sessionId: 'wt' }] } },
    { lastModified: 20, tab: { url: 'https://a.com/x', sessionId: 's2' } },
    { lastModified: 10, tab: { url: 'https://a.com/x', sessionId: 's1' } },
    { lastModified: 25, tab: { url: 'https://b.com/', sessionId: 's3' } },
  ];
  assert.equal(closedTabFor(entries, 'https://a.com/x'), 's2');
  assert.equal(closedTabFor(entries, 'https://c.com/'), null);
});

test('a closed placeholder tab matches the page it stood for', () => {
  assert.equal(closedTabFor([{ lastModified: 1, tab: { url: lazy('https://a.com/x'), sessionId: 's9' } }], 'https://a.com/x'), 's9');
});

test('reopening restores the closed tab, with its history, when Chrome still has it', async () => {
  const st = await getState();
  st.archive = [{ id: 'a1', url: 'https://a.com/x', title: 'A', favIconUrl: '' }];
  recent = [{ lastModified: 5, tab: { url: 'https://a.com/x', sessionId: 's5' } }];
  calls.restore.length = calls.create.length = 0;
  assert.equal(await reopenArchived('a1'), 77);
  assert.deepEqual(calls.restore, ['s5']);
  assert.deepEqual(calls.create, [], 'a fresh tab was opened instead of restoring');
  assert.equal(st.archive.length, 0);
});

test('when Chrome no longer has it, a fresh tab is opened as before', async () => {
  const st = await getState();
  st.archive = [{ id: 'a2', url: 'https://a.com/old', title: 'Old', favIconUrl: '' }];
  recent = [];
  calls.restore.length = calls.create.length = 0;
  assert.equal(await reopenArchived('a2'), 88);
  assert.deepEqual(calls.restore, []);
  assert.equal(calls.create[0].url, 'https://a.com/old');
});

test('reopening in the background still opens a placeholder, not the closed tab', async () => {
  const st = await getState();
  st.archive = [{ id: 'a3', url: 'https://a.com/x', title: 'A', favIconUrl: '' }];
  recent = [{ lastModified: 5, tab: { url: 'https://a.com/x', sessionId: 's5' } }];
  calls.restore.length = calls.create.length = 0;
  await reopenArchived('a3', { lazy: true });
  assert.deepEqual(calls.restore, []);
  assert.match(calls.create[0].url, /lazy\.html/);
});
