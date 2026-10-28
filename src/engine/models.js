// Model registry. Every entry follows the same fused-graph contract:
//   input_ids [B,L] i64, attention_mask [B,L] i64, answer_pos [B] i64, option_pos [B,K] i64 -> logits [B,K] f32
// Temperatures per question kind are read from the repo's config file.

export const MODELS = {
  'decider-v1-2610-q4f16': {
    label: 'Strands Decider 2B qwen3.5 v1-2610 · q4f16 (ONNX) — newest, built by this repo\'s model workflow',
    repo: 'sauhsoj/strands-decider-2B-qwen3.5-v1-2610-ONNX',
    modelFile: 'onnx/model_q4f16.onnx',
    dataFile: 'onnx/model_q4f16.onnx_data',
    configFile: 'config.json',
    selftestFile: 'selftest.json',
    approxBytes: 1_110_000_000,
    needsF16: true,
  },
  'decider-v19-q4f16': {
    label: 'Strands Decider 2B hobson-v19 · q4f16 (ONNX, onnx-community)',
    repo: 'onnx-community/strands-decider-2B-hobson-v19-ONNX',
    modelFile: 'onnx/model_q4f16.onnx',
    dataFile: 'onnx/model_q4f16.onnx_data',
    configFile: 'config.json',
    approxBytes: 1_093_633_663,
    needsF16: true,
  },
  'decider-v19-q8': {
    label: 'Strands Decider 2B hobson-v19 · q8 (ONNX) — more accurate on near-ties',
    repo: 'onnx-community/strands-decider-2B-hobson-v19-ONNX',
    modelFile: 'onnx/model_quantized.onnx',
    dataFile: 'onnx/model_quantized.onnx_data',
    configFile: 'config.json',
    approxBytes: 1_801_446_454,
    needsF16: true,
  },
  'decider-v1-2610-fp16': {
    label: 'Strands Decider 2B qwen3.5 v1-2610 · fp16 (community ONNX, 3.9 GB, experimental)',
    repo: 'warsang/strands-decider-2b-qwen3v1-web',
    modelFile: 'model.onnx',
    dataFile: 'model.onnx.data',
    configFile: 'strands_decider_config.json',
    approxBytes: 3_933_429_124,
    needsF16: true,
    experimental: true,
  },
};

export const DEFAULT_MODEL = 'decider-v1-2610-q4f16';

export function resolveModel(settings) {
  if (settings.model === 'custom') {
    const c = settings.customModel || {};
    if (!c.repo || !c.modelFile) throw new Error('Custom model needs a repo and model file');
    return { label: `Custom: ${c.repo}`, configFile: 'config.json', ...c, id: 'custom' };
  }
  const id = settings.model in MODELS ? settings.model : DEFAULT_MODEL;
  return { ...MODELS[id], id };
}

export const hfUrl = (repo, file, rev = 'main') =>
  `https://huggingface.co/${repo}/resolve/${rev}/${file.split('/').map(encodeURIComponent).join('/')}`;

/** Temperatures from either config layout. */
export function readTemperatures(cfg) {
  const d = cfg?.decider || cfg || {};
  const t = d.temperature_by_kind || {};
  const fallback = typeof d.temperature === 'number' ? d.temperature : 1;
  return {
    noul: t.noul ?? fallback,
    choice: t.choice ?? fallback,
    score: t.score ?? fallback,
    maxLength: d.max_length ?? 4096,
  };
}
