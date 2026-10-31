import test from 'node:test';
import assert from 'node:assert/strict';

const { extractDetails } = await import('../src/content/extract.js');

function fakeDoc({ title = '', meta = {}, h1, lang = '', body } = {}) {
  return {
    title,
    body,
    documentElement: { lang },
    querySelector(sel) {
      if (sel === 'h1') return h1 === undefined ? null : { textContent: h1 };
      const m = sel.match(/^meta\[(name|property)="?([^"\]]+)"?\]$/);
      if (m && meta[m[2]] !== undefined) return { getAttribute: (a) => (a === 'content' ? meta[m[2]] : null), content: meta[m[2]] };
      return null;
    },
  };
}

test('reads all six fields', () => {
  const d = extractDetails(fakeDoc({
    title: 'Page title',
    meta: { description: 'A description', 'og:site_name': 'Example', 'og:title': 'OG title' },
    h1: 'Heading',
    lang: 'en-AU',
  }));
  assert.deepEqual(d, {
    title: 'Page title', description: 'A description', siteName: 'Example',
    ogTitle: 'OG title', h1: 'Heading', lang: 'en-AU',
  });
});

test('trims and collapses whitespace', () => {
  const d = extractDetails(fakeDoc({ title: '  a \n\t b  ', h1: ' x   y ' }));
  assert.equal(d.title, 'a b');
  assert.equal(d.h1, 'x y');
});

test('caps values at 200 characters', () => {
  const d = extractDetails(fakeDoc({ meta: { description: 'x'.repeat(500) } }));
  assert.equal(d.description.length, 200);
});

test('missing tags give empty strings', () => {
  assert.deepEqual(extractDetails(fakeDoc()), {
    title: '', description: '', siteName: '', ogTitle: '', h1: '', lang: '',
  });
});

test('body text is never returned', () => {
  const d = extractDetails(fakeDoc({ title: 't', body: { innerText: 'SECRET', textContent: 'SECRET' } }));
  assert.ok(!JSON.stringify(d).includes('SECRET'));
});
