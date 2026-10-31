// Web pages reach the extension through its content scripts: they may report page details and answer
// the "Why?" card, and nothing else. The engine answers only the extension's own pages.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = { runtime: { id: 'me', getURL: (p) => `chrome-extension://me/${p}` } };
const { allowed, mayUseEngine, senderKind } = await import('../src/lib/senders.js');
const { cleanDetails } = await import('../src/lib/pagemeta.js');

const tab = { id: 3, windowId: 1, url: 'https://evil.example.com/' };
const page = { id: 'me', tab, frameId: 0, url: 'https://evil.example.com/' };
const pageFrame = { ...page, frameId: 4, url: 'https://ads.example.net/' };
const why = { id: 'me', tab, frameId: 7, url: 'chrome-extension://me/why.html' };
const options = { id: 'me', tab: { id: 9 }, frameId: 0, url: 'chrome-extension://me/options.html' };
const popup = { id: 'me', url: 'chrome-extension://me/popup.html' };
const worker = { id: 'me', url: 'chrome-extension://me/background.js' };
const otherExtension = { id: 'someone-else', url: 'chrome-extension://someone-else/x.html' };

test('a content script may only report page details, from the top frame', () => {
  assert.equal(senderKind(page), 'page');
  assert.equal(allowed('pageDetails', page), true);
  assert.equal(allowed('pageDetails', pageFrame), false);
  for (const type of ['exportData', 'search', 'setSettings', 'forgetDomain', 'deleteArchived', 'resetAll', 'status', 'saveReason', 'whyQuestion']) {
    assert.equal(allowed(type, page), false, `a web page could call ${type}`);
  }
});

test("the Why? card's frame may only ask its question and answer it", () => {
  assert.equal(senderKind(why), 'why');
  assert.equal(allowed('whyQuestion', why), true);
  assert.equal(allowed('saveReason', why), true);
  assert.equal(allowed('exportData', why), false);
  assert.equal(allowed('pageDetails', why), false);
});

test("the extension's own pages, in a tab or not, may make every call; other extensions none", () => {
  for (const s of [options, popup, worker]) {
    assert.equal(allowed('exportData', s), true);
    assert.equal(mayUseEngine(s), true);
  }
  assert.equal(allowed('pageDetails', otherExtension), false);
  assert.equal(mayUseEngine(otherExtension), false);
  assert.equal(mayUseEngine(page), false, 'a web page could use the engine directly');
  assert.equal(mayUseEngine(why), false);
});

test('page details are cut back to the six known items, each a string of at most 200 characters', () => {
  const d = cleanDetails({ title: 'x'.repeat(5000), description: { evil: true }, h1: 'Hello', extra: 'not kept', lang: 'en' });
  assert.deepEqual(Object.keys(d), ['title', 'description', 'siteName', 'ogTitle', 'h1', 'lang']);
  assert.equal(d.title.length, 200);
  assert.equal(d.description, '');
  assert.equal(d.h1, 'Hello');
  assert.equal(cleanDetails('nope'), null);
  assert.equal(cleanDetails(null), null);
});
