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
