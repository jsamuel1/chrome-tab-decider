// The "Why?" card's answers, and what saving or deleting one does to the state.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { whyOptions, applyReason, deleteReason } = await import('../src/lib/reasons.js');

const work = { id: 'c1', name: 'Projects', kind: 'work' };
const fun = { id: 'c2', name: 'Games', kind: 'personal' };
const profile = { company: 'Acme', companyDomains: [] };
const blank = () => ({ categories: { c1: work, c2: fun }, pageMap: {}, siteRules: {}, reasons: [] });

test('a work folder offers the company answer, a personal one "It\'s personal"', () => {
  const forWork = whyOptions(work, profile, 'docs.acme.com');
  assert.deepEqual(forWork.map((o) => o.label), [
    'Part of Projects', "It's for Acme", 'Everything on docs.acme.com, not just this page',
  ]);
  assert.deepEqual(forWork.map((o) => o.scope), ['page', 'page', 'site']);
  assert.equal(new Set(forWork.map((o) => o.id)).size, forWork.length, 'answer ids repeat');

  assert.deepEqual(whyOptions(fun, profile, 'games.com').map((o) => o.label)[1], "It's personal");
  assert.deepEqual(whyOptions(work, { company: '' }, 'x.com').map((o) => o.label)[1], "It's personal");
  assert.equal(whyOptions({ id: 'c3', name: 'Acme', kind: 'company' }, profile, 'acme.com')[1].label, "It's for Acme");
});

test('a site-wide answer creates the site rule and fixes the page', () => {
  const st = blank();
  const [site] = whyOptions(work, profile, 'docs.acme.com').filter((o) => o.scope === 'site');
  applyReason(st, { url: 'https://docs.acme.com/a#top', catId: 'c1', optionId: site.id, text: site.text, scope: 'site' });
  assert.equal(st.reasons.length, 1);
  const r = st.reasons[0];
  assert.deepEqual({ catId: r.catId, scope: r.scope, host: r.host, url: r.url, text: r.text },
    { catId: 'c1', scope: 'site', host: 'docs.acme.com', url: 'https://docs.acme.com/a', text: site.text });
  assert.deepEqual(st.siteRules['docs.acme.com'], { catId: 'c1', reasonId: r.id });
  assert.equal(st.pageMap['https://docs.acme.com/a'].fixed, true);
  assert.equal(st.pageMap['https://docs.acme.com/a'].catId, 'c1');
});

test('a page answer fixes the page but makes no site rule', () => {
  const st = blank();
  applyReason(st, { url: 'https://docs.acme.com/a', catId: 'c1', optionId: 'company', text: "It's for Acme", scope: 'page' });
  assert.deepEqual(st.siteRules, {});
  assert.equal(st.pageMap['https://docs.acme.com/a'].fixed, true);
  assert.equal(st.reasons[0].scope, 'page');
});

test('a new site-wide answer replaces the reason behind the old rule', () => {
  const st = blank();
  applyReason(st, { url: 'https://x.com/a', catId: 'c2', optionId: 'site', text: 'old', scope: 'site' });
  applyReason(st, { url: 'https://x.com/b', catId: 'c1', optionId: 'site', text: 'new', scope: 'site' });
  assert.deepEqual(st.reasons.map((r) => r.text), ['new']);
  assert.equal(st.siteRules['x.com'].catId, 'c1');
});

test('deleting a reason removes it and the site rule it created', () => {
  const st = blank();
  applyReason(st, { url: 'https://docs.acme.com/a', catId: 'c1', optionId: 'site', text: 'Everything here', scope: 'site' });
  // a page the site rule filed, and the page the user moved by hand
  st.pageMap['https://docs.acme.com/b'] = { catId: 'c1', confidence: 1, source: 'site', at: 1, fixed: true };
  st.siteRules['other.com'] = { catId: 'c2', reasonId: 'someone-else' };
  deleteReason(st, st.reasons[0].id);
  assert.deepEqual(st.reasons, []);
  assert.equal(st.siteRules['docs.acme.com'], undefined);
  assert.ok(st.siteRules['other.com'], 'a rule made by another reason was removed');
  assert.equal(st.pageMap['https://docs.acme.com/b'], undefined, 'a page the rule filed stays bound to it');
  assert.equal(st.pageMap['https://docs.acme.com/a'].fixed, true, 'the page moved by hand lost its place');
});

test('answer text is kept short', () => {
  const st = blank();
  applyReason(st, { url: 'https://x.com/a', catId: 'c1', optionId: 'text', text: 'x'.repeat(500), scope: 'page' });
  assert.equal(st.reasons[0].text.length, 200);
});
