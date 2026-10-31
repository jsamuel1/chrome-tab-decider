// Discovery from the user's own tabs, calm re-deciding, and the slow-engine budget.
import test from 'node:test';
import assert from 'node:assert/strict';

const MIN = 60000;
const store = { state: { categories: {}, schemaVersion: 2 } };
const alarms = [];
let nextGid = 100;
let tabs = [];
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) } },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: { query: async () => tabs, group: async (o) => o.groupId ?? nextGid++ },
  tabGroups: { query: async () => [], update: async () => {}, get: async () => ({}) },
  windows: { getAll: async () => [], getLastFocused: async () => ({ id: 1, focused: true }) },
  alarms: { create: (name, o) => alarms.push([name, o]) },
};

const { organize, markActivity } = await import('../src/lib/organizer.js');
const { setAiForTest } = await import('../src/lib/ai.js');
const { getState } = await import('../src/lib/store.js');

let device = 'webgpu';
const calls = [];
setAiForTest(async (type, payload) => {
  calls.push([type, payload]);
  if (type === 'decider.status') return { downloaded: true, device };
  if (type === 'decider.noul') {
    const yes = payload.instructions.includes('"Acme"') ? 0.9 : 0.1;
    return { labels: ['true', 'false'], probs: [yes, 1 - yes] };
  }
  if (type === 'decider.choice') {
    const labels = payload.options.map((o) => o.name);
    const pick = payload.state.includes('Acme') && labels.includes('Acme') ? 'Acme'
      : payload.state.includes('Kyoto') && labels.includes('Travel') ? 'Travel' : labels.at(-1);
    return { labels, choice: pick, confidence: 0.9 };
  }
  return { error: 'not in test' };
});
const count = (type) => calls.filter(([t]) => t === type).length;

const tab = (id, title, url, extra = {}) => ({ id, windowId: 1, url, title, groupId: -1, ...extra });

test('Other filling up finds a folder in the tabs themselves and files them there', async () => {
  tabs = [
    tab(1, 'Acme quarterly review', 'https://docs.example.com/1'),
    tab(2, 'Acme invoices', 'https://billing.example.org/2'),
    tab(3, 'Acme roadmap', 'https://wiki.example.net/3'),
    tab(4, 'Sourdough recipe', 'https://bread.example.com/4'),
    tab(5, 'Bike repair', 'https://bikes.example.com/5'),
    tab(6, 'Weather', 'https://weather.example.com/6'),
  ];
  await organize({ reason: 'test' });
  const st = await getState();
  const acme = Object.values(st.categories).find((c) => c.name === 'Acme');
  assert.ok(acme, 'no Acme folder was created');
  assert.equal(acme.isNew, true);
  assert.ok(calls.some(([t, p]) => t === 'decider.noul' && p.instructions === 'Would "Acme" be a sensible name for a folder holding these browser tabs?'));
  for (const u of ['https://docs.example.com/1', 'https://billing.example.org/2', 'https://wiki.example.net/3']) {
    assert.equal(st.pageMap[u].catId, acme.id, `${u} was not filed in Acme`);
  }
  assert.equal(st.pageMap['https://bread.example.com/4'].catId, 'other');
  // rejected names do not become folders
  assert.equal(Object.values(st.categories).filter((c) => c.isNew).length, 1);
});

test('a new folder is applied to filed pages only once the tab bar has been quiet for 2 minutes', async () => {
  const st = await getState();
  tabs = [tab(7, 'Kyoto hotel', 'https://hotels.example.com/7'), tab(8, 'Kyoto temples', 'https://temples.example.com/8', { active: true })];
  st.pageMap['https://hotels.example.com/7'] = { catId: 'other', confidence: 0.5, source: 'decider', at: 1 };
  st.pageMap['https://temples.example.com/8'] = { catId: 'other', confidence: 0.5, source: 'decider', at: 1 };
  st.categories.t = { id: 't', name: 'Travel', description: 'trips', color: 'blue', pinned: false, lastActive: 0, createdAt: Date.now(), kind: 'personal', parentId: null };
  calls.length = 0;
  alarms.length = 0;

  markActivity(Date.now());
  await organize({ reason: 'busy' });
  assert.equal(count('decider.choice'), 0, 'filed pages were re-decided while the user was busy');
  assert.ok(alarms.some(([name]) => name === 'organize-quiet'), 'no quiet-time run was scheduled');

  markActivity(Date.now() - 3 * MIN);
  await organize({ reason: 'quiet' });
  assert.equal(st.pageMap['https://hotels.example.com/7'].catId, 't');
  // the active tab of the focused window is never re-decided
  assert.equal(st.pageMap['https://temples.example.com/8'].catId, 'other');
  assert.equal(count('decider.choice'), 1);
});

test('on the slow engine at most 5 tabs are decided per run, and another run is scheduled', async () => {
  device = 'wasm';
  tabs = Array.from({ length: 7 }, (_, i) => tab(20 + i, `Kyoto day ${i}`, `https://trip.example.com/${i}`));
  calls.length = 0;
  alarms.length = 0;
  markActivity(Date.now());
  await organize({ reason: 'slow' });
  assert.equal(count('decider.choice'), 5);
  assert.ok(alarms.some(([name]) => name === 'organize-more'), 'no follow-up run was scheduled');
  await organize({ reason: 'more' });
  assert.equal(count('decider.choice'), 7);
  const st = await getState();
  for (let i = 0; i < 7; i++) assert.equal(st.pageMap[`https://trip.example.com/${i}`].catId, 't');
});
