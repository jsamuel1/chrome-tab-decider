// A large tab set on the GPU: a run decides a batch, groups it straight away, and leaves the rest to
// another run, so grouping (and the runs queued behind) never waits for the whole set.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = {
  state: {
    categories: { t: { id: 't', name: 'Travel', description: 'trips', kind: 'personal', parentId: null, color: 'blue', pinned: false, lastActive: 0, createdAt: 0 } },
    schemaVersion: 2,
  },
};
const alarms = [];
const grouped = [];
const tabs = Array.from({ length: 70 }, (_, i) => ({ id: i + 1, windowId: 1, url: `https://trip.example.com/${i}`, title: `Travel day ${i}`, groupId: -1 }));
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) } },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: { query: async () => tabs, group: async (o) => { grouped.push(...o.tabIds); return o.groupId ?? 100; } },
  tabGroups: { query: async () => [], update: async () => {}, get: async () => ({}) },
  windows: { getAll: async () => [], getLastFocused: async () => ({ id: 9, focused: true }) },
  alarms: { create: (name, o) => alarms.push([name, o]) },
};

const { organize } = await import('../src/lib/organizer.js');
const { setAiForTest } = await import('../src/lib/ai.js');

let decided = 0;
setAiForTest(async (type, payload) => {
  if (type === 'decider.status') return { downloaded: true, device: 'webgpu' };
  if (type === 'decider.choice') {
    decided++;
    return { labels: payload.options.map((o) => o.name), choice: 'Travel', confidence: 0.9 };
  }
  return { error: 'not in test' };
});

test('on the GPU a run decides a batch, groups it, and schedules another run for the rest', async () => {
  await organize({ reason: 'first-run' });
  assert.ok(decided > 0 && decided < tabs.length, `${decided} of ${tabs.length} tabs were decided in one run`);
  assert.equal(grouped.length, decided, 'the decided batch was not grouped in the same run');
  assert.ok(alarms.some(([name]) => name === 'organize-more'), 'no follow-up run was scheduled');
  const first = decided;
  await organize({ reason: 'organize-more' });
  await organize({ reason: 'organize-more' });
  assert.ok(decided > first);
  assert.equal(decided, tabs.length, 'later runs did not finish the set');
});
