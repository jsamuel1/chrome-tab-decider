// Offscreen document: hosts the WebGPU decider and the Prompt API session(s).
// The service worker can't keep a GPU session alive, so it talks to us via messages.

import { Decider } from '../engine/decider.js';
import { resolveModel } from '../engine/models.js';
import { selfTest } from '../engine/selftest.js';
import { discoverCategories, llmAvailability, llmAssign } from '../engine/llm.js';
import { createActivity, handle } from './activity.js';
import { mayUseEngine } from '../lib/senders.js';

let decider = null;
let deciderKey = '';
let lastProgress = null;
const activity = createActivity();

function getDecider(settings) {
  const model = resolveModel(settings);
  const key = JSON.stringify(model);
  if (!decider || deciderKey !== key) {
    decider?.release();
    decider = new Decider(model);
    deciderKey = key;
  }
  return decider;
}

function broadcast(msg) {
  chrome.runtime.sendMessage({ ...msg, from: 'offscreen' }).catch(() => {});
}

const handlers = {
  async 'decider.status'({ settings }) {
    const d = getDecider(settings);
    return {
      model: d.model.label,
      downloaded: await d.isDownloaded(),
      loaded: !!d.session,
      loading: !!d.loading,
      device: d.device,
      progress: lastProgress,
      webgpu: !!navigator.gpu,
    };
  },

  async 'decider.load'({ settings }) {
    const d = getDecider(settings);
    await d.load({
      device: settings.device,
      onProgress: (p) => {
        lastProgress = p;
        broadcast({ type: 'model-progress', progress: p });
      },
    });
    lastProgress = null;
    broadcast({ type: 'model-ready', device: d.device });
    return { loaded: true, device: d.device };
  },

  /** Classify one domain cluster. options: [{name, description}] */
  async 'decider.choice'({ settings, state, instructions, options }) {
    const d = getDecider(settings);
    if (!d.session) {
      if (!(await d.isDownloaded())) return { error: 'not-downloaded' };
      await handlers['decider.load']({ settings });
    }
    const criteria = options.map((o) => [o.name, o.description || '']);
    return d.ask(state, { type: 'choice', instructions, criteria });
  },

  async 'decider.noul'({ settings, state, instructions }) {
    const d = getDecider(settings);
    if (!d.session) {
      if (!(await d.isDownloaded())) return { error: 'not-downloaded' };
      await handlers['decider.load']({ settings });
    }
    return d.ask(state, { type: 'noul', instructions });
  },

  async 'decider.prefetch'({ settings }) {
    const d = getDecider(settings);
    if (await d.isDownloaded()) return { downloaded: true, cached: true };
    await d.prefetch((p) => {
      lastProgress = p;
      broadcast({ type: 'model-progress', progress: p });
    });
    lastProgress = null;
    broadcast({ type: 'model-downloaded' });
    return { downloaded: true };
  },

  async 'decider.selftest'({ settings }) {
    const d = getDecider(settings);
    await handlers['decider.load']({ settings });
    return selfTest(d);
  },

  'engine.idle'() {
    return activity.idle();
  },

  async 'decider.unload'() {
    await decider?.release();
    return { ok: true };
  },

  async 'llm.availability'() {
    return { availability: await llmAvailability() };
  },

  async 'llm.discover'({ items, existing, max, mode }) {
    if ((await llmAvailability()) !== 'available') return { error: 'llm-unavailable' };
    return { categories: await discoverCategories(items, existing, { max, mode }) };
  },

  async 'llm.assign'({ state, names }) {
    if ((await llmAvailability()) !== 'available') return { error: 'llm-unavailable' };
    return { folder: await llmAssign(state, names) };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  // content scripts in web pages reach every extension context: the engine answers only our own
  const h = Object.hasOwn(handlers, msg.type) && handlers[msg.type];
  if (!h || !mayUseEngine(sender)) return false;
  Promise.resolve()
    .then(() => handle(activity, msg.type, () => h(msg)))
    .then((r) => sendResponse({ ok: true, result: r }))
    .catch((e) => {
      console.error('[TabSage offscreen]', msg.type, e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    });
  return true;
});
