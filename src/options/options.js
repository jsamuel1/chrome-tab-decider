import { openAppearanceSettings, bg, engine, esc, fmtBytes, progressText } from '../lib/ui-common.js';
import { MODELS } from '../engine/models.js';
import { prepareLLM } from '../engine/llm.js';

const $ = (id) => document.getElementById(id);
let settings;
let selfTesting = false;

function fillModels() {
  const sel = $('model');
  sel.innerHTML =
    Object.entries(MODELS).map(([id, m]) => `<option value="${id}">${esc(m.label)} · ${fmtBytes(m.approxBytes)}</option>`).join('') +
    `<option value="custom">Custom Hugging Face repo…</option>`;
}

function showModelHelp() {
  const m = MODELS[settings.model];
  $('customRow').hidden = settings.model !== 'custom';
  $('modelHelp').innerHTML = m
    ? `<a href="https://huggingface.co/${esc(m.repo)}" target="_blank">${esc(m.repo)}</a>${m.experimental ? ' · experimental: needs ~4 GB GPU memory' : ''}`
    : 'Any ONNX export with inputs input_ids / attention_mask / answer_pos / option_pos → logits.';
}

async function save(patch) {
  settings = await bg('setSettings', { patch });
}

async function load() {
  settings = await bg('getSettings');
  fillModels();
  for (const el of document.querySelectorAll('[data-key]')) {
    const k = el.dataset.key;
    if (el.type === 'checkbox') el.checked = !!settings[k];
    else el.value = settings[k];
    el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      save({ [k]: v }).then(() => {
        if (k === 'model') { showModelHelp(); modelStatus(); }
      });
    });
  }
  for (const k of ['repo', 'modelFile', 'dataFile', 'configFile']) {
    $('c_' + k).value = settings.customModel?.[k] || '';
    $('c_' + k).addEventListener('change', () => save({ customModel: { ...settings.customModel, [k]: $('c_' + k).value.trim() } }));
  }
  showModelHelp();
  modelStatus();
  llmStatus();
  profile();
}

const STYLE = { 'specific-work': 'By project at work, by topic otherwise', generic: 'By topic everywhere' };

// A read-only summary: the profile is edited in its own view (onboarding.html).
async function profile() {
  const { profile: p = {} } = await bg('status');
  const list = (xs) => (xs?.length ? xs.map(esc).join(', ') : '<span class="muted">—</span>');
  const rows = [
    ['Company', p.company ? esc(p.company) : '<span class="muted">—</span>'],
    ['Domains', list(p.companyDomains)],
    ['Work', p.work ? esc(p.work) : '<span class="muted">—</span>'],
    ['Projects', list(p.projects)],
    ['Grouping', esc(STYLE[p.style] || p.style || '')],
    ['Categories', list(p.categories)],
  ];
  $('profile').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}
$('openAppearance').onclick = () => openAppearanceSettings();

async function modelStatus() {
  try {
    const s = await bg('status');
    const e = s.engine;
    if (e.error) $('modelStatus').textContent = `Error: ${e.error}`;
    else if (e.loaded) $('modelStatus').innerHTML = `<b>Loaded</b> on ${esc(e.device)}${e.webgpu ? '' : ' (no WebGPU in this browser)'}`;
    else if (e.downloaded) $('modelStatus').textContent = 'Downloaded — loads automatically when needed.';
    else $('modelStatus').textContent = 'Not downloaded. TabSage leaves your tabs alone until it is.';
  } catch (err) {
    $('modelStatus').textContent = err.message;
  }
}

async function llmStatus() {
  // the background remembers an "unavailable", so opening Settings does not log Chrome's policy error again
  const a = (await bg('status')).llm;
  const text = {
    available: 'Gemini Nano ready',
    downloadable: 'Gemini Nano can be downloaded',
    downloading: 'Gemini Nano downloading…',
    // availability() gives no reason: a managed Chrome can block it by policy, or the device can fall short
    unavailable: 'Unavailable',
    unsupported: 'Prompt API not present in this Chrome (138+ required)',
  }[a] || a;
  $('llmStatus').textContent = text;
  // availability() gives no reason, so the likely ones are a hover away
  $('llmStatus').title = a === 'unavailable' ? 'Blocked by an administrator policy, or this device falls short (22 GB free disk, and more than 4 GB VRAM or 16 GB RAM).' : '';
  $('prepareLLM').hidden = a !== 'downloadable';
}

$('prepareLLM').onclick = async () => {
  $('prepareLLM').disabled = true;
  try {
    await prepareLLM((p) => ($('llmStatus').textContent = `Downloading Gemini Nano ${Math.round(p * 100)}%`));
  } catch (e) {
    alert(e.message);
  }
  $('prepareLLM').disabled = false;
  llmStatus();
};

$('loadModel').onclick = async () => {
  $('loadModel').disabled = true;
  $('modelProg').hidden = false;
  $('modelStatus').textContent = 'Starting download… (one-time; cached afterwards)';
  try {
    await engine('decider.load', { settings: await bg('getSettings') });
    bg('modelReady').catch(() => {});
  } catch (e) {
    $('modelStatus').textContent = `Failed: ${e.message}`;
  }
  $('loadModel').disabled = false;
  $('modelProg').hidden = true;
  modelStatus();
};
$('selfTest').onclick = async () => {
  const out = $('selfTestOut');
  $('selfTest').disabled = true;
  selfTesting = true;
  out.hidden = false;
  out.textContent = 'Self-test: checking the model (downloads it first if needed)…';
  try {
    const r = await engine('decider.selftest', { settings: await bg('getSettings') });
    out.textContent = `${r.pass ? 'PASS' : 'CHECK'} · ${r.model} on ${r.device}\n${r.note}\n\n` +
      r.rows.map((x) => `${x.id.padEnd(15)} tokens=${x.tokens} positions=${x.positions} top=${x.top} maxΔ=${x.maxDiff} ${x.ms}ms\n   got ${JSON.stringify(x.probs)} want ${JSON.stringify(x.expected)}`).join('\n');
  } catch (e) {
    out.textContent = 'Failed: ' + e.message;
  }
  selfTesting = false;
  $('selfTest').disabled = false;
  modelStatus();
};
$('unloadModel').onclick = async () => { await bg('unloadModel'); modelStatus(); };

chrome.runtime.onMessage.addListener((m) => {
  if (m.from !== 'offscreen') return;
  if (m.type === 'model-progress') {
    const p = m.progress;
    $('modelProg').hidden = false;
    $('modelProg').value = Math.round((p.overall || 0) * 100);
    $('modelStatus').textContent = progressText(p);
    if (selfTesting) $('selfTestOut').textContent = `Self-test: ${progressText(p)}`;
  }
  if (m.type === 'model-ready') {
    $('modelProg').hidden = true;
    modelStatus();
    if (selfTesting) $('selfTestOut').textContent = `Self-test: model loaded on ${m.device}, running the test cases…`;
  }
});

$('archivePreview').onclick = async () => {
  const urls = await bg('archivePreview');
  $('archiveMsg').textContent = urls.length ? `${urls.length} tab(s) would be trimmed` : 'Nothing to trim';
};
$('archiveNow').onclick = async () => {
  const urls = await bg('archiveNow');
  $('archiveMsg').textContent = `Trimmed ${urls.length} tab(s)`;
};
$('clearArchive').onclick = async () => {
  if (confirm('Forget all archived tabs?')) { await bg('deleteArchived', { id: '*' }); $('archiveMsg').textContent = 'Archive cleared'; }
};
$('export').onclick = async () => {
  const data = await bg('exportData');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'tabsage-export.json';
  a.click();
};
$('import').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { $('dataMsg').textContent = 'That file is not JSON.'; return; }
  if (!confirm(`Replace your TabSage settings, folders, reasons and archive with those in ${file.name}?`)) return;
  try {
    const r = await bg('importData', { data });
    $('dataMsg').textContent = `Imported ${r.folders} folder(s) and ${r.reasons} reason(s).`;
    load();
  } catch (err) {
    $('dataMsg').textContent = err.message || String(err);
  }
};
$('reset').onclick = async () => {
  if (confirm('Reset all TabSage settings, folders and archive?')) await bg('resetAll');
};

load();
