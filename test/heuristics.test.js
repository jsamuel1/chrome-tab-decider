import test from 'node:test';
import assert from 'node:assert/strict';
import { heuristicDiscover, heuristicAssign, hostHint } from '../src/lib/heuristics.js';
import { registrable, hostOf } from '../src/lib/urls.js';

test('registrable domain handles AU/UK suffixes', () => {
  assert.equal(registrable('mail.google.com'), 'google.com');
  assert.equal(registrable('www.abc.net.au'), 'abc.net.au');
  assert.equal(registrable('shop.bunnings.com.au'), 'bunnings.com.au');
  assert.equal(hostOf('https://www.github.com/x'), 'github.com');
});

test('keyword discovery finds cross-domain topics', () => {
  const items = [
    { domain: 'github.com', title: 'espressif/esp-idf: ESP32 framework' },
    { domain: 'docs.espressif.com', title: 'ESP32-S3 Technical Reference' },
    { domain: 'reddit.com', title: 'r/esp32 display help' },
    { domain: 'booking.com', title: 'Hotels in Tokyo' },
  ];
  const cats = heuristicDiscover(items, 6).map((c) => c.name);
  assert.ok(cats.includes('ESP32'), cats.join(','));
  assert.equal(hostHint('github.com'), 'Dev');
});

test('keyword assignment', () => {
  const c = heuristicAssign('docs.espressif.com', ['ESP32 pinout'], [{ name: 'ESP32', description: '' }, { name: 'Travel', description: '' }]);
  assert.equal(c.name, 'ESP32');
});
