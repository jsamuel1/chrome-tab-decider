// Once Chrome says its built-in model is unavailable (blocked by policy), TabSage stops asking, because
// each check puts an error on chrome://extensions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { stillBlocked, afterCheck, RECHECK_MS } = await import('../src/lib/llm-blocked.js');

test('an unavailable answer is trusted in the same Chrome for a week', () => {
  const rec = afterCheck('unavailable', 'Chrome/142', 1000);
  assert.deepEqual(rec, { ua: 'Chrome/142', at: 1000 });
  assert.ok(stillBlocked(rec, 'Chrome/142', 1000 + RECHECK_MS - 1));
  assert.equal(stillBlocked(rec, 'Chrome/142', 1000 + RECHECK_MS), false, 'never checked again');
  assert.equal(stillBlocked(rec, 'Chrome/143', 2000), false, 'a Chrome update may lift it');
  assert.equal(stillBlocked(rec, 'Chrome/142', 500), false, 'a clock that went back');
  assert.equal(stillBlocked(null, 'Chrome/142'), false);
  for (const a of ['available', 'downloadable', 'downloading', 'unsupported']) assert.equal(afterCheck(a, 'Chrome/142'), null);
});

test('pages ask the background, which remembers, rather than checking themselves', () => {
  const options = readFileSync(new URL('../src/options/options.js', import.meta.url), 'utf8');
  assert.ok(!/llmAvailability\(\)/.test(options), 'Settings checks the built-in model itself');
  const bgjs = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
  assert.match(bgjs, /stillBlocked\(/);
});
