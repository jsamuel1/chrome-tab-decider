// Tokenization with byte offsets for a byte-level BPE tokenizer (Qwen3.5).
// @huggingface/tokenizers does not return offset mappings, so we rebuild them from
// the byte-level token strings: every token maps back to an exact run of UTF-8 bytes.

import { Tokenizer } from '@huggingface/tokenizers';

// GPT-2 bytes_to_unicode, inverted: unicode char -> byte value.
const BYTE_DECODER = (() => {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const m = new Map();
  bs.forEach((b, i) => m.set(String.fromCharCode(cs[i]), b));
  return m;
})();

const enc = new TextEncoder();
export const utf8Len = (s) => enc.encode(s).length;

export class DeciderTokenizer {
  constructor(tokenizerJson, tokenizerConfig) {
    this.tok = new Tokenizer(tokenizerJson, tokenizerConfig);
    this.special = new Set(
      (tokenizerJson.added_tokens || []).map((t) => t.content)
    );
  }

  /** Byte length of one token string. */
  tokenBytes(token) {
    if (this.special.has(token)) return utf8Len(token);
    let n = 0;
    for (const ch of token) {
      if (BYTE_DECODER.has(ch)) n += 1;
      else n += utf8Len(ch); // not byte-level-mapped (shouldn't happen); best effort
    }
    return n;
  }

  /** ids + [lo, hi) byte offsets of each token within text. */
  encodeWithOffsets(text, { addSpecial = false } = {}) {
    const e = this.tok.encode(text, { add_special_tokens: addSpecial });
    const offsets = [];
    let cur = 0;
    for (const t of e.tokens) {
      const n = this.tokenBytes(t);
      offsets.push([cur, cur + n]);
      cur += n;
    }
    return { ids: e.ids, offsets, totalBytes: cur };
  }

  encode(text, { addSpecial = false } = {}) {
    return this.tok.encode(text, { add_special_tokens: addSpecial }).ids;
  }
}

/**
 * Port of infer._option_token_index: last token index fully inside each option span.
 * spans are JS string index pairs into `text`; converted to UTF-8 byte offsets here.
 */
export function optionTokenIndex(text, offsets, spans, base = 0) {
  return spans.map(([s, e]) => {
    const a = utf8Len(text.slice(0, s));
    const b = utf8Len(text.slice(0, e));
    let last = -1;
    for (let j = 0; j < offsets.length; j++) {
      const [lo, hi] = offsets[j];
      if (hi <= lo) continue;
      if (lo >= a && hi <= b) last = j;
    }
    if (last < 0) throw new Error(`option span (${a},${b}) has no tokens`);
    return base + last;
  });
}
