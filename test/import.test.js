// Importing a Settings export: what comes across, what is left behind, and what is refused.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { fromExport, DEFAULT_SETTINGS } = await import('../src/lib/store.js');

const sample = () => ({
  settings: { pinnedMax: 99, keepRecent: 3, recentTab: false, nonsense: 'x' },
  state: {
    profile: { company: 'Northwind', companyDomains: ['northwind.com'], work: 'lead', projects: ['Atlas'], style: 'specific-work', categories: ['Travel'], onboarded: true },
    categories: { c1: { id: 'c1', name: 'Atlas', kind: 'work', parentId: 'co', color: 'blue', pinned: false, createdAt: 1, isNew: false } },
    pageMap: { 'https://a.com/': { catId: 'c1', confidence: 1, source: 'user', at: 1, fixed: true } },
    siteRules: { 'a.com': { catId: 'c1', reasonId: 'r1' } },
    reasons: [{ id: 'r1', catId: 'c1', text: 'Part of Atlas', scope: 'site', host: 'a.com', at: 1 }],
    usage: { 'https://a.com/': { score: 3, at: 1 } },
    archive: [{ id: 'a1', url: 'https://old.com/', title: 'Old' }],
    tabMeta: { 'https://a.com/': { details: { title: 'secret' } } },
    snapshot: { windows: [] },
    schemaVersion: 2,
  },
});

test('an export made before exports were labelled is accepted', () => {
  const { settings, state } = fromExport(sample());
  assert.equal(state.profile.company, 'Northwind');
  assert.deepEqual(state.reasons.map((r) => r.text), ['Part of Atlas']);
  assert.equal(state.siteRules['a.com'].catId, 'c1');
  assert.equal(state.archive.length, 1);
  assert.equal(settings.keepRecent, 3);
  assert.equal(settings.recentTab, false);
});

test('settings are kept in range, and unknown keys are dropped', () => {
  const { settings } = fromExport({ format: 'tabsage', version: 1, ...sample() });
  assert.equal(settings.pinnedMax, 20);
  assert.equal('nonsense' in settings, false);
  assert.equal(settings.maxGroups, DEFAULT_SETTINGS.maxGroups, 'a setting missing from the file takes its default');
});

test('what belongs to the old browser session stays behind', () => {
  const { state } = fromExport(sample());
  assert.deepEqual(state.tabMeta, {}, 'page details are only for pages open in a tab');
  assert.equal(state.snapshot, null, 'an old layout would reopen old tabs as placeholders');
});

test('a file that is not a TabSage export is refused', () => {
  for (const bad of [null, 'x', 42, [], {}, { settings: 'x' }, { state: [] }, { format: 'other', settings: {}, state: {} }]) {
    assert.throws(() => fromExport(bad), /TabSage export/, JSON.stringify(bad));
  }
});
