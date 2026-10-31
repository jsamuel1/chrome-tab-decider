import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { groupTitle, planGroups } = await import('../src/lib/grouping.js');
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
  const counts = new Map([['life', 5], ['shop', 1], ['misc', 1]]);
  const plan = planGroups(more, counts, 1);
  assert.equal(plan.get('shop'), 'life');
  assert.equal(plan.get('misc'), 'other');
});

test('mergeCategories keeps kind, parent and new flag', () => {
  const st = { categories: {} };
  const [c] = mergeCategories(st, [{ name: 'Acme', kind: 'work', parentId: 'co', isNew: true }], 'ai');
  assert.deepEqual([c.kind, c.parentId, c.isNew], ['work', 'co', true]);
});
