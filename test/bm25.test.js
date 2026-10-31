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

test('candidateTerms keeps a bigram whose first word is in most documents', () => {
  const docs = [
    { id: '1', text: 'Home Assistant a' },
    { id: '2', text: 'Home Assistant b' },
    { id: '3', text: 'Home x' },
    { id: '4', text: 'Home y' },
    { id: '5', text: 'Home z' },
    { id: '6', text: 'q r' },
  ];
  const terms = candidateTerms(docs).map((c) => c.term);
  assert.ok(terms.includes('home assistant'));
  assert.ok(terms.includes('assistant'));
  assert.ok(!terms.includes('home'));
});

test('candidateTerms does not let a bigram with a common word hide a name', () => {
  const docs = [
    { id: '1', text: 'the Acme invoice' },
    { id: '2', text: 'the Acme contract' },
    { id: '3', text: 'the cat' },
    { id: '4', text: 'the dog' },
    { id: '5', text: 'the bike' },
    { id: '6', text: 'the tax' },
  ];
  const terms = candidateTerms(docs).map((c) => c.term);
  assert.ok(terms.includes('acme'));
  assert.ok(terms.includes('the acme'));
});

test('candidateTerms only pairs words that were next to each other', () => {
  const docs = [
    { id: '1', text: 'Order 1042 - Acme' },
    { id: '2', text: 'Order 1043 - Acme' },
    { id: '3', text: 'Cat photos' },
    { id: '4', text: 'Tax forms' },
    { id: '5', text: 'Bike repair | Shop' },
    { id: '6', text: 'Guitar chords · Tabs' },
  ];
  const terms = candidateTerms(docs).map((c) => c.term);
  assert.ok(terms.includes('acme'));
  assert.ok(terms.includes('order'));
  assert.ok(!terms.includes('order acme'));
});

test('candidateTerms returns Japanese words, not particles or space-joined pairs', () => {
  const docs = [
    { id: '1', text: '京都の旅行プラン' },
    { id: '2', text: '大阪の旅行ガイド' },
    { id: '3', text: '東京の天気' },
    { id: '4', text: 'Cat photos' },
    { id: '5', text: 'Tax forms' },
    { id: '6', text: 'Bike repair' },
    { id: '7', text: 'Guitar chords' },
  ];
  const terms = candidateTerms(docs).map((c) => c.term);
  assert.ok(terms.includes('旅行'));
  assert.ok(!terms.includes('の'));
  assert.ok(!terms.some((t) => t.includes('の')));
  assert.ok(!terms.some((t) => t.includes(' ')));
});

test('tokenize keeps a single Han ideograph but drops a single kana', () => {
  const t = tokenize('猫の写真', 'ja');
  assert.ok(t.includes('猫'));
  assert.ok(!t.includes('の'));
});
