import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { pageKey, lazyUrl } = await import('../src/lib/urls.js');

test('pageKey ignores the # fragment', () => {
  assert.equal(
    pageKey('https://mail.google.com/mail/u/0/#inbox'),
    pageKey('https://mail.google.com/mail/u/0/#sent'),
  );
  assert.equal(pageKey('https://example.com/a#top'), 'https://example.com/a');
});

test('pageKey keeps the query string', () => {
  assert.equal(pageKey('https://example.com/watch?v=1#t=5'), 'https://example.com/watch?v=1');
  assert.notEqual(pageKey('https://example.com/watch?v=1'), pageKey('https://example.com/watch?v=2'));
});

test('pageKey uses the wrapped URL for lazy placeholders', () => {
  const lazy = lazyUrl({ url: 'https://example.com/doc?id=3#sec', title: 'Doc' });
  assert.equal(pageKey(lazy), 'https://example.com/doc?id=3');
});
