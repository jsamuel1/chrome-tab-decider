import test from 'node:test';
import assert from 'node:assert/strict';
import { carryUse, recordUse, pruneUsage, planPins, startCooldown } from '../src/lib/usage.js';

const DAY = 864e5;
const now = Date.UTC(2026, 9, 31);
const page = (key, extra = {}) => ({ key, tabId: key.charCodeAt(0), pinned: false, userPinned: false, ...extra });
const uses = (key, n, at, usage = {}) => {
  for (let i = 0; i < n; i++) usage = recordUse(usage, key, at);
  return usage;
};

test('recordUse fades the old score to now, then adds one', () => {
  let u = recordUse({}, 'a', now);
  assert.equal(u.a.score, 1);
  u = recordUse(u, 'a', now + 7 * DAY);
  assert.ok(Math.abs(u.a.score - 1.5) < 1e-9);
  assert.equal(u.a.at, now + 7 * DAY);
});

test('pruneUsage drops pages whose use has faded away', () => {
  const u = { ...uses('old', 1, now - 100 * DAY), ...uses('new', 1, now) };
  assert.deepEqual(Object.keys(pruneUsage(u, now)), ['new']);
});

test('a page used 20 times last week outranks one used 30 times two months ago', () => {
  const usage = { ...uses('recent', 20, now - 7 * DAY), ...uses('stale', 30, now - 60 * DAY) };
  const plan = planPins([page('stale'), page('recent')], usage, { now, pinMax: 1, dailyMax: 0 });
  assert.deepEqual(plan.pin, ['recent']);
});

test('the top five pages become pins and the next eight go in Daily', () => {
  const keys = 'abcdefghijklmnop'.split('');
  let usage = {};
  keys.forEach((k, i) => { usage = uses(k, 20 - i, now, usage); });
  const plan = planPins(keys.map((k) => page(k)), usage, { now });
  assert.deepEqual(plan.pin, keys.slice(0, 5));
  assert.deepEqual(plan.daily, keys.slice(5, 13));
  assert.deepEqual(plan.unpin, []);
});

test('pages never used are not pinned', () => {
  assert.deepEqual(planPins([page('a')], {}, { now }), { pin: [], unpin: [], daily: [] });
});

test('the user\'s own pins are never unpinned, and take up a pinned slot', () => {
  const usage = { ...uses('mine', 1, now), ...uses('x', 50, now), ...uses('y', 40, now) };
  const open = [page('mine', { pinned: true, userPinned: true }), page('x'), page('y')];
  const plan = planPins(open, usage, { now, pinMax: 2, dailyMax: 0 });
  assert.deepEqual(plan.unpin, []);
  assert.deepEqual(plan.pin, ['x']);
});

test('a pin of ours that falls out of the top is unpinned and moves to Daily', () => {
  const usage = { ...uses('old', 1, now), ...uses('a', 30, now), ...uses('b', 25, now) };
  const open = [page('old', { pinned: true }), page('a'), page('b')];
  const plan = planPins(open, usage, { now, pinMax: 2, ourPins: { old: now - DAY } });
  assert.deepEqual(plan.pin, ['a', 'b']);
  assert.deepEqual(plan.unpin, ['old']);
  assert.deepEqual(plan.daily, ['old']);
});

test('a page in its cooldown is not pinned until the cooldown ends', () => {
  const usage = { ...uses('closed', 40, now), ...uses('other', 5, now) };
  const open = [page('closed'), page('other')];
  const cooldown = startCooldown({}, 'closed', now);
  assert.deepEqual(planPins(open, usage, { now, pinMax: 1, cooldown }).pin, ['other']);
  assert.deepEqual(planPins(open, usage, { now: now + 4 * DAY, pinMax: 1, cooldown }).pin, ['closed']);
});

test('startCooldown lasts three days by default and drops cooldowns that have ended', () => {
  const c = startCooldown({ gone: now - 1 }, 'a', now);
  assert.deepEqual(c, { a: now + 3 * DAY });
});

test('a challenger 10% ahead does not displace a holder; 30% ahead does', () => {
  const held = { ...uses('holder', 10, now), ...uses('challenger', 11, now) };
  const open = [page('holder', { pinned: true }), page('challenger')];
  const opts = { now, pinMax: 1, dailyMax: 0, ourPins: { holder: now } };
  const near = planPins(open, held, opts);
  assert.deepEqual([near.pin, near.unpin], [[], []]);
  const far = planPins(open, { ...held, ...uses('challenger', 13, now) }, opts);
  assert.deepEqual([far.pin, far.unpin], [['challenger'], ['holder']]);
});

test('the same hold applies to a Daily slot', () => {
  const usage = { ...uses('holder', 10, now), ...uses('challenger', 11, now) };
  const open = [page('holder', { inDaily: true }), page('challenger')];
  assert.deepEqual(planPins(open, usage, { now, pinMax: 0, dailyMax: 1 }).daily, ['holder']);
});

test('two tabs on one page count once', () => {
  const usage = uses('a', 5, now);
  const plan = planPins([page('a'), page('a', { tabId: 99 })], usage, { now, pinMax: 2, dailyMax: 0 });
  assert.deepEqual(plan.pin, ['a']);
});

test('carryUse gives the new page the old one\'s standing only when it is higher', () => {
  const u = { ...uses('a', 10, now), ...uses('b', 2, now) };
  assert.equal(carryUse(u, 'a', 'c', now).c.score, 10);
  assert.equal(carryUse(u, 'a', 'b', now).b.score, 10);
  assert.equal(carryUse(u, 'b', 'a', now), u);
  assert.equal(carryUse(u, 'x', 'a', now), u);
});
