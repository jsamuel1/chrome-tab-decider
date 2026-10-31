// Service-worker side of the AI bridge: owns the offscreen document's lifecycle.

const OFFSCREEN_URL = 'offscreen.html';
let creating = null;

export async function hasOffscreen() {
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

/** Close the engine once nothing has run in it for idleMin minutes; busy downloads keep it open. */
export async function unloadIfIdle(idleMin) {
  if (!(await hasOffscreen())) return false;
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'engine.idle' });
  const r = res?.ok && res.result;
  if (!r || r.busy || r.idleMs < idleMin * 60000) return false;
  await closeOffscreen();
  return true;
}

async function realAi(type, payload = {}, timeoutMs = 120000) {
  await ensureOffscreen();
  const res = await Promise.race([
    chrome.runtime.sendMessage({ target: 'offscreen', type, ...payload }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${type} timed out`)), timeoutMs)),
  ]);
  if (!res) throw new Error(`${type}: no response from engine`);
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

let impl = realAi;

export function ai(type, payload, timeoutMs) {
  return impl(type, payload, timeoutMs);
}

/** Tests swap the engine call for a stub; pass nothing to restore it. */
export function setAiForTest(fn) {
  impl = fn || realAi;
}

/** True only once the classifier is downloaded; with no model TabSage leaves every tab alone. */
export async function classifierReady(settings) {
  try {
    const r = await ai('decider.status', { settings }, 15000);
    return !!r?.downloaded;
  } catch {
    return false;
  }
}
