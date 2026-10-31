// Settings: the pinned and Daily limits can be changed, its words match what TabSage does, reasons
// say what they are about, folders can be placed, and merging asks first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { cleanSettings, regroups, setSiteRule } = await import('../src/lib/store.js');
const { applyReason, describeReason, newestFirst } = await import('../src/lib/reasons.js');
const { reviewFolder } = await import('../src/lib/review.js');

const html = readFileSync(new URL('../static/options.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/options/options.js', import.meta.url), 'utf8');

test('Settings has controls for the pinned and Daily limits, which regroup tabs and stay in range', () => {
  for (const k of ['pinnedMax', 'dailyMax']) assert.match(html, new RegExp(`<input type="number" id="${k}" data-key="${k}"`));
  assert.ok(regroups({ pinnedMax: 3 }) && regroups({ dailyMax: 0 }) && regroups({ maxGroups: 6 }));
  assert.equal(regroups({ tabSort: 'mru' }), false);
  assert.deepEqual(cleanSettings({ pinnedMax: -2, dailyMax: 4.6 }), { pinnedMax: 0, dailyMax: 5 });
  assert.deepEqual(cleanSettings({ pinnedMax: 99, dailyMax: 'x' }), { pinnedMax: 20, dailyMax: 8 });
  assert.deepEqual(cleanSettings({ tabSort: 'mru' }), { tabSort: 'mru' });
});

test("Settings no longer describes the old site-wide, keyword-based behaviour", () => {
  for (const stale of ['keyword', 'whole domain', 'files each domain', 'the domain goes', 'by domain and topic', 'Domains (click to forget)', 'Smaller categories fold into the Other group']) {
    assert.ok(!html.includes(stale), `options.html still says "${stale}"`);
  }
  for (const stale of ['keyword matching', 'Its domains will be re-classified']) assert.ok(!js.includes(stale), `options.js still says "${stale}"`);
  assert.match(html, /Sites you bound here \(click to forget\)/);
  assert.match(js, /TabSage leaves your tabs alone until it is/);
});

test('merging a folder asks first, and a cancelled merge resets the list', () => {
  const merge = js.slice(js.indexOf("e.target.matches('[data-merge]')"));
  const ask = merge.indexOf('confirm(');
  const call = merge.indexOf("action: 'merge'");
  assert.ok(ask !== -1 && ask < call, 'the merge runs without asking');
  assert.match(merge.slice(ask, call), /e\.target\.value = ''/);
});

test('each reason shows its folder and its page or site, newest first', () => {
  const cats = [{ id: 'c1', name: 'Shopping' }, { id: 'c2', name: 'Acme' }];
  const reasons = [
    { id: 'a', catId: 'c1', text: "It's personal", scope: 'page', url: 'https://amazon.com/gp/cart/view.html', host: 'amazon.com', at: 1 },
    { id: 'b', catId: 'c2', text: 'Moved here by hand', scope: 'site', url: '', host: 'acme.example.com', at: 3 },
    { id: 'c', catId: 'c1', text: "It's personal", scope: 'page', url: 'https://ebay.com/', host: 'ebay.com', at: 2 },
  ];
  assert.deepEqual(newestFirst(reasons).map((r) => describeReason(r, cats)), [
    'Moved here by hand — Acme — everything on acme.example.com',
    "It's personal — Shopping — ebay.com",
    "It's personal — Shopping — amazon.com/gp/cart/view.html",
  ]);
  assert.match(js, /describeReason\(r, s\.categories\)/);
});

test('a newer answer about the same page, or a new rule for the same site, replaces the old reason', () => {
  const st = { categories: {}, pageMap: {}, siteRules: {}, reasons: [] };
  applyReason(st, { url: 'https://a.com/x', catId: 'c1', optionId: 'personal', text: "It's personal", scope: 'page' }, 1);
  applyReason(st, { url: 'https://a.com/x#y', catId: 'c2', optionId: 'folder', text: 'Part of Acme', scope: 'page' }, 2);
  applyReason(st, { url: 'https://a.com/other', catId: 'c2', optionId: 'folder', text: 'Part of Acme', scope: 'page' }, 3);
  assert.deepEqual(st.reasons.map((r) => [r.url, r.text]), [['https://a.com/x', 'Part of Acme'], ['https://a.com/other', 'Part of Acme']]);

  setSiteRule(st, 'b.com', 'c1', 4);
  setSiteRule(st, 'b.com', 'c2', 5);
  assert.equal(st.reasons.filter((r) => r.host === 'b.com').length, 1);
  assert.equal(st.reasons.find((r) => r.host === 'b.com').id, st.siteRules['b.com'].reasonId);
});

test('a folder can be placed under the company or a category in Settings', () => {
  const st = {
    categories: {
      co: { id: 'co', name: 'Amazon', kind: 'company', parentId: null },
      out: { id: 'out', name: 'Outdoors', kind: 'personal', parentId: null },
      x: { id: 'x', name: 'Initech', kind: 'personal', parentId: null, isNew: true },
    },
    pageMap: {}, siteRules: {}, reasons: [],
  };
  reviewFolder(st, { catId: 'x', action: 'place', intoId: 'co' });
  assert.deepEqual([st.categories.x.kind, st.categories.x.parentId], ['work', 'co']);
  reviewFolder(st, { catId: 'x', action: 'place', intoId: 'out' });
  assert.deepEqual([st.categories.x.kind, st.categories.x.parentId], ['personal', 'out']);
  reviewFolder(st, { catId: 'x', action: 'place', intoId: '' });
  assert.deepEqual([st.categories.x.kind, st.categories.x.parentId], ['personal', null]);
  reviewFolder(st, { catId: 'x', action: 'place', intoId: 'x' });
  assert.equal(st.categories.x.parentId, null, 'a folder was put under itself');
  reviewFolder(st, { catId: 'co', action: 'place', intoId: 'out' });
  assert.equal(st.categories.co.kind, 'company', 'the company folder was moved');
  assert.match(js, /action: 'place'/);
});
