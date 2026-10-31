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

// What the worker last learnt from the engine: the classifier is downloaded, and on which device it
// runs. Kept in session storage too. A passive status check (sorting and organizing, on every tab
// switch) is answered from it while the engine is unloaded, so the check alone neither wakes the
// engine nor keeps it from counting as idle.
let known = null;
const readyKey = (settings) => JSON.stringify([settings?.model, settings?.customModel, settings?.device]);

async function remember(settings, status) {
  known = status?.downloaded ? { key: readyKey(settings), device: status.device || known?.device || '' } : null;
  const session = chrome.storage.session;
  await (known ? session?.set({ deciderReady: known }) : session?.remove('deciderReady'))?.catch(() => {});
}

async function knownReady(settings) {
  if (!known) known = (await chrome.storage.session?.get('deciderReady').catch(() => null))?.deciderReady || null;
  return known?.key === readyKey(settings) ? { downloaded: true, device: known.device, passive: true } : null;
}

async function realAi(type, payload = {}, timeoutMs = 120000) {
  if (type === 'decider.status' && payload.passive && !(await hasOffscreen())) {
    const r = await knownReady(payload.settings);
    if (r) return r;
  }
  await ensureOffscreen();
  const res = await Promise.race([
    chrome.runtime.sendMessage({ target: 'offscreen', type, ...payload }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${type} timed out`)), timeoutMs)),
  ]);
  if (!res) throw new Error(`${type}: no response from engine`);
  if (!res.ok) throw new Error(res.error);
  if (type === 'decider.status') await remember(payload.settings, res.result);
  // the model's files were cleared from the cache since: ask the engine again next time
  else if (res.result?.error === 'not-downloaded') await remember(payload.settings, null);
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

/**
 * The classifier's status, or null when the engine cannot be reached. `passive` checks (the gate
 * before sorting or organizing) do not wake an unloaded engine when it is known to be downloaded.
 */
export async function deciderStatus(settings, { passive = false } = {}) {
  try {
    return (await ai('decider.status', { settings, ...(passive ? { passive } : {}) }, 15000)) || null;
  } catch {
    return null;
  }
}

/** True only once the classifier is downloaded; with no model TabSage leaves every tab alone. */
export async function classifierReady(settings, status) {
  return !!(status === undefined ? await deciderStatus(settings, { passive: true }) : status)?.downloaded;
}
