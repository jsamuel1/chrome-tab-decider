// New folders get a place: a work folder goes under the company (titled "<Company> · X", folding into
// the company group), a personal one under a category the user chose. Names the popup brings from the
// built-in model go through the same check as discovered ones.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = { state: { categories: {}, schemaVersion: 2 } };
let tabs = [];
let groups = [];
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: structuredClone(store[k]) }), set: async (o) => Object.assign(store, structuredClone(o)) } },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: { query: async (q) => (q?.groupId !== undefined ? tabs.filter((t) => t.groupId === q.groupId) : tabs), group: async (o) => o.groupId ?? 100 },
  tabGroups: { query: async () => groups, update: async () => {}, get: async () => ({}) },
  windows: { getAll: async () => [], getLastFocused: async () => ({ id: 9, focused: true }) },
  alarms: { create: () => {} },
};

const { organize } = await import('../src/lib/organizer.js');
const { setAiForTest } = await import('../src/lib/ai.js');
const { getState } = await import('../src/lib/store.js');
const { saveProfile } = await import('../src/lib/onboarding.js');
const { groupTitle, planGroups } = await import('../src/lib/grouping.js');

const noul = [];
setAiForTest(async (type, payload) => {
  if (type === 'decider.status') return { downloaded: true, device: 'webgpu' };
  if (type === 'decider.noul') {
    noul.push(payload.instructions);
    const i = payload.instructions;
    const yes = /^Would "(Initech|Hiking|Gizmo)"/.test(i) ? 0.9
      : i.startsWith('Is a folder named "Initech"') || i.startsWith('Is a folder named "Gizmo"') ? 0.9 : 0.1;
    return { labels: ['true', 'false'], probs: [yes, 1 - yes] };
  }
  if (type === 'decider.choice') {
    const labels = payload.options.map((o) => o.name);
    if (payload.instructions.startsWith('Which of these categories')) {
      return { labels, choice: payload.instructions.includes('"Hiking"') ? 'Outdoors' : 'None of these', confidence: 0.9 };
    }
    return { labels, choice: labels.at(-1), confidence: 0.9 };
  }
  if (type === 'llm.discover') return { categories: [] };
  return { error: 'not in test' };
});

const tab = (id, title, url, extra = {}) => ({ id, windowId: 1, url, title, groupId: -1, ...extra });

test('a discovered work folder is titled under the company and folds into the company group', async () => {
  const st = await getState();
  saveProfile(st, { company: 'Amazon', work: 'solutions architect', projects: ['Payroll'], categories: ['Outdoors'] });
  tabs = [
    tab(1, 'Initech migration plan', 'https://docs.example.com/1'),
    tab(2, 'Initech cost review', 'https://billing.example.org/2'),
    tab(3, 'Initech kickoff notes', 'https://wiki.example.net/3'),
    tab(4, 'Hiking boots', 'https://shop.example.com/4'),
    tab(5, 'Hiking trails near Seattle', 'https://trails.example.com/5'),
    tab(6, 'Hiking with dogs', 'https://dogs.example.com/6'),
  ];
  await organize({ reason: 'discover' });
  const cats = Object.values(st.categories);
  const company = cats.find((c) => c.kind === 'company');
  const initech = cats.find((c) => c.name === 'Initech');
  const hiking = cats.find((c) => c.name === 'Hiking');
  const outdoors = cats.find((c) => c.name === 'Outdoors');
  assert.ok(initech && hiking, 'the folders were not discovered');
  assert.deepEqual([initech.kind, initech.parentId], ['work', company.id]);
  assert.equal(groupTitle(initech, st.profile), 'Amazon · Initech');
  assert.deepEqual([hiking.kind, hiking.parentId], ['personal', outdoors.id]);

  // over the group limit, the work folder folds into the company group, not into Other
  const counts = new Map([[company.id, 1], [initech.id, 3], [hiking.id, 3], [outdoors.id, 2]]);
  const plan = planGroups(cats, counts, 2);
  assert.equal(plan.get(initech.id), company.id);
  assert.notEqual(plan.get(hiking.id), 'other');
});

test('a group the user names under the company is a work folder of the company', async () => {
  const st = await getState();
  groups = [{ id: 40, windowId: 1, title: 'Amazon · Gadgets', color: 'pink' }];
  tabs = [tab(7, 'Gadgets backlog', 'https://board.example.com/7', { groupId: 40 })];
  await organize({ reason: 'named-group' });
  const gadgets = Object.values(st.categories).find((c) => c.name === 'Gadgets');
  const company = Object.values(st.categories).find((c) => c.kind === 'company');
  assert.deepEqual([gadgets?.kind, gadgets?.parentId], ['work', company.id]);
  groups = [];
});

test("names the popup's Re-discover proposes are checked by the classifier and marked New", async () => {
  const st = await getState();
  noul.length = 0;
  tabs = [tab(8, 'Gizmo design', 'https://gizmo.example.com/8'), tab(9, 'Weekend plans', 'https://plans.example.com/9')];
  await organize({ rediscover: true, categories: [{ name: 'Bogus', description: 'made up' }, { name: 'Gizmo', description: 'gadgets' }] });
  assert.ok(noul.includes('Would "Bogus" be a sensible name for a folder holding these browser tabs?'), 'Bogus was never checked');
  assert.ok(!Object.values(st.categories).some((c) => c.name === 'Bogus'), 'a rejected name became a folder');
  const gizmo = Object.values(st.categories).find((c) => c.name === 'Gizmo');
  assert.equal(gizmo?.isNew, true, 'an accepted name was not marked New');
  assert.equal(gizmo.kind, 'work');
});
