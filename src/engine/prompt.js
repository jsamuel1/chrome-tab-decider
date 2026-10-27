// Port of strands_decider/prompting.py — must stay byte-identical to the Python renderer,
// because the pointer head scores option k from the last token of option k's line.

const NOUL_DEFAULT_CRITERIA = {
  false: 'the statement does not hold for this state',
  true: 'the statement holds for this state',
};

const HEADERS = {
  noul: 'Decide whether the statement is true of the state.',
  choice: 'Select exactly one option.',
  score: 'Rate the state against the ordered levels below (lowest first).',
};

/** Keep caller text from ever producing a special token (<|endoftext|> etc.). */
export function escapeText(text) {
  return String(text ?? '').normalize('NFC').replace(/<\|([A-Za-z0-9_]+)\|>/g, '<¦$1¦>');
}

export function renderContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return escapeText(content).trim();
  return escapeText(JSON.stringify(content, null, 2));
}

export function renderState(state) {
  return `<state>\n${renderContent(state)}\n</state>\n`;
}

/**
 * question: { type: 'noul'|'choice'|'score', instructions, criteria }
 *   noul:   criteria optional {false?: str, true?: str}
 *   choice: criteria {name: description}  (or array of [name, description])
 *   score:  criteria [level0Desc, level1Desc, ...]
 * Returns { text, labels, kind, spans: [[start,end], ...] } with spans as JS string indices into text.
 */
export function renderQuestion(question) {
  const kind = question.type;
  const instructions = renderContent(question.instructions);
  let pairs;
  if (kind === 'noul') {
    const crit = { ...NOUL_DEFAULT_CRITERIA, ...(question.criteria || {}) };
    pairs = [['false', renderContent(crit.false)], ['true', renderContent(crit.true)]];
  } else if (kind === 'choice') {
    const entries = Array.isArray(question.criteria) ? question.criteria : Object.entries(question.criteria);
    pairs = entries.map(([n, d]) => [escapeText(n), renderContent(d)]);
  } else if (kind === 'score') {
    pairs = question.criteria.map((d, i) => [String(i), escapeText(d)]);
  } else {
    throw new Error(`unknown question type ${kind}`);
  }

  const lines = [];
  const blockSpans = [];
  let cursor = 0;
  for (let i = 0; i < pairs.length; i++) {
    const [name, rawDesc] = pairs[i];
    const desc = (rawDesc || '').split(/\s+/).filter(Boolean).join(' ');
    const line = `${i + 1}. ${name}` + (desc ? ` — ${desc}` : '');
    lines.push(line);
    blockSpans.push([cursor, cursor + line.length]);
    cursor += line.length + 1;
  }
  const prefix = `<question type="${kind}">\n${HEADERS[kind]}\n${instructions}\n<options>\n`;
  const text = prefix + lines.join('\n') + '\n</options>\n</question>\n<answer>';
  const base = prefix.length;
  return {
    text,
    kind,
    labels: pairs.map(([n]) => n),
    spans: blockSpans.map(([s, e]) => [base + s, base + e]),
  };
}

export function softmax(logits, temperature = 1) {
  const z = Array.from(logits, (x) => x / temperature);
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/** Confidence as upstream reports it: 1 - normalized entropy-ish margin. We use the top prob. */
export function topOf(probs, labels) {
  let best = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
  return { label: labels[best], index: best, p: probs[best] };
}
