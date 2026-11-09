// Reviewing a new folder in Settings: keep it, rename it, or merge it into another.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { reviewFolder } = await import('../src/lib/review.js');

const blank = () => ({
  categories: {
    c1: { id: 'c1', name: 'Projects', isNew: false },
    c2: { id: 'c2', name: 'Robots', isNew: true },
  },
  pageMap: {
    'https://a.com/1': { catId: 'c2', confidence: 0.9, source: 'classifier' },
    'https://a.com/2': { catId: 'c2', confidence: 1, source: 'user', fixed: true },
    'https://b.com/1': { catId: 'c1', confidence: 0.8, source: 'classifier' },
  },
  siteRules: { 'a.com': { catId: 'c2', reasonId: 'r9' } },
  reasons: [],
});

test('keep clears isNew and renaming sets the name too', () => {
  const st = blank();
  reviewFolder(st, { catId: 'c2', action: 'keep' });
  assert.equal(st.categories.c2.isNew, false);
  assert.equal(st.categories.c2.name, 'Robots');

  const st2 = blank();
  reviewFolder(st2, { catId: 'c2', action: 'rename', name: '  Automata ' });
  assert.deepEqual([st2.categories.c2.name, st2.categories.c2.isNew], ['Automata', false]);
});

test('merge moves the pages (keeping fixed), leaves a reason and removes the folder', () => {
  const st = blank();
  reviewFolder(st, { catId: 'c2', action: 'merge', intoId: 'c1' });
  assert.equal(st.categories.c2, undefined);
  assert.equal(st.pageMap['https://a.com/1'].catId, 'c1');
  assert.equal(st.pageMap['https://a.com/2'].catId, 'c1');
  assert.equal(st.pageMap['https://a.com/2'].fixed, true);
  assert.equal(st.siteRules['a.com'].catId, 'c1');
  assert.equal(st.reasons.length, 1);
  assert.equal(st.reasons[0].text, 'Merged Robots into Projects');
  assert.equal(st.reasons[0].catId, 'c1');
});

test('a merge into itself or a missing folder changes nothing', () => {
  const st = blank();
  reviewFolder(st, { catId: 'c2', action: 'merge', intoId: 'c2' });
  reviewFolder(st, { catId: 'c2', action: 'merge', intoId: 'nope' });
  assert.deepEqual(st, blank());
});

// A folder you merged, deleted or renamed is not proposed again under its old name.
const { renameFolder, retireName, isRetired } = await import('../src/lib/review.js');

test('a merged folder\'s name stays with the folder it went into', () => {
  const st = blank();
  reviewFolder(st, { catId: 'c2', action: 'merge', intoId: 'c1' });
  assert.equal(st.categories.c2, undefined);
  assert.ok(isRetired(st, 'robots') && isRetired(st, ' Robots '), 'discovery could propose Robots again');
  assert.equal(isRetired(st, 'Projects'), false);
});

test('renaming keeps the old name from coming back, and a name taken by another folder is refused', () => {
  const st = blank();
  assert.deepEqual(renameFolder(st, 'c2', '  Automata '), { ok: true });
  assert.deepEqual([st.categories.c2.name, st.categories.c2.isNew], ['Automata', false]);
  assert.ok(isRetired(st, 'Robots'));

  assert.deepEqual(renameFolder(st, 'c2', 'projects'), { clash: { id: 'c1', name: 'Projects' } });
  assert.equal(st.categories.c2.name, 'Automata', 'renamed onto another folder');
  assert.deepEqual(renameFolder(st, 'c2', 'automata'), { ok: true }, 'changing only the case is a rename');
  assert.equal(st.categories.c2.name, 'automata');
  assert.deepEqual(renameFolder(st, 'c2', '   '), { error: 'empty' });
  assert.deepEqual(renameFolder(st, 'nope', 'X'), { error: 'missing' });
});

test('a deleted folder\'s name is retired, and adding it yourself brings it back', () => {
  const st = blank();
  retireName(st, 'Robots');
  assert.ok(isRetired(st, 'robots'));
  retireName(st, 'Robots', { revive: true });
  assert.equal(isRetired(st, 'robots'), false);
});
