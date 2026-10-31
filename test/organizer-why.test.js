// Moving a tab by hand fixes that page and asks why; only the answer to that question is saved.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = {
  state: {
    categories: {
      c1: { id: 'c1', name: 'Projects', kind: 'work', color: 'blue', pinned: false, lastActive: 0, createdAt: Date.now() },
      daily: { id: 'daily', name: 'Daily', kind: 'personal', color: 'grey', pinned: true, lastActive: 0, createdAt: Date.now() },
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

const { learnFromUser, saveWhy, whyQuestion, groupCat } = await import('../src/lib/organizer.js');
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
  // the page is only told to make room for the card's frame: the question never passes through it
  assert.deepEqual(sent, [[1, { target: 'why', show: true }]]);
  const ask = await whyQuestion(tabs[0]);
  assert.equal(ask.question, 'Why does this belong in Acme · Projects?');
  assert.deepEqual(ask.options.map((o) => o.label), ["Part of Projects", "It's for Acme", 'Everything on docs.acme.com, not just this page']);
  assert.ok(ask.options.every((o) => Object.keys(o).join() === 'id,label'), 'the card learns more than the labels');
  assert.equal(await whyQuestion({ ...tabs[0], url: 'https://elsewhere.com/' }), null, 'a tab on another page was given the question');
  assert.equal(await whyQuestion({ ...tabs[0], id: 2 }), null, 'another tab was given the question');
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

test('moving the tab again withdraws the question: the card closes and its answer is not taken', async () => {
  groupCat.set(51, 'daily');
  // out of every group, into Daily, into a group that is no folder of ours
  for (const next of [-1, 51, 60]) {
    sent.length = 0;
    await learnFromUser(tabs[0], 50);
    const before = structuredClone(await getState());
    assert.ok(session.why1, 'the question is kept for a worker restart');
    sent.length = 0;
    await learnFromUser({ ...tabs[0], groupId: next }, next);
    assert.deepEqual(sent, [[1, { target: 'why', close: true }]], `the card stayed open after a move to ${next}`);
    assert.equal(session.why1, undefined, `the stored question outlived a move to ${next}`);
    assert.equal(await saveWhy(tabs[0], { optionId: 'site' }), false, `an answer to the old question was taken after a move to ${next}`);
    const st = await getState();
    assert.deepEqual(st.siteRules, before.siteRules, `a site rule was saved for the folder left for ${next}`);
    assert.deepEqual(st.reasons, before.reasons, `a reason was saved for the folder left for ${next}`);
  }
  // a later move to a group without a question to withdraw tells the tab nothing
  sent.length = 0;
  await learnFromUser({ ...tabs[0], groupId: -1 }, -1);
  assert.deepEqual(sent, []);
});
