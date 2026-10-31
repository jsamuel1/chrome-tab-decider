import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { pageText, decisionOrder, shortlist, decisionState, shouldMove } = await import('../src/lib/decide.js');

test('pageText with no details uses the tab title and address', () => {
  const text = pageText({ title: 'Quarterly plan', url: 'https://docs.example.com/d/1#heading' }, undefined);
  assert.match(text, /Quarterly plan/);
  assert.match(text, /docs\.example\.com/);
});

test('pageText with details lists them, then the host, without repeats', () => {
  const text = pageText(
    { title: 'Acme invoice', url: 'https://billing.example.com/x' },
    { title: 'Acme invoice', description: 'Invoice 42 for Acme', siteName: 'Billing', ogTitle: 'Acme invoice', h1: 'Invoice 42', lang: 'en' },
  );
  assert.deepEqual(text.split('\n'), ['Acme invoice', 'Invoice 42 for Acme', 'Billing', 'Invoice 42', 'billing.example.com']);
});

test('decisionOrder puts active tabs first, then the focused window newest first, then the rest', () => {
  const tabs = [
    { id: 1, windowId: 2 },
    { id: 2, windowId: 1 },
    { id: 3, windowId: 1 },
    { id: 4, windowId: 2, active: true },
    { id: 5, windowId: 1 },
  ];
  const order = decisionOrder(tabs, { activeTabIds: [4], focusedWindowId: 1 }).map((t) => t.id);
  assert.deepEqual(order, [4, 5, 3, 2, 1]);
});

test('shortlist puts the folder a page mentions first', () => {
  const cats = [
    { id: 'a', name: 'Shopping', description: 'things to buy' },
    { id: 'b', name: 'Travel', description: 'trips and flights' },
    { id: 'c', name: 'Acme', description: 'customer project' },
  ];
  const reasons = [{ id: 'r1', catId: 'b', text: 'Hotel bookings' }];
  const list = shortlist('Acme quarterly review\nacme.example.com', cats, reasons, 2);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'c');
  // a reason's words count for its folder
  assert.equal(shortlist('Hotel bookings in Kyoto', cats, reasons)[0].id, 'b');
});

test('decisionState stays under 1,500 characters with 50 reasons', () => {
  const reasons = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, catId: 'c', folder: 'Acme', text: `Acme reason number ${i} `.repeat(4) }));
  const profile = { company: 'Amazon', companyDomains: ['amazon.com'], work: 'solutions architect', projects: Array.from({ length: 40 }, (_, i) => `Project ${i}`) };
  const s = decisionState('Acme review\n'.repeat(80), { profile, hint: 'Acme bookmarks', reasons });
  assert.ok(s.length < 1500, `state was ${s.length} characters`);
  assert.match(s, /This person works at Amazon/);
  assert.match(s, /Page:/);
  assert.match(s, /Acme bookmarks/);
  assert.ok((s.match(/Acme reason number/g) || []).length <= 5 * 4);
});

test('decisionState includes the profile, page, bookmark hint and relevant reasons in that order', () => {
  const s = decisionState('Kyoto hotel\nbooking.example.com', {
    profile: { company: 'Amazon' },
    hint: 'Japan trip',
    reasons: [
      { id: 'r1', catId: 't', folder: 'Travel', text: 'Hotel bookings go here' },
      { id: 'r2', catId: 'w', folder: 'Payroll', text: 'Salary slips' },
    ],
  });
  const at = (x) => s.indexOf(x);
  assert.ok(at('Amazon') < at('Page:') && at('Page:') < at('Japan trip') && at('Japan trip') < at('Hotel bookings go here'));
  assert.ok(!s.includes('Salary slips'), 'an unrelated reason was included');
});

test('shouldMove: never for a fixed page, not within the margin, yes above it', () => {
  const cats = { a: { id: 'a' }, b: { id: 'b' } };
  const next = { catId: 'b', confidence: 0.9 };
  assert.equal(shouldMove({ catId: 'a', confidence: 0.2, fixed: true }, next, { cats }), false);
  assert.equal(shouldMove({ catId: 'a', confidence: 0.8 }, next, { cats }), false);
  assert.equal(shouldMove({ catId: 'a', confidence: 0.7 }, next, { cats }), true);
  assert.equal(shouldMove(null, next, { cats }), true);
  assert.equal(shouldMove({ catId: 'gone', confidence: 0.99 }, next, { cats }), true);
  assert.equal(shouldMove({ catId: 'a', confidence: 0.5 }, next, { margin: 0.5, cats }), false);
});
