// Helpers shared by popup and options pages.

export async function bg(type, payload = {}) {
  const r = await chrome.runtime.sendMessage({ target: 'background', type, ...payload });
  if (!r) throw new Error('No response from TabSage background');
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

/** Ask the offscreen engine directly (for calls that can outlast the service worker). */
export async function engine(type, payload = {}) {
  await bg('ensureEngine');
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...payload });
  if (!r) throw new Error('No response from the TabSage engine');
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function faviconFor(pageUrl, size = 16) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl || '');
  u.searchParams.set('size', String(size));
  return u.toString();
}

export function ago(ts) {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`);

/** One line for a model-progress broadcast: {file, loaded, total, overall, stage}. */
export function progressText(p) {
  if (p.stage === 'compiling') return 'Creating WebGPU session…';
  const pct = p.overall ? ` (${Math.round(p.overall * 100)}% overall)` : '';
  return `Downloading ${p.file} — ${fmtBytes(p.loaded)}${p.total ? ' / ' + fmtBytes(p.total) : ''}${pct}`;
}

export function engineSummary(status) {
  const e = status.engine || {};
  const parts = [];
  if (e.error) parts.push(`<span class="warn">Engine error: ${esc(e.error)}</span>`);
  else if (e.loading && e.progress) {
    const pct = Math.round((e.progress.overall || 0) * 100);
    parts.push(`Classifier: <b>Waiting for the classifier: ${e.progress.stage === 'compiling' ? 'compiling shaders…' : `downloading ${pct}%`}</b><progress max="100" value="${pct}"></progress>`);
  } else if (e.loaded) parts.push(`Classifier: <b class="ok">Strands Decider ready</b> (${esc(e.device)})`);
  else if (e.downloaded) parts.push(`Classifier: <b>Strands Decider</b> downloaded, loads on demand`);
  else parts.push(`Classifier: <span class="warn">Waiting for the classifier</span> — <a href="options.html" target="_blank">download in Settings</a>. TabSage leaves your tabs alone until it is ready.`);
  const llm = {
    available: '<b class="ok">ready</b>',
    downloadable: '<span class="warn">needs download (Settings)</span>',
    downloading: 'downloading…',
    unavailable: '<span class="warn">unavailable (blocked by policy, or unsupported device)</span>',
    unsupported: 'not exposed to background — runs from this popup',
  }[status.llm] || esc(status.llm);
  parts.push(`Folder discovery (built-in LLM): ${status.settings.useLLM ? llm : 'off'}`);
  return parts.join('<br>');
}
