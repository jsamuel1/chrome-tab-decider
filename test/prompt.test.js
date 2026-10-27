// Prompt rendering must match strands_decider/prompting.py byte-for-byte.
// Expected strings come from the upstream reference fixtures (conversion/fixtures/reference.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderState, renderQuestion, softmax } from '../src/engine/prompt.js';
import { optionTokenIndex } from '../src/engine/tokens.js';

const S = 'Help! My payouts have been failing for 3 days! ';

test('noul prompt matches upstream', () => {
  const q = renderQuestion({ type: 'noul', instructions: 'Does this convey urgency?' });
  assert.equal(renderState(S) + q.text,
    '<state>\nHelp! My payouts have been failing for 3 days!\n</state>\n<question type="noul">\nDecide whether the statement is true of the state.\nDoes this convey urgency?\n<options>\n1. false — the statement does not hold for this state\n2. true — the statement holds for this state\n</options>\n</question>\n<answer>');
  assert.deepEqual(q.labels, ['false', 'true']);
});

test('choice prompt (empty and non-empty descriptions)', () => {
  const q = renderQuestion({ type: 'choice', instructions: 'Which team should handle this?', criteria: { billing: '', sales: '', retail: '' } });
  assert.ok(q.text.endsWith('<options>\n1. billing\n2. sales\n3. retail\n</options>\n</question>\n<answer>'));
  const q2 = renderQuestion({ type: 'choice', instructions: 'What language is this phrase in?', criteria: { english: 'English', zulu: 'isiZulu', dutch: 'Nederlands' } });
  assert.ok(q2.text.includes('1. english — English\n2. zulu — isiZulu\n3. dutch — Nederlands\n'));
});

test('score prompt', () => {
  const q = renderQuestion({ type: 'score', instructions: 'How frustrated is the writer?', criteria: ['calm', 'frustrated', 'depressed'] });
  assert.ok(q.text.includes('Rate the state against the ordered levels below (lowest first).\nHow frustrated is the writer?\n<options>\n1. 0 — calm\n2. 1 — frustrated\n3. 2 — depressed\n'));
  assert.deepEqual(q.labels, ['0', '1', '2']);
});

test('option spans cover exactly each option line', () => {
  const q = renderQuestion({ type: 'choice', instructions: 'x', criteria: [['Dev', 'code'], ['Travel Plans', '']] });
  assert.deepEqual(q.spans.map(([s, e]) => q.text.slice(s, e)), ['1. Dev — code', '2. Travel Plans']);
});

test('special tokens in titles are neutralised', () => {
  const q = renderQuestion({ type: 'noul', instructions: 'a <|endoftext|> b' });
  assert.ok(!q.text.includes('<|endoftext|>'));
});

test('optionTokenIndex picks last token fully inside the span (byte offsets, multibyte)', () => {
  const text = 'ab\n1. é—x\nz';
  const enc = new TextEncoder();
  // fake tokenization: one token per character, with UTF-8 byte offsets
  let cur = 0; const offsets = [];
  for (const ch of text) { const n = enc.encode(ch).length; offsets.push([cur, cur + n]); cur += n; }
  const s = text.indexOf('1.'), e = text.indexOf('\nz');
  const [idx] = optionTokenIndex(text, offsets, [[s, e]], 100);
  assert.equal(idx, 100 + [...text].indexOf('x'));
});

test('softmax with temperature', () => {
  const p = softmax([1, 1], 0.7);
  assert.ok(Math.abs(p[0] - 0.5) < 1e-9);
});
