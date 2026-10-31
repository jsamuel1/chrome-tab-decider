// Page details are kept only for pages open in a tab TabSage organises, under one key per page.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
const removed = [];
let openTabs = [];
globalThis.chrome = {
  storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } },
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  tabs: { query: async () => openTabs, remove: async (ids) => removed.push(...ids) },
};

const { detailsCount, detailsKey, pruneTabMeta } = await import('../src/lib/pagemeta.js');
const { migrate, getState } = await import('../src/lib/store.js');
const { runArchive } = await import('../src/lib/archive.js');

const tab = (url, extra = {}) => ({ id: 1, windowId: 1, url, groupId: -1, ...extra });

test('details are keyed by pageKey, which drops the #fragment', () => {
  const sender = { tab: tab('https://mail.google.com/mail/u/0/#inbox'), frameId: 0 };
  assert.equal(detailsKey(sender, 'https://mail.google.com/mail/u/0/#inbox', 'normal'), 'https://mail.google.com/mail/u/0/');
});

test('details from incognito tabs are never kept', () => {
  const sender = { tab: tab('https://example.com/a', { incognito: true }), frameId: 0 };
  assert.equal(detailsKey(sender, 'https://example.com/a', 'normal'), null);
});

test('details are dropped without a tab, from popups, sub-frames, unorganised pages or another page', () => {
  const url = 'https://example.com/a';
  assert.equal(detailsKey({}, url, 'normal'), null);
  assert.equal(detailsKey({ tab: tab(url), frameId: 0 }, url, 'popup'), null);
  assert.equal(detailsKey({ tab: tab(url), frameId: 3 }, url, 'normal'), null);
  assert.equal(detailsKey({ tab: tab(url, { pinned: true }), frameId: 0 }, url, 'normal'), null);
  assert.equal(detailsKey({ tab: tab('chrome://settings'), frameId: 0 }, 'chrome://settings', 'normal'), null);
  assert.equal(detailsKey({ tab: tab('https://example.com/b'), frameId: 0 }, url, 'normal'), null);
});

test('pruneTabMeta forgets pages no longer open, and incognito ones', () => {
  const st = { tabMeta: {
    'https://example.com/a': { details: { title: 'A' } },
    'https://closed.example/x': { details: { title: 'gone' } },
    'https://private.example/': { lastAccessed: 1 },
  } };
  const n = pruneTabMeta(st, [
    tab('https://example.com/a#section'),
    tab('https://private.example/', { incognito: true }),
  ]);
  assert.equal(n, 2);
  assert.deepEqual(Object.keys(st.tabMeta), ['https://example.com/a']);
});

test('migrate folds full-URL tabMeta keys into their pageKey', () => {
  const st = migrate({ categories: {}, tabMeta: {
    'https://mail.google.com/mail/u/0/#inbox': { firstSeen: 5, lastAccessed: 50 },
    'https://mail.google.com/mail/u/0/': { firstSeen: 10, lastAccessed: 20, details: { title: 'Inbox' } },
    'https://example.com/b#top': { firstSeen: 1, lastAccessed: 2 },
  } });
  assert.deepEqual(st.tabMeta, {
    'https://mail.google.com/mail/u/0/': { firstSeen: 5, lastAccessed: 50, details: { title: 'Inbox' } },
    'https://example.com/b': { firstSeen: 1, lastAccessed: 2 },
  });
});

test('archiving a tab removes its one tabMeta entry, details included', async () => {
  store.settings = { archiveEnabled: true, archiveDays: 7 };
  const st = await getState();
  const old = Date.now() - 30 * 864e5;
  st.tabMeta['https://app.example/'] = { firstSeen: old, lastAccessed: old, details: { title: 'Board' } };
  openTabs = [tab('https://app.example/#/board', { id: 7, lastAccessed: old })];
  const closed = await runArchive();
  assert.deepEqual(closed, ['https://app.example/#/board']);
  assert.deepEqual(removed, [7]);
  assert.deepEqual(st.tabMeta, {});
});

test('detailsCount counts the open organised tabs whose page has stored details', () => {
  const st = { tabMeta: {
    'https://a.com/': { details: { title: 'A' } },
    'https://b.com/': { lastAccessed: 1 },
    'https://c.com/': { details: { title: 'C' } },
  } };
  const tabs = [
    tab('https://a.com/#x'),
    tab('https://b.com/'),
    tab('https://c.com/', { incognito: true }),
    tab('chrome://version/'),
    tab('https://gone.com/'),
  ];
  assert.equal(detailsCount(st, tabs), 1);
  assert.equal(detailsCount({}, tabs), 0);
});
