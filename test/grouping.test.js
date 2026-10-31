import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { groupTitle, isRename, planGroups } = await import('../src/lib/grouping.js');
const { mergeCategories } = await import('../src/lib/categories.js');

const profile = { company: 'Amazon' };
const cats = [
  { id: 'co', name: 'Amazon', kind: 'company', parentId: null },
  { id: 'acme', name: 'Acme', kind: 'work', parentId: 'co' },
  { id: 'pay', name: 'Payroll', kind: 'work', parentId: 'co' },
  { id: 'trav', name: 'Travel', kind: 'personal', parentId: null },
  { id: 'daily', name: 'Daily', kind: 'personal', parentId: null },
];

test('groupTitle prefixes work folders with the company', () => {
  assert.equal(groupTitle(cats[1], profile), 'Amazon · Acme');
  assert.equal(groupTitle(cats[0], profile), 'Amazon');
  assert.equal(groupTitle(cats[3], profile), 'Travel');
});

test('isRename tells a user rename from a title TabSage gave under an earlier company', () => {
  const acme = { id: 'w', name: 'Acme', kind: 'work' };
  assert.equal(isRename(acme, 'AWS · Acme', { company: 'AWS' }), false);
  assert.equal(isRename(acme, 'Amazon · Acme', { company: 'AWS' }), false, 'company changed');
  assert.equal(isRename(acme, 'Amazon · Acme', { company: '' }), false, 'company cleared');
  assert.equal(isRename(acme, 'Acme', { company: 'AWS' }), false, 'company newly set');
  assert.equal(isRename({ ...acme, kind: 'company', name: 'Amazon', shownTitle: 'Amazon' }, 'Amazon', { company: 'AWS' }), false, 'title TabSage set');
  assert.equal(isRename(acme, 'AWS · Widgets', { company: 'AWS' }), true);
  assert.equal(isRename(acme, 'Widgets', { company: 'AWS' }), true);
});

test('planGroups folds the lowest ranked into the parent and keeps Daily out of the count', () => {
  const counts = new Map([['co', 5], ['acme', 4], ['pay', 1], ['trav', 3], ['daily', 8]]);
  const plan = planGroups(cats, counts, 3);
  assert.equal(plan.get('pay'), 'co');
  assert.equal(plan.get('daily'), 'daily');
  assert.equal(plan.get('trav'), 'trav');
  assert.equal(plan.get('acme'), 'acme');
  assert.equal(plan.get('co'), 'co');
});

test('planGroups sends a parentless folder to Other, and a personal folder to its high-level category', () => {
  const more = [
    { id: 'life', name: 'Life', kind: 'personal', parentId: null },
    { id: 'shop', name: 'Shopping', kind: 'personal', parentId: 'life' },
    { id: 'misc', name: 'Misc', kind: 'personal', parentId: null },
  ];
  // Other already holds tabs, so it takes one of the two slots.
  const counts = new Map([['life', 5], ['shop', 1], ['misc', 2], ['other', 1]]);
  const plan = planGroups(more, counts, 2);
  assert.equal(plan.get('shop'), 'life');
  assert.equal(plan.get('misc'), 'other');
  assert.equal(plan.get('life'), 'life');
  assert.equal(groupCount(plan), 2);
});

// The groups a plan really opens: every distinct target except Daily.
function groupCount(plan) {
  return new Set([...plan.values()].filter((id) => id !== 'daily')).size;
}

test('planGroups counts Other as a group when folding first sends tabs there', () => {
  const three = [
    { id: 'a', name: 'A', kind: 'personal', parentId: null },
    { id: 'b', name: 'B', kind: 'personal', parentId: null },
    { id: 'c', name: 'C', kind: 'personal', parentId: null },
  ];
  const plan = planGroups(three, new Map([['a', 5], ['b', 4], ['c', 1]]), 2);
  assert.ok(groupCount(plan) <= 2, `got ${[...plan]}`);
  assert.equal(plan.get('a'), 'a');
  assert.equal(plan.get('b'), 'other');
  assert.equal(plan.get('c'), 'other');
});

test('planGroups counts a parent with no open tabs as a group when tabs fold into it', () => {
  const work = [
    { id: 'co', name: 'Amazon', kind: 'company', parentId: null },
    { id: 'x', name: 'X', kind: 'work', parentId: 'co' },
    { id: 'y', name: 'Y', kind: 'work', parentId: 'co' },
    { id: 't', name: 'Travel', kind: 'personal', parentId: null },
  ];
  const plan = planGroups(work, new Map([['x', 4], ['y', 1], ['t', 3]]), 2);
  assert.ok(groupCount(plan) <= 2, `got ${[...plan]}`);
  // Folding both work folders into the company group fits, so nothing needs to go to Other.
  assert.equal(plan.get('t'), 't');
  assert.equal(plan.get('x'), 'co');
  assert.equal(plan.get('y'), 'co');
});

test('planGroups keeps within the limit when folds target several empty parents and Other', () => {
  const mixed = [
    { id: 'p', name: 'P', kind: 'personal', parentId: null },
    { id: 'q', name: 'Q', kind: 'personal', parentId: null },
    { id: 'a', name: 'A', kind: 'personal', parentId: null },
    { id: 'b', name: 'B', kind: 'personal', parentId: null },
    { id: 'x', name: 'X', kind: 'personal', parentId: 'p' },
    { id: 'y', name: 'Y', kind: 'personal', parentId: 'q' },
    { id: 'z', name: 'Z', kind: 'personal', parentId: null },
  ];
  const counts = new Map([['a', 5], ['b', 4], ['x', 1], ['y', 1], ['z', 1]]);
  for (const max of [1, 2, 3, 4, 5, 6]) {
    const plan = planGroups(mixed, counts, max);
    assert.ok(groupCount(plan) <= max, `max ${max}: got ${[...plan]}`);
    assert.equal(plan.size, 5);
  }
  const roomy = planGroups(mixed, counts, 5);
  assert.deepEqual([...roomy.values()], ['a', 'b', 'x', 'y', 'z']);
});

test('planGroups with a limit of 1 puts everything in one group, Daily aside', () => {
  const counts = new Map([['co', 5], ['acme', 4], ['pay', 1], ['trav', 3], ['daily', 8]]);
  const plan = planGroups(cats, counts, 1);
  assert.equal(groupCount(plan), 1, `got ${[...plan]}`);
  assert.equal(plan.get('daily'), 'daily');
  assert.equal(plan.size, 5);
});

test('planGroups with a limit of 1 and only work folders folds them all into the company group', () => {
  const counts = new Map([['acme', 4], ['pay', 1]]);
  const plan = planGroups(cats, counts, 1);
  assert.deepEqual([...plan], [['acme', 'co'], ['pay', 'co']]);
});

test('planGroups keeps pinned folders in their own group ahead of bigger ones', () => {
  const list = [
    { id: 'a', name: 'A', kind: 'personal', parentId: null },
    { id: 'b', name: 'B', kind: 'personal', parentId: null, pinned: true },
  ];
  const plan = planGroups(list, new Map([['a', 9], ['b', 1], ['other', 1]]), 2);
  assert.equal(plan.get('b'), 'b');
  assert.equal(plan.get('a'), 'other');
});

test('planGroups survives a parent loop', () => {
  const loop = [
    { id: 'a', name: 'A', kind: 'personal', parentId: 'b' },
    { id: 'b', name: 'B', kind: 'personal', parentId: 'a' },
  ];
  const plan = planGroups(loop, new Map([['a', 2], ['b', 1]]), 1);
  assert.equal(groupCount(plan), 1);
});

test('planGroups with Other already holding tabs and a limit of 1 sends everything to Other', () => {
  const more = [
    { id: 'life', name: 'Life', kind: 'personal', parentId: null },
    { id: 'shop', name: 'Shopping', kind: 'personal', parentId: 'life' },
    { id: 'other', name: 'Other', kind: 'personal', parentId: null },
  ];
  const plan = planGroups(more, new Map([['life', 5], ['shop', 1], ['other', 2]]), 1);
  assert.equal(groupCount(plan), 1);
  assert.deepEqual([...new Set(plan.values())], ['other']);
});

test('mergeCategories keeps kind, parent and new flag', () => {
  const st = { categories: {} };
  const [c] = mergeCategories(st, [{ name: 'Acme', kind: 'work', parentId: 'co', isNew: true }], 'ai');
  assert.deepEqual([c.kind, c.parentId, c.isNew], ['work', 'co', true]);
});

test('planGroups never opens more groups than the limit, and only folds upwards or into Other', () => {
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const kinds = ['work', 'personal', 'company'];
  for (let round = 0; round < 300; round++) {
    const size = 2 + rand(10);
    const list = [{ id: 'daily', name: 'Daily', kind: 'personal', parentId: null }];
    for (let i = 0; i < size; i++) {
      const parentId = i > 0 && rand(2) ? `c${rand(i)}` : null;
      list.push({ id: `c${i}`, name: `C${i}`, kind: kinds[rand(3)], parentId, pinned: rand(6) === 0 });
    }
    const counts = new Map();
    for (const c of list) if (rand(3)) counts.set(c.id, 1 + rand(9));
    if (rand(2)) counts.set('other', 1 + rand(3));
    const max = 1 + rand(6);
    const plan = planGroups(list, counts, max);
    const byId = new Map(list.map((c) => [c.id, c]));
    const label = `round ${round}, max ${max}: ${JSON.stringify([...plan])}`;
    assert.ok(groupCount(plan) <= max, label);
    for (const [id, n] of counts) if (n > 0) assert.ok(plan.has(id), `${label} misses ${id}`);
    if (counts.get('daily')) assert.equal(plan.get('daily'), 'daily', label);
    for (const [id, to] of plan) {
      if (to === id || to === 'other') continue;
      // The target is an ancestor (or, for work, the company category).
      const ups = new Set();
      for (let c = byId.get(id); c && !ups.has(c.id); c = byId.get(c.parentId)) ups.add(c.id);
      const ok = ups.has(to) || byId.get(to)?.kind === 'company';
      assert.ok(ok, `${label}: ${id} -> ${to} is not upwards`);
    }
  }
});
