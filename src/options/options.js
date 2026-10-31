import { bg, engine, esc, fmtBytes, progressText } from '../lib/ui-common.js';
import { MODELS } from '../engine/models.js';
import { llmAvailability, prepareLLM } from '../engine/llm.js';

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
  cats();
  review();
  profile();
}

const PROFILE_TEXT = { company: 'p_company', work: 'p_work', style: 'p_style' };
const PROFILE_LISTS = { companyDomains: 'p_domains', projects: 'p_projects', categories: 'p_categories' };

async function profile() {
  const { profile: p = {} } = await bg('status');
  for (const [k, id] of Object.entries(PROFILE_TEXT)) $(id).value = p[k] || $(id).value;
  for (const [k, id] of Object.entries(PROFILE_LISTS)) $(id).value = (p[k] || []).join(', ');
}
$('saveProfile').onclick = async () => {
  const p = {};
  for (const [k, id] of Object.entries(PROFILE_TEXT)) p[k] = $(id).value;
  for (const [k, id] of Object.entries(PROFILE_LISTS)) p[k] = $(id).value.split(',').map((x) => x.trim()).filter(Boolean);
  $('saveProfile').disabled = true;
  try {
    await bg('saveProfile', { profile: p });
    $('profileMsg').textContent = 'Saved';
    cats();
  } catch (e) {
    $('profileMsg').textContent = `Failed: ${e.message}`;
  }
  $('saveProfile').disabled = false;
};
$('rerunOnboarding').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });

async function modelStatus() {
  try {
    const s = await bg('status');
    const e = s.engine;
    if (e.error) $('modelStatus').textContent = `Error: ${e.error}`;
    else if (e.loaded) $('modelStatus').innerHTML = `<b>Loaded</b> on ${esc(e.device)}${e.webgpu ? '' : ' (no WebGPU in this browser)'}`;
    else if (e.downloaded) $('modelStatus').textContent = 'Downloaded — loads automatically when needed.';
    else $('modelStatus').textContent = 'Not downloaded. Until then TabSage uses the built-in LLM or keyword matching.';
  } catch (err) {
    $('modelStatus').textContent = err.message;
  }
}

async function llmStatus() {
  const a = await llmAvailability();
  const text = {
    available: 'Gemini Nano ready',
    downloadable: 'Gemini Nano can be downloaded',
    downloading: 'Gemini Nano downloading…',
    // availability() gives no reason: a managed Chrome can block it by policy, or the device can fall short
    unavailable: 'Not available in this Chrome. Either an administrator policy blocks it (managed browsers), or the device falls short (22 GB free disk, and more than 4 GB VRAM or 16 GB RAM).',
    unsupported: 'Prompt API not present in this Chrome (138+ required)',
  }[a] || a;
  $('llmStatus').textContent = text;
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

async function cats() {
  const s = await bg('status');
  $('cats').innerHTML = s.categories.map((c) => `
    <tr>
      <td><span class="dot" style="display:inline-block;background:var(--g-${c.color})"></span>
        <input type="text" value="${esc(c.name)}" data-rename="${c.id}" style="width:auto;display:inline-block;padding:3px 6px" ${c.id === 'other' ? 'disabled' : ''}/>
        ${c.pinned ? '★' : ''}</td>
      <td><div class="chips">${c.domains.map((d) => `<span class="chip" data-forget="${esc(d)}" title="Forget — re-classify next time">${esc(d)}</span>`).join('') || '<span class="muted">—</span>'}</div></td>
      <td>${c.id === 'other' ? '' : `<button data-del="${c.id}">Delete</button>`}</td>
    </tr>`).join('');
}
$('cats').addEventListener('click', async (e) => {
  const f = e.target.closest('[data-forget]');
  if (f) { await bg('forgetDomain', { domain: f.dataset.forget }); return cats(); }
  const d = e.target.closest('[data-del]');
  if (d && confirm('Delete this folder? Its domains will be re-classified.')) { await bg('deleteCategory', { catId: d.dataset.del }); cats(); }
});
$('cats').addEventListener('change', async (e) => {
  const r = e.target.closest('[data-rename]');
  if (r && r.value.trim()) { await bg('renameCategory', { catId: r.dataset.rename, name: r.value.trim() }); cats(); }
});
async function review() {
  const s = await bg('status');
  const fresh = s.categories.filter((c) => c.isNew);
  $('newNone').hidden = fresh.length > 0;
  $('newFolders').innerHTML = fresh.map((c) => `
    <tr data-new="${c.id}">
      <td><input type="text" value="${esc(c.name)}" data-newname style="width:auto;display:inline-block;padding:3px 6px" /></td>
      <td>${c.tabCount} tab${c.tabCount === 1 ? '' : 's'}</td>
      <td>
        <button data-keep>Keep</button>
        <button data-rename>Rename</button>
        <select data-merge><option value="">Merge into…</option>${s.categories.filter((o) => o.id !== c.id && o.id !== 'daily' && !o.isNew).map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
      </td>
    </tr>`).join('');
  $('reasonsNone').hidden = s.reasons.length > 0;
  $('reasons').innerHTML = s.reasons.map((r) => `
    <tr><td>${esc(r.text)}</td><td><button data-delreason="${r.id}">Delete</button></td></tr>`).join('');
}
async function reviewAction(e) {
  const row = e.target.closest('[data-new]');
  if (!row) return;
  const catId = row.dataset.new;
  if (e.target.matches('[data-keep]')) await bg('reviewFolder', { catId, action: 'keep' });
  else if (e.target.matches('[data-rename]')) await bg('reviewFolder', { catId, action: 'rename', name: row.querySelector('[data-newname]').value });
  else if (e.target.matches('[data-merge]') && e.target.value) await bg('reviewFolder', { catId, action: 'merge', intoId: e.target.value });
  else return;
  cats();
  review();
}
$('newFolders').addEventListener('click', reviewAction);
$('newFolders').addEventListener('change', reviewAction);
$('reasons').addEventListener('click', async (e) => {
  const d = e.target.closest('[data-delreason]');
  if (!d) return;
  await bg('deleteReason', { id: d.dataset.delreason });
  cats();
  review();
});

$('addCat').onclick = async () => {
  const name = $('newCat').value.trim();
  if (!name) return;
  await bg('addCategory', { name, description: '' });
  $('newCat').value = '';
  cats();
};

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
$('reset').onclick = async () => {
  if (confirm('Reset all TabSage settings, folders and archive?')) await bg('resetAll');
};

load();
