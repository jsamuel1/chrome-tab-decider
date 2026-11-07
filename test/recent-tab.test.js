// TabSage's Recent page, kept as the first pinned tab in each window.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { RECENT_PAGE, isRecentTab, planRecentTabs } = await import('../src/lib/recent-tab.js');

const page = RECENT_PAGE;
const tab = (id, windowId, index, extra = {}) => ({ id, windowId, index, url: 'https://e.com/', pinned: false, ...extra });

test('a window without the Recent tab gets one; a window that has it first is left alone', () => {
  const tabs = [tab(1, 1, 0), tab(2, 2, 0, { url: page, pinned: true }), tab(3, 2, 1)];
  assert.deepEqual(planRecentTabs(tabs, { windows: [1, 2] }), { create: [1], move: [], remove: [] });
});

test('a Recent tab that is not first, or not pinned, is put back first; extra copies are closed', () => {
  const tabs = [tab(1, 1, 0, { pinned: true }), tab(2, 1, 1, { url: page }), tab(3, 1, 2, { url: page, pinned: true })];
  assert.deepEqual(planRecentTabs(tabs, { windows: [1] }), { create: [], move: [3], remove: [2] });
});

test('windows where you closed it, and windows of other kinds, are skipped; off removes nothing', () => {
  const tabs = [tab(1, 1, 0), tab(2, 2, 0)];
  assert.deepEqual(planRecentTabs(tabs, { windows: [1, 2], closedIn: [2] }), { create: [1], move: [], remove: [] });
  assert.deepEqual(planRecentTabs(tabs, { windows: [1, 2], enabled: false }), { create: [], move: [], remove: [] });
});

test('the Recent tab is recognised by its address, with or without a fragment', () => {
  assert.ok(isRecentTab({ url: page }));
  assert.ok(isRecentTab({ pendingUrl: `${page}#x` }));
  assert.ok(!isRecentTab({ url: 'chrome-extension://x/options.html' }));
});
