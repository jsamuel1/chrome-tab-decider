// The tab bar changes under a run: worker restarts, hand moves and tab switches while the classifier
// thinks, and group titles made under an earlier company.
import test from 'node:test';
import assert from 'node:assert/strict';

const MIN = 60000;
const store = { state: { categories: {}, schemaVersion: 2 } };
const session = {};
const alarms = [];
const grouped = [];
const titled = [];
let groups = [];
let nextGid = 100;
let tabs = [];
globalThis.chrome = {
  storage: {
    local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) },
    session: { get: async (k) => (k in session ? { [k]: session[k] } : {}), set: async (o) => Object.assign(session, o) },
  },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: { query: async () => structuredClone(tabs), group: async (o) => { grouped.push(o); return o.groupId ?? nextGid++; } },
  tabGroups: { query: async () => groups, update: async (gid, o) => { titled.push([gid, o.title]); }, get: async (id) => groups.find((g) => g.id === id) || {} },
  windows: { getAll: async () => [], getLastFocused: async () => ({ id: 1, focused: true }) },
  alarms: { create: (name, o) => alarms.push([name, o]) },
  bookmarks: { getTree: async () => [] },
};

const { setAiForTest } = await import('../src/lib/ai.js');
const { getState } = await import('../src/lib/store.js');

let during = null; // runs while the classifier is answering about a page whose text includes during.page
const calls = [];
setAiForTest(async (type, payload) => {
  calls.push([type, payload]);
  if (type === 'decider.status') return { downloaded: true, device: 'webgpu' };
  if (type === 'decider.choice') {
    if (during && payload.state.includes(during.page)) {
      const f = during.fn;
      during = null;
      await f();
    }
    const labels = payload.options.map((o) => o.name);
    return { labels, choice: labels.includes('Fun') ? 'Fun' : labels.at(-1), confidence: 0.9 };
  }
  return { error: 'not in test' };
});
const count = (type) => calls.filter(([t]) => t === type).length;
const tab = (id, title, url, extra = {}) => ({ id, windowId: 1, url, title, groupId: -1, active: false, ...extra });
const cat = (id, name, extra = {}) => ({ id, name, description: '', color: 'blue', pinned: false, lastActive: 0, createdAt: 0, kind: 'personal', parentId: null, isNew: false, ...extra });
const reset = async () => {
  const st = await getState();
  st.categories = { c1: cat('c1', 'Work'), c2: cat('c2', 'Fun') };
  st.pageMap = {};
  st.siteRules = {};
  st.profile = { ...st.profile, company: '' };
  calls.length = alarms.length = grouped.length = titled.length = 0;
  groups = [];
  return st;
};
const movedTabs = () => grouped.flatMap((o) => o.tabIds);

test('after a service-worker restart, activity 40 s before still counts as busy', async () => {
  const { organize } = await import('../src/lib/organizer.js?restart-1');
  const st = await reset();
  tabs = [tab(1, 'Fun page', 'https://fun.example.com/1')];
  st.pageMap['https://fun.example.com/1'] = { catId: 'other', confidence: 0.5, source: 'decider', at: 1, sig: '' };
  st.categories.c2.createdAt = Date.now(); // a new folder: the page is due a quiet re-decision
  const last = Date.now() - 40 * 1000;
  session.lastActivity = last; // written by the previous worker's markActivity
  await organize({ reason: 'tab-updated' });
  assert.equal(count('decider.choice'), 0, 'a filed page was re-decided 40 s after the user was active');
  assert.deepEqual(alarms.find(([n]) => n === 'organize-quiet')?.[1], { when: last + 2 * MIN + 5000 });
  assert.equal(st.pageMap['https://fun.example.com/1'].catId, 'other');
});

test('with no record of activity (a fresh session), a filed page waits for a quiet moment', async () => {
  const { organize, markActivity } = await import('../src/lib/organizer.js?restart-2');
  const st = await reset();
  delete session.lastActivity;
  tabs = [tab(1, 'Fun page', 'https://fun.example.com/1')];
  st.pageMap['https://fun.example.com/1'] = { catId: 'other', confidence: 0.5, source: 'decider', at: 1, sig: '' };
  st.categories.c2.createdAt = Date.now();
  await organize({ reason: 'tab-updated' });
  assert.equal(count('decider.choice'), 0);
  assert.ok(alarms.some(([n]) => n === 'organize-quiet'));
  assert.ok(session.lastActivity, 'the assumed activity was not kept for the next worker');

  markActivity(Date.now() - 3 * MIN);
  await organize({ reason: 'organize-quiet' });
  assert.equal(st.pageMap['https://fun.example.com/1'].catId, 'c2');
});

test('a page placed by hand while the classifier thinks keeps its place, and its tab is not regrouped', async () => {
  const { organize, groupCat } = await import('../src/lib/organizer.js');
  const st = await reset();
  groups = [{ id: 50, windowId: 1, title: 'Work', color: 'blue' }];
  groupCat.set(50, 'c1');
  tabs = [tab(1, 'A page', 'https://a.com/x', { active: true }), tab(2, 'B page', 'https://b.com/y')];
  during = {
    page: 'B page',
    fn: async () => {
      // what learnFromUser does when the user drags tab 2 into Work
      (await getState()).pageMap['https://b.com/y'] = { catId: 'c1', confidence: 1, source: 'user', at: Date.now(), fixed: true };
      tabs[1].groupId = 50;
    },
  };
  await organize({ reason: 'test' });
  assert.deepEqual(st.pageMap['https://b.com/y'], { ...st.pageMap['https://b.com/y'], catId: 'c1', source: 'user', fixed: true });
  assert.ok(!grouped.some((o) => o.tabIds.includes(2) && o.groupId !== 50), 'the hand-placed tab was moved out of Work');
});

test('a tab the user switches to while the classifier thinks is not moved', async () => {
  const { organize } = await import('../src/lib/organizer.js');
  await reset();
  tabs = [tab(1, 'A page', 'https://a.com/x', { active: true }), tab(2, 'B page', 'https://b.com/y')];
  during = {
    page: 'B page',
    fn: async () => {
      tabs[0].active = false;
      tabs[1].active = true;
    },
  };
  await organize({ reason: 'test' });
  assert.ok(!movedTabs().includes(2), 'the tab the user is now looking at was moved');
  assert.ok(movedTabs().includes(1), 'the tab the user left was not filed');
});

test('a group titled under an earlier company is retitled, not taken as a rename', async () => {
  const { organize, groupCat } = await import('../src/lib/organizer.js');
  for (const [before, after] of [['Amazon', 'AWS'], ['Amazon', '']]) {
    const st = await reset();
    st.categories = { w1: cat('w1', 'Acme', { kind: 'work' }) };
    st.profile = { ...st.profile, company: after };
    st.pageMap['https://acme.com/x'] = { catId: 'w1', confidence: 1, source: 'decider', at: Date.now() + 1e9, sig: '' };
    groups = [{ id: 7, windowId: 1, title: `${before} · Acme`, color: 'blue' }];
    groupCat.set(7, 'w1');
    tabs = [tab(1, 'Acme', 'https://acme.com/x', { groupId: 7 })];
    await organize({ reason: 'test' });
    assert.equal(st.categories.w1.name, 'Acme', `company ${before} → ${after || '(none)'} renamed the folder`);
    assert.deepEqual(titled, [[7, after ? `${after} · Acme` : 'Acme']]);

    // after a restart the old title still finds its folder
    groupCat.clear();
    titled.length = 0;
    groups = [{ id: 8, windowId: 1, title: `${before} · Acme`, color: 'blue' }];
    tabs = [tab(1, 'Acme', 'https://acme.com/x', { groupId: 8 })];
    await organize({ reason: 'test' });
    assert.equal(groupCat.get(8), 'w1');
    assert.equal(Object.keys(st.categories).filter((k) => k !== 'other').length, 1, 'the old title became a folder of its own');
  }
});
