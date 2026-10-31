// Until the classifier is downloaded, TabSage must not move, group, pin or name any tab.
import test from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
const record = (name) => async (...args) => { calls.push([name, ...args]); return 1; };
const store = {};
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: {
    query: async () => [{ id: 1, windowId: 1, url: 'https://example.com/a', title: 'A', groupId: -1 }],
    group: record('tabs.group'),
    update: record('tabs.update'),
    move: record('tabs.move'),
  },
  tabGroups: { query: async () => [], update: record('tabGroups.update'), move: record('tabGroups.move') },
  windows: { getAll: async () => { calls.push(['windows.getAll']); return [{ id: 1 }]; } },
};

const { organize, classifierReady } = await import('../src/lib/organizer.js');
const { setAiForTest } = await import('../src/lib/ai.js');
const { sortAll } = await import('../src/lib/sorter.js');

test('organize does nothing while the classifier is not downloaded', async () => {
  const asked = [];
  setAiForTest(async (type) => {
    asked.push(type);
    if (type === 'decider.status') return { downloaded: false };
    throw new Error(`unexpected ${type}`);
  });
  assert.equal(await classifierReady({}), false);
  assert.deepEqual(await organize({ reason: 'test' }), { skipped: 'model-not-ready' });
  assert.deepEqual(calls, []);
  assert.ok(asked.every((t) => t === 'decider.status'));
});

test('classifierReady is true once downloaded, and false if the engine cannot be reached', async () => {
  setAiForTest(async () => ({ downloaded: true }));
  assert.equal(await classifierReady({}), true);
  setAiForTest(async () => { throw new Error('offscreen gone'); });
  assert.equal(await classifierReady({}), false);
});

test('sortAll does not reorder or collapse anything while the classifier is not downloaded', async () => {
  setAiForTest(async () => ({ downloaded: false }));
  calls.length = 0;
  await sortAll();
  assert.deepEqual(calls, []);
});
