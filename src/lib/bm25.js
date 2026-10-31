const K1 = 1.2;
const B = 0.75;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

export function tokenize(text, lang) {
  const seg = new Intl.Segmenter(lang || undefined, { granularity: 'word' });
  const out = [];
  for (const { segment, isWordLike } of seg.segment(String(text ?? ''))) {
    if (!isWordLike) continue;
    const t = segment.toLowerCase();
    if (/^\d+$/.test(t)) continue;
    if ([...t].length === 1 && !CJK.test(t)) continue;
    out.push(t);
  }
  return out;
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
  const tokenLists = docs.map((d) => ({ id: d.id, tokens: tokenize(d.text) }));
  for (const { id, tokens } of tokenLists) for (const t of tokens) add(t, id);
  const ok = (term) => {
    const c = sets.get(term)?.size ?? 0;
    return c >= minDocs && c <= n / 2;
  };
  // Bigrams only join two words that pass the filter themselves, so "the acme" can never shadow "acme".
  for (const { id, tokens } of tokenLists) {
    for (let i = 0; i + 1 < tokens.length; i++) {
      if (ok(tokens[i]) && ok(tokens[i + 1])) add(`${tokens[i]} ${tokens[i + 1]}`, id);
    }
  }
  const kept = [...sets.keys()].filter(ok).map((term) => {
    const ids = sets.get(term);
    return { term, docIds: [...ids], score: ids.size * idf(n, ids.size) };
  });
  const same = (a, b) => a.docIds.length === b.docIds.length && a.docIds.every((x) => b.docIds.includes(x));
  const bigrams = kept.filter((c) => c.term.includes(' '));
  const result = kept.filter((c) => {
    if (c.term.includes(' ')) return true;
    return !bigrams.some((b) => b.term.split(' ').includes(c.term) && same(b, c));
  });
  return result.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term)).slice(0, max);
}
