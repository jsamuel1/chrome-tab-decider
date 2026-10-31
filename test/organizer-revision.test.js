// Decisions made by an older version of the deciding logic are decided again at a quiet moment,
// so an update that improves deciding also reaches tabs already filed in Other.
import test from 'node:test';
import assert from 'node:assert/strict';

const MIN = 60000;
const DAY = 864e5;
const store = { state: { categories: {}, schemaVersion: 2 } };
let tabs = [];
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) } },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: { query: async () => tabs, group: async (o) => o.groupId ?? 100 },
  tabGroups: { query: async () => [], update: async () => {}, get: async () => ({}) },
  windows: { getAll: async () => [], getLastFocused: async () => ({ id: 1, focused: true }) },
  alarms: { create: () => {} },
};

const { organize, markActivity } = await import('../src/lib/organizer.js');
const { setAiForTest } = await import('../src/lib/ai.js');
const { getState } = await import('../src/lib/store.js');
const { saveProfile } = await import('../src/lib/onboarding.js');

const asked = [];
setAiForTest(async (type, payload) => {
  if (type === 'decider.status') return { downloaded: true, device: 'webgpu' };
  if (type === 'decider.choice') {
    asked.push(payload);
    const labels = payload.options.map((o) => o.name);
    return { labels, choice: 'Amazon', confidence: 0.9 };
  }
  return { error: 'not in test' };
});

test('a page filed in Other by the old deciding logic is decided again, and lands in the company folder', async () => {
  const st = await getState();
  saveProfile(st, { company: 'Amazon', companyDomains: ['amazon.com'], categories: [] }, Date.now() - DAY);
  const url = 'https://phonetool.amazon.com/users/jsamuel';
  // filed after every profile and folder change, but by a version that predates decision versions
  st.pageMap[url] = { catId: 'other', confidence: 0.2, source: 'decider', at: Date.now() + MIN, sig: '', fixed: false };
  tabs = [{ id: 1, windowId: 1, url, title: 'Phonetool', groupId: -1 }];

  markActivity(Date.now() - 3 * MIN);
  await organize({ reason: 'quiet' });
  assert.equal(asked.length, 1, 'the old decision was not decided again');
  const company = Object.values(st.categories).find((c) => c.kind === 'company');
  assert.equal(st.pageMap[url].catId, company.id);
  assert.ok(asked[0].options.some((o) => o.name === 'Amazon' && /amazon\.com/.test(o.description)), 'the company folder was not offered with its description');

  markActivity(Date.now() - 3 * MIN);
  await organize({ reason: 'again' });
  assert.equal(asked.length, 1, 'a current decision was decided again');
});

test('an old decision that the new logic does not beat is kept, and not asked about again', async () => {
  const st = await getState();
  const url = 'https://docs.example.org/plan';
  st.pageMap[url] = { catId: 'other', confidence: 0.85, source: 'decider', at: Date.now() + MIN, sig: '', fixed: false };
  tabs = [{ id: 2, windowId: 1, url, title: 'Plan', groupId: -1 }];
  const before = asked.length;

  markActivity(Date.now() - 3 * MIN);
  await organize({ reason: 'quiet' });
  assert.equal(asked.length, before + 1, 'the old decision was not decided again');
  assert.equal(st.pageMap[url].catId, 'other', 'a not-clearly-better answer moved the page');

  markActivity(Date.now() - 3 * MIN);
  await organize({ reason: 'again' });
  assert.equal(asked.length, before + 1, 'a kept decision was asked about again (it would loop)');
});
