// Strands Decider on ONNX Runtime Web (WebGPU). One forward pass per question.

import * as ort from 'onnxruntime-web/webgpu';
import { renderQuestion, renderState, softmax, topOf } from './prompt.js';
import { DeciderTokenizer, optionTokenIndex, utf8Len } from './tokens.js';
import { hfUrl, readTemperatures } from './models.js';
import { fetchBytesCached, fetchJsonCached, isCached } from './cache.js';

let configured = false;
function configureOrt() {
  if (configured) return;
  configured = true;
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('ort/');
  ort.env.wasm.numThreads = 1; // extension pages are not cross-origin isolated
  ort.env.logLevel = 'error';
}

export class Decider {
  constructor(model) {
    this.model = model;
    this.session = null;
    this.tokenizer = null;
    this.temps = null;
    this.device = null;
    this.loading = null;
  }

  files() {
    const m = this.model;
    const f = [m.configFile, 'tokenizer.json', 'tokenizer_config.json', m.modelFile];
    if (m.dataFile) f.push(m.dataFile);
    return f.map((file) => ({ file, url: hfUrl(m.repo, file) }));
  }

  async isDownloaded() {
    for (const { url } of this.files()) if (!(await isCached(url))) return false;
    return true;
  }

  /** Download (if needed) and create the session. onProgress({file, loaded, total, overall}) */
  load({ device = 'webgpu', onProgress = () => {} } = {}) {
    if (this.session) return Promise.resolve(this);
    if (!this.loading) this.loading = this._load(device, onProgress).finally(() => (this.loading = null));
    return this.loading;
  }

  async _load(device, onProgress) {
    configureOrt();
    const m = this.model;
    const approx = m.approxBytes || 0;
    let done = 0;
    const prog = (file) => (loaded, total) =>
      onProgress({ file, loaded, total, overall: approx ? Math.min(1, (done + loaded) / approx) : 0 });

    const cfg = await fetchJsonCached(hfUrl(m.repo, m.configFile), prog(m.configFile)).catch(() => ({}));
    this.temps = readTemperatures(cfg);
    const tj = await fetchJsonCached(hfUrl(m.repo, 'tokenizer.json'), prog('tokenizer.json'));
    const tc = await fetchJsonCached(hfUrl(m.repo, 'tokenizer_config.json'), prog('tokenizer_config.json'));
    this.tokenizer = new DeciderTokenizer(tj, tc);

    const graph = await fetchBytesCached(hfUrl(m.repo, m.modelFile), prog(m.modelFile));
    done += graph.byteLength;
    let data = null;
    if (m.dataFile) {
      data = await fetchBytesCached(hfUrl(m.repo, m.dataFile), prog(m.dataFile));
      done += data.byteLength;
    }
    onProgress({ file: 'session', loaded: 1, total: 1, overall: 1, stage: 'compiling' });

    let ep = device;
    if (ep === 'webgpu') {
      const adapter = navigator.gpu && (await navigator.gpu.requestAdapter());
      if (!adapter) ep = 'wasm';
      else if (m.needsF16 && !adapter.features.has('shader-f16')) {
        console.warn('[TabSage] GPU lacks shader-f16; falling back to wasm (slow)');
        ep = 'wasm';
      }
    }
    const opts = {
      executionProviders: [ep],
      graphOptimizationLevel: 'all',
    };
    if (data) opts.externalData = [{ path: m.dataFile.split('/').pop(), data }];
    this.session = await ort.InferenceSession.create(graph, opts);
    this.device = ep;
    return this;
  }

  /** Build ids + positions for one question. */
  encode(state, question) {
    const stateText = renderState(state);
    const rq = renderQuestion(question);
    const s = this.tokenizer.encodeWithOffsets(stateText, { addSpecial: true });
    const q = this.tokenizer.encodeWithOffsets(rq.text);
    if (q.totalBytes !== utf8Len(rq.text)) throw new Error('tokenizer offsets do not cover the question text');

    let stateIds = s.ids;
    // Give the question first claim on the window (state is truncated from the end of its body).
    const maxLen = this.temps.maxLength;
    if (stateIds.length + q.ids.length > maxLen) {
      const keep = Math.max(16, maxLen - q.ids.length);
      const tail = this.tokenizer.encode('\n</state>\n');
      stateIds = stateIds.slice(0, keep - tail.length).concat(tail);
    }
    const optionPos = optionTokenIndex(rq.text, q.offsets, rq.spans, stateIds.length);
    const ids = stateIds.concat(q.ids);
    return { ids, optionPos, answerPos: ids.length - 1, rq };
  }

  async ask(state, question) {
    await this.load();
    const { ids, optionPos, answerPos, rq } = this.encode(state, question);
    const L = ids.length;
    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, L]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(L).fill(1n), [1, L]),
      answer_pos: new ort.Tensor('int64', BigInt64Array.from([BigInt(answerPos)]), [1]),
      option_pos: new ort.Tensor('int64', BigInt64Array.from(optionPos, BigInt), [1, optionPos.length]),
    };
    const out = await this.session.run(feeds);
    const logits = (out.logits || Object.values(out)[0]).data;
    const probs = softmax(Array.from(logits).slice(0, rq.labels.length), this.temps[rq.kind]);
    const top = topOf(probs, rq.labels);
    return { kind: rq.kind, labels: rq.labels, probs, choice: top.label, confidence: top.p, tokens: L };
  }

  async release() {
    try { await this.session?.release(); } catch {}
    this.session = null;
  }
}
