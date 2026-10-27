// Self-test against the upstream reference (strands_decider, PyTorch fp32 CPU, hobson-v19):
// checks tokenization/option positions exactly and probabilities within quantization tolerance.

const CASES = [
  {
    id: 'payouts/noul', state: 'Help! My payouts have been failing for 3 days! ',
    q: { type: 'noul', instructions: 'Does this convey urgency?' },
    len: 86, opt: [62, 73], probs: [0.1713, 0.8287],
  },
  {
    id: 'payouts/choice', state: 'Help! My payouts have been failing for 3 days! ',
    q: { type: 'choice', instructions: 'Which team should handle this?', criteria: { billing: '', sales: '', retail: '' } },
    len: 68, opt: [47, 51, 55], probs: [0.8442, 0.0644, 0.0914],
  },
  {
    id: 'payouts/score', state: 'Help! My payouts have been failing for 3 days! ',
    q: { type: 'score', instructions: 'How frustrated is the writer?', criteria: ['calm', 'frustrated', 'depressed'] },
    len: 84, opt: [57, 64, 71], probs: [0.1633, 0.5715, 0.2653],
  },
  {
    id: 'strawberry', state: 'strawberry',
    q: { type: 'noul', instructions: "Are there three r's in this word?" },
    len: 81, opt: [57, 68], probs: [0.7133, 0.2867],
  },
  {
    id: 'language', state: 'sihamba ngokushesha',
    q: { type: 'choice', instructions: 'What language is this phrase in?', criteria: { english: 'English', zulu: 'isiZulu', dutch: 'Nederlands' } },
    len: 75, opt: [46, 55, 62], probs: [0.0338, 0.9563, 0.0099],
  },
];

export async function selfTest(decider) {
  await decider.load();
  const rows = [];
  for (const c of CASES) {
    const enc = decider.encode(c.state, c.q);
    const posOk = enc.ids.length === c.len && JSON.stringify(enc.optionPos) === JSON.stringify(c.opt);
    const t0 = performance.now();
    const r = await decider.ask(c.state, c.q);
    const ms = Math.round(performance.now() - t0);
    const maxDiff = Math.max(...r.probs.map((p, i) => Math.abs(p - c.probs[i])));
    const argOk = r.probs.indexOf(Math.max(...r.probs)) === c.probs.indexOf(Math.max(...c.probs));
    rows.push({
      id: c.id, tokens: enc.ids.length, positions: posOk ? 'ok' : `MISMATCH ${JSON.stringify(enc.optionPos)} vs ${JSON.stringify(c.opt)} (len ${enc.ids.length}/${c.len})`,
      probs: r.probs.map((p) => +p.toFixed(4)), expected: c.probs, maxDiff: +maxDiff.toFixed(4), top: argOk ? 'same' : 'DIFFERENT', ms,
    });
  }
  const sameModel = /hobson-v19/i.test(decider.model.repo);
  return {
    model: decider.model.label, device: decider.device,
    note: sameModel ? 'Expected values are from the same checkpoint; q4f16 typically differs by < 0.07.' : 'Reference is hobson-v19; other checkpoints will differ in probabilities — only token positions must match.',
    pass: rows.every((r) => r.positions === 'ok' && (!sameModel || r.top === 'same')),
    rows,
  };
}
