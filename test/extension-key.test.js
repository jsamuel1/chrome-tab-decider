import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { extensionId, readKey } from '../scripts/extension-key.mjs';

// The Store item TabSage publishes to; unpacked builds should share its ID.
const STORE_ID = 'nkoonilbdonbnmoepiojghknbadnckhm';

test('a key reads the same from a PEM block or bare base64, and gives a 32-letter a-p ID', () => {
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
  const bare = readKey(pem);
  assert.ok(!/\s|-----/.test(bare));
  assert.equal(readKey(`\n  ${bare.slice(0, 40)}\n${bare.slice(40)}  `), bare);
  assert.match(extensionId(bare), /^[a-p]{32}$/);
});

test('the committed key is the Store item\'s, so unpacked builds get its ID', { skip: !existsSync('static/extension-key.txt') }, () => {
  assert.equal(extensionId(readKey(readFileSync('static/extension-key.txt', 'utf8'))), STORE_ID);
});
