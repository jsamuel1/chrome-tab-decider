// Service-worker side of the AI bridge: owns the offscreen document's lifecycle.

const OFFSCREEN_URL = 'offscreen.html';
let creating = null;
export let lastAiUse = 0;

async function hasOffscreen() {
  const ctx = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return ctx.length > 0;
}

export async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['WORKERS'],
        justification: 'Runs the on-device Strands Decider classifier (WebGPU) and Chrome built-in LLM for tab categorization.',
      })
      .catch((e) => {
        if (!String(e).includes('Only a single offscreen')) throw e;
      })
      .finally(() => (creating = null));
  }
  await creating;
}

export async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

export async function ai(type, payload = {}, timeoutMs = 120000) {
  await ensureOffscreen();
  lastAiUse = Date.now();
  const res = await Promise.race([
    chrome.runtime.sendMessage({ target: 'offscreen', type, ...payload }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${type} timed out`)), timeoutMs)),
  ]);
  lastAiUse = Date.now();
  if (!res) throw new Error(`${type}: no response from engine`);
  if (!res.ok) throw new Error(res.error);
  return res.result;
}
