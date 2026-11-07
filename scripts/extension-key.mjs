// The Store item's public key, which fixes the extension ID of unpacked builds (the manifest "key").
// It is public: Chrome puts it in every installed copy. The Store does not accept it in an upload.
import { createHash } from 'node:crypto';

/** The key as the manifest wants it: base64 DER, from either a PEM block or a bare base64 string. */
export function readKey(text) {
  return String(text || '').replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
}

/** The extension ID Chrome derives from a key: the first 32 hex digits of its SHA-256, written a-p. */
export function extensionId(key) {
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
