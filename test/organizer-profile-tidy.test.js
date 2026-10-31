// Profile edits reach filed pages at a quiet moment; the tidy keeps the folders the user set up, and
// does not keep a site rule's entries for pages that are closed.
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

const states = [];
setAiForTest(async (type, payload) => {
  if (type === 'decider.status') return { downloaded: true, device: 'webgpu' };
  if (type === 'decider.choice') {
    states.push(payload.state);
    const labels = payload.options.map((o) => o.name);
    // once the profile says the user works on robots, robot pages are work for Acme
    const pick = payload.state.includes('robots') && labels.includes('Acme') ? 'Acme' : labels.at(-1);
    return { labels, choice: pick, confidence: pick === 'Acme' ? 0.95 : 0.5 };
  }
  return { error: 'not in test' };
});

const tab = (id, title, url, extra = {}) => ({ id, windowId: 1, url, title, groupId: -1, ...extra });

test('a profile edit makes filed pages stale: they are decided again once the tab bar is quiet', async () => {
  const st = await getState();
  saveProfile(st, { company: 'Acme', work: 'gardening', categories: [] }, Date.now() - DAY);
  tabs = [tab(1, 'Acme robot arm firmware', 'https://example.com/robot'), tab(2, 'Lunch menu', 'https://food.example.com/')];
  markActivity(Date.now() - 3 * MIN);
  await organize({ reason: 'first' });
  assert.equal(st.pageMap['https://example.com/robot'].catId, 'other');
  const decided = states.length;

  // saving the very same answers again changes nothing, so nothing is decided again
  saveProfile(st, { company: 'Acme', work: 'gardening', categories: [] });
  await organize({ reason: 'same-profile' });
  assert.equal(states.length, decided, 'an unchanged profile re-decided filed pages');

  saveProfile(st, { company: 'Acme', work: 'building robots', categories: [] });
  assert.ok(st.profile.updatedAt > st.pageMap['https://example.com/robot'].at, 'the edit was not dated');
  markActivity(Date.now());
  await organize({ reason: 'busy' });
  assert.equal(states.length, decided, 'filed pages were re-decided while the user was busy');

  markActivity(Date.now() - 3 * MIN);
  await organize({ reason: 'quiet' });
  assert.ok(states.length > decided, 'no filed page was decided again after the profile edit');
  const acme = Object.values(st.categories).find((c) => c.kind === 'company');
  assert.equal(st.pageMap['https://example.com/robot'].catId, acme.id, 'the clearly better answer did not move the page');
});

test('the tidy keeps the company folder, project folders and chosen categories, even when empty for weeks', async () => {
  const st = await getState();
  saveProfile(st, { company: 'Acme', work: 'building robots', projects: ['Payroll'], categories: ['Travel'] });
  st.categories.gone = { id: 'gone', name: 'Kyoto', kind: 'personal', parentId: null, source: 'discovered', createdAt: 0, color: 'red' };
  for (const c of Object.values(st.categories)) c.createdAt = Date.now() - 30 * DAY;
  tabs = [tab(2, 'Lunch menu', 'https://food.example.com/')];
  for (const k of Object.keys(st.pageMap)) delete st.pageMap[k];
  await organize({ reason: 'tidy' });
  const names = Object.values(st.categories).map((c) => c.name);
  for (const n of ['Acme', 'Payroll', 'Travel']) assert.ok(names.includes(n), `${n} was tidied away`);
  assert.ok(!names.includes('Kyoto'), 'a stale folder TabSage found itself was kept');
});

test('pages on a site with a rule are forgotten once closed; pages placed by hand are kept', async () => {
  const st = await getState();
  const travel = Object.values(st.categories).find((c) => c.name === 'Travel');
  st.siteRules['trips.example.com'] = { catId: travel.id, reasonId: '' };
  st.pageMap['https://hand.example.com/kept'] = { catId: travel.id, confidence: 1, source: 'user', at: 1, fixed: true };
  tabs = [tab(3, 'Trip A', 'https://trips.example.com/a'), tab(4, 'Trip B', 'https://trips.example.com/b')];
  await organize({ reason: 'open' });
  assert.equal(st.pageMap['https://trips.example.com/a'].source, 'site');
  tabs = [tab(3, 'Trip A', 'https://trips.example.com/a')];
  await organize({ reason: 'closed' });
  assert.equal(st.pageMap['https://trips.example.com/b'], undefined, 'a closed page on a ruled site stayed in pageMap');
  assert.equal(st.pageMap['https://trips.example.com/a'].catId, travel.id);
  assert.ok(st.pageMap['https://hand.example.com/kept'], 'a page placed by hand was forgotten');
});
