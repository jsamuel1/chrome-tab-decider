import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, index, score, candidateTerms } from '../src/lib/bm25.js';

test('tokenize keeps product names and lower-cases', () => {
  const t = tokenize('ESP32-S3 Technical Reference');
  assert.ok(t.includes('esp32'));
  assert.ok(t.includes('technical'));
});

test('tokenize drops bare numbers and single letters', () => {
  assert.deepEqual(tokenize('a 2024 b report'), ['report']);
});

test('tokenize splits Japanese into words', () => {
  assert.ok(tokenize('京都の旅行プラン', 'ja').length > 1);
});

test('score ranks the document containing the query first', () => {
  const idx = index([
    { id: 'a', text: 'Quarterly report for the board' },
    { id: 'b', text: 'Acme invoice March' },
  ]);
  const ranked = score(idx, 'acme');
  assert.equal(ranked[0].id, 'b');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('candidateTerms finds shared names and ignores words found everywhere', () => {
  const docs = [
    { id: '1', text: 'Acme invoice March - the portal' },
    { id: '2', text: 'Acme contract draft - the portal' },
    { id: '3', text: 'Acme onboarding - the portal' },
    { id: '4', text: 'ESP32 datasheet - the shop' },
    { id: '5', text: 'ESP32 pinout - the shop' },
    { id: '6', text: 'Sourdough starter - the blog' },
  ];
  const terms = candidateTerms(docs).map((c) => c.term);
  assert.ok(terms.includes('acme'));
  assert.ok(terms.includes('esp32'));
  assert.ok(!terms.includes('the'));
});

test('candidateTerms lets a bigram replace unigrams covering the same documents', () => {
  const docs = [
    { id: '1', text: 'Home Assistant dashboard' },
    { id: '2', text: 'Home Assistant automations' },
    { id: '3', text: 'Cat photos' },
    { id: '4', text: 'Tax forms' },
    { id: '5', text: 'Bike repair' },
    { id: '6', text: 'Guitar chords' },
  ];
  const terms = candidateTerms(docs).map((c) => c.term);
  assert.deepEqual(terms, ['home assistant']);
});
