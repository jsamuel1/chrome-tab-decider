// Moving a tab by hand fixes that page and asks why; only the answer to that question is saved.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = {
  state: {
    categories: {
      c1: { id: 'c1', name: 'Projects', kind: 'work', color: 'blue', pinned: false, lastActive: 0, createdAt: Date.now() },
    },
    profile: { company: 'Acme', companyDomains: [], projects: [], onboarded: true },
    schemaVersion: 2,
  },
};
const session = {};
const injected = [];
const sent = [];
const tabs = [{ id: 1, windowId: 1, url: 'https://docs.acme.com/a', title: 'A page', groupId: 50, active: true }];
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
  scripting: { executeScript: async (o) => { injected.push(o); } },
  tabs: { query: async () => tabs, group: async () => 50, sendMessage: async (id, msg) => { sent.push([id, msg]); } },
  tabGroups: { query: async () => [{ id: 50, windowId: 1, title: 'Acme · Projects', color: 'blue' }], update: async () => {}, get: async () => ({}) },
  windows: { getLastFocused: async () => ({ id: 1 }), getAll: async () => [] },
  alarms: { create: () => {} },
};

const { learnFromUser, saveWhy, groupCat } = await import('../src/lib/organizer.js');
const { setAiForTest } = await import('../src/lib/ai.js');
const { getState } = await import('../src/lib/store.js');
setAiForTest(async (type) => (type === 'decider.status' ? { downloaded: true, device: 'webgpu' } : { error: 'not in test' }));

test('moving a tab fixes the page, binds no site, and shows the card in that tab', async () => {
  groupCat.set(50, 'c1');
  await learnFromUser(tabs[0], 50);
  const st = await getState();
  assert.equal(st.pageMap['https://docs.acme.com/a'].fixed, true);
  assert.deepEqual(st.siteRules, {});
  assert.deepEqual(injected, [{ target: { tabId: 1 }, files: ['why.js'] }]);
  const [[tabId, msg]] = sent;
  assert.equal(tabId, 1);
  assert.equal(msg.question, 'Why does this belong in Acme · Projects?');
  assert.deepEqual(msg.options.map((o) => o.label), ["Part of Projects", "It's for Acme", 'Everything on docs.acme.com, not just this page']);
  assert.ok(msg.options.every((o) => !('scope' in o)), 'the page learns more than the labels');
});

test('an answer the tab was not offered is ignored, and so is a second answer', async () => {
  const st = await getState();
  assert.equal(await saveWhy({ ...tabs[0], url: 'https://elsewhere.com/' }, { optionId: 'site' }), false, 'an answer from another page was taken');
  assert.deepEqual(st.reasons, []);

  await learnFromUser(tabs[0], 50);
  assert.equal(await saveWhy(tabs[0], { optionId: 'made-up' }), false);
  await learnFromUser(tabs[0], 50);
  assert.equal(await saveWhy(tabs[0], { optionId: 'site' }), true);
  assert.equal(st.siteRules['docs.acme.com'].catId, 'c1');
  assert.equal(st.reasons.length, 1);
  assert.equal(await saveWhy(tabs[0], { optionId: 'site' }), false, 'the same question was answered twice');
});

test('a tab moved in the background, or in an incognito window, is not asked why', async () => {
  injected.length = 0;
  await learnFromUser({ ...tabs[0], active: false }, 50);
  await learnFromUser({ ...tabs[0], incognito: true }, 50);
  assert.deepEqual(injected, []);
});
