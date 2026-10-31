const K1 = 1.2;
const B = 0.75;
// A single Han ideograph or Hangul syllable can be a word; a single kana is usually a particle such as "の".
const SINGLE_OK = /^[\u3400-\u9fff\uac00-\ud7af]$/;

// Runs of words separated only by spaces, split wherever punctuation or a dropped token came between.
// Words that touch with no space (Japanese, Chinese) also start a new run: joining them with a space would invent a phrase.
function runs(text, lang) {
  const seg = new Intl.Segmenter(lang || undefined, { granularity: 'word' });
  const out = [[]];
  const brk = () => { if (out.at(-1).length) out.push([]); };
  let spaced = true;
  for (const { segment, isWordLike } of seg.segment(String(text ?? ''))) {
    if (!isWordLike) {
      if (/^\s+$/.test(segment)) spaced = true;
      else brk();
      continue;
    }
    const t = segment.toLowerCase();
    if (/^\d+$/.test(t) || ([...t].length === 1 && !SINGLE_OK.test(t))) {
      brk();
      continue;
    }
    if (!spaced) brk();
    spaced = false;
    out.at(-1).push(t);
  }
  return out.filter((r) => r.length);
}

export function tokenize(text, lang) {
  return runs(text, lang).flat();
}

export function index(docs) {
  const entries = docs.map(({ id, text }) => {
    const tf = new Map();
    const tokens = tokenize(text);
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    return { id, tf, len: tokens.length };
  });
  const df = new Map();
  for (const e of entries) for (const t of e.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avgLen = entries.reduce((s, e) => s + e.len, 0) / (entries.length || 1) || 1;
  return { entries, df, avgLen, n: entries.length };
}

const idf = (n, df) => Math.log(1 + (n - df + 0.5) / (df + 0.5));

export function score(idx, query) {
  const terms = [...new Set(tokenize(query))];
  return idx.entries
    .map((e) => {
      let s = 0;
      for (const t of terms) {
        const f = e.tf.get(t);
        if (!f) continue;
        s += idf(idx.n, idx.df.get(t)) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * e.len / idx.avgLen));
      }
      return { id: e.id, score: s };
    })
    .sort((a, b) => b.score - a.score);
}

// Terms shared by several of the user's own documents but not by most of them.
export function candidateTerms(docs, { minDocs = 2, max = 12 } = {}) {
  const n = docs.length;
  const sets = new Map();
  const add = (term, id) => {
    if (!sets.has(term)) sets.set(term, new Set());
    sets.get(term).add(id);
  };
  const docRuns = docs.map((d) => ({ id: d.id, runs: runs(d.text) }));
  for (const { id, runs: rs } of docRuns) for (const r of rs) for (const t of r) add(t, id);
  for (const { id, runs: rs } of docRuns) {
    for (const r of rs) for (let i = 0; i + 1 < r.length; i++) add(`${r[i]} ${r[i + 1]}`, id);
  }
  const ok = (term) => {
    const c = sets.get(term)?.size ?? 0;
    return c >= minDocs && c <= n / 2;
  };
  const kept = [...sets.keys()].filter(ok).map((term) => {
    const ids = sets.get(term);
    return { term, docIds: [...ids], score: ids.size * idf(n, ids.size) };
  });
  const same = (a, b) => a.docIds.length === b.docIds.length && a.docIds.every((x) => b.docIds.includes(x));
  const bigrams = kept.filter((c) => c.term.includes(' '));
  // A bigram stands in for one of its words only when its other word is itself a candidate, so "the acme" cannot hide "acme".
  const result = kept.filter((c) => {
    if (c.term.includes(' ')) return true;
    return !bigrams.some((b) => {
      const [x, y] = b.term.split(' ');
      const other = x === c.term ? y : y === c.term ? x : null;
      return other !== null && ok(other) && same(b, c);
    });
  });
  return result.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term)).slice(0, max);
}
