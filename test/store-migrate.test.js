import test from 'node:test';
import assert from 'node:assert/strict';

const { migrate } = await import('../src/lib/store.js');

const old = () => ({
  categories: { c1: { id: 'c1', name: 'Work' }, c2: { id: 'c2', name: 'Fun' } },
  domainMap: {
    'phonetool.amazon.com': { catId: 'c1', source: 'user' },
    'x.com': { catId: 'c2', source: 'heuristic' },
  },
});

test('migrate keeps hand-made domain corrections as site rules and drops the rest', () => {
  const st = migrate(old());
  assert.deepEqual(Object.keys(st.siteRules), ['phonetool.amazon.com']);
  assert.equal(st.siteRules['phonetool.amazon.com'].catId, 'c1');
  const reason = st.reasons.find((r) => r.id === st.siteRules['phonetool.amazon.com'].reasonId);
  assert.equal(reason.text, 'Moved here by hand');
  assert.equal(reason.scope, 'site');
  assert.equal(reason.host, 'phonetool.amazon.com');
  assert.equal('domainMap' in st, false);
});

test('migrate gives categories the new fields', () => {
  const st = migrate(old());
  for (const c of Object.values(st.categories)) {
    assert.equal(c.kind, 'personal');
    assert.equal(c.parentId, null);
    assert.equal(c.isNew, false);
  }
});

test('migrate adds the new state', () => {
  const st = migrate({});
  assert.deepEqual(st.pageMap, {});
  assert.deepEqual(st.usage, {});
  assert.deepEqual(st.ourPins, {});
  assert.deepEqual(st.pinCooldown, {});
  assert.equal(st.profile.onboarded, false);
  assert.equal(st.profile.style, 'specific-work');
});

test('migrate is idempotent', () => {
  const once = migrate(old());
  const snapshot = structuredClone(once);
  assert.deepEqual(migrate(once), snapshot);
});

test('a newer hand-made correction replaces an older site rule for the same host', () => {
  // State saved by the first page-based build: a rule already exists, and a later correction sits in domainMap.
  const st = migrate({
    categories: { c1: { id: 'c1', name: 'Work' }, c2: { id: 'c2', name: 'Fun' } },
    siteRules: { 'a.com': { catId: 'c1', reasonId: 'r1' } },
    reasons: [{ id: 'r1', catId: 'c1', text: 'Moved here by hand', scope: 'site', host: 'a.com', url: '', at: 1 }],
    domainMap: { 'a.com': { catId: 'c2', source: 'user', at: 2 } },
  });
  assert.equal(st.siteRules['a.com'].catId, 'c2');
  const reason = st.reasons.find((r) => r.id === st.siteRules['a.com'].reasonId);
  assert.equal(reason.catId, 'c2');
  assert.equal(reason.host, 'a.com');
  assert.equal('domainMap' in st, false);
});

test('once migrated, the organizer\'s page decisions survive a reload', () => {
  const once = migrate(old());
  once.pageMap = { 'https://x.com/a': { catId: 'c2', source: 'decider', at: 5 } };
  const reloaded = migrate(structuredClone(once));
  assert.deepEqual(reloaded.pageMap, once.pageMap);
  assert.deepEqual(reloaded.siteRules, once.siteRules);
});
