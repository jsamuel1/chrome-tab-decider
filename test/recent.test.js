import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { heldTabIds, recentLists } = await import('../src/lib/recent.js');

const tab = (id, windowId, lastAccessed, extra = {}) => ({ id, windowId, lastAccessed, url: `https://e.com/${id}`, title: `t${id}`, ...extra });

test('the n most recently used tabs of each window are held still', () => {
  const tabs = [tab(1, 1, 10), tab(2, 1, 50), tab(3, 1, 30), tab(4, 2, 5), tab(5, 2, 40), tab(6, 1, 20)];
  assert.deepEqual([...heldTabIds(tabs, 2)].sort(), [2, 3, 4, 5]);
});

test('a tab never visited is not held, and 0 holds nothing', () => {
  const tabs = [tab(1, 1, undefined), tab(2, 1, 0), tab(3, 1, 9)];
  assert.deepEqual([...heldTabIds(tabs, 5)], [3]);
  assert.equal(heldTabIds(tabs, 0).size, 0);
});

test('Recent lists tabs newest first; Most used ranks the rest by faded use', () => {
  const now = 1_000_000_000_000;
  const tabs = [tab(1, 1, now - 1000), tab(2, 1, now - 5000), tab(3, 2, now - 9000), tab(4, 1, now - 99999)];
  const usage = { 'https://e.com/4': { score: 9, at: now }, 'https://e.com/3': { score: 2, at: now }, 'https://e.com/1': { score: 50, at: now } };
  const { recent, used } = recentLists(tabs, usage, now, { recent: 2, used: 5 });
  assert.deepEqual(recent.map((t) => t.id), [1, 2]);
  // tab 1 is already in Recent, so it is not listed again under Most used
  assert.deepEqual(used.map((t) => t.id), [4, 3]);
});

test('extension and chrome pages are left out of both lists', () => {
  const now = 1_000_000_000_000;
  const tabs = [tab(1, 1, now, { url: 'chrome://settings' }), tab(2, 1, now - 1, { url: 'chrome-extension://x/sidepanel.html' }), tab(3, 1, now - 2)];
  const { recent } = recentLists(tabs, {}, now, { recent: 5, used: 5 });
  assert.deepEqual(recent.map((t) => t.id), [3]);
});
