import { bg, esc, progressText } from '../lib/ui-common.js';

const $ = (id) => document.getElementById(id);
const steps = [...document.querySelectorAll('.step')];
const last = steps.length - 1;
let at = 0;

const split = (s, sep) => String(s || '').split(sep).map((x) => x.trim()).filter(Boolean);

function chip(container, value, checked, cls = 'chip') {
  const id = `${container.id}-${container.children.length}`;
  container.insertAdjacentHTML('beforeend',
    `<label class="${cls}" for="${id}"><input type="checkbox" id="${id}" value="${esc(value)}" ${checked ? 'checked' : ''} /> ${esc(value)}</label>`);
}
const ticked = (container) => [...container.querySelectorAll('input:checked')].map((i) => i.value);
const listed = (container) => new Set([...container.querySelectorAll('input')].map((i) => i.value.toLowerCase()));

function addCategory(name, checked = true) {
  const box = $('categories');
  if (!name || listed(box).has(name.toLowerCase())) return;
  chip(box, name, checked, 'check');
}

function show(i) {
  at = i;
  steps.forEach((s, j) => { s.hidden = j !== i; });
  $('back').hidden = i === 0 || i === last;
  $('next').hidden = i === last;
  $('next').textContent = i === last - 1 ? 'Finish' : 'Next';
  $('where').textContent = i === last ? '' : `${i + 1} of ${last}`;
  steps[i].querySelector('input:not([type=checkbox]):not([type=radio]), textarea')?.focus();
}

async function finish() {
  $('next').disabled = true;
  const profile = {
    company: $('company').value,
    companyDomains: [...ticked($('domains')), ...split($('moreDomains').value, ',')],
    work: $('work').value,
    projects: split($('projects').value, /\n|,/),
    style: document.querySelector('input[name=style]:checked').value,
    categories: ticked($('categories')),
  };
  try {
    await bg('saveProfile', { profile });
    show(last);
    downloadStatus();
  } catch (e) {
    alert(`Could not save: ${e.message}`);
  }
  $('next').disabled = false;
}

async function downloadStatus() {
  try {
    const s = await bg('status');
    if (s.engine?.error) $('dlStatus').textContent = `Classifier problem: ${s.engine.error}`;
    else if (s.ready) {
      $('dlStatus').textContent = 'The classifier is ready. Your tabs are being sorted.';
      $('dlProg').hidden = true;
    } else if (!s.engine?.loading) $('dlStatus').textContent = 'Waiting for the classifier to download…';
  } catch (e) {
    $('dlStatus').textContent = e.message;
  }
}

chrome.runtime.onMessage.addListener((m) => {
  if (m.from !== 'offscreen' || at !== last) return;
  if (m.type === 'model-progress') {
    $('dlProg').hidden = false;
    $('dlProg').value = Math.round((m.progress.overall || 0) * 100);
    $('dlStatus').textContent = progressText(m.progress);
  }
  if (m.type === 'model-ready') downloadStatus();
});

$('steps').addEventListener('submit', (e) => {
  e.preventDefault();
  if (at === last - 1) finish();
  else show(at + 1);
});
$('back').onclick = () => show(at - 1);
$('addCategory').onclick = () => {
  addCategory($('newCategory').value.trim());
  $('newCategory').value = '';
  $('newCategory').focus();
};
$('newCategory').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  $('addCategory').click();
});
$('company').addEventListener('input', () => {
  const name = $('company').value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  for (const i of $('domains').querySelectorAll('input')) {
    if (name && i.value.split('.')[0].replace(/-/g, '') === name) i.checked = true;
  }
});
$('openSettings').onclick = () => chrome.runtime.openOptionsPage();

async function load() {
  const [status, sug] = await Promise.all([bg('status').catch(() => null), bg('onboardingSuggestions').catch(() => ({ domains: [], categories: [] }))]);
  const p = status?.profile || {};
  $('company').value = p.company || '';
  $('work').value = p.work || '';
  $('projects').value = (p.projects || []).join('\n');
  const style = document.querySelector(`input[name=style][value="${p.style}"]`);
  if (style) style.checked = true;

  // Saved domains stay ticked; of the suggested ones, those named after the company are ticked as it is typed.
  const saved = new Set(p.companyDomains || []);
  for (const d of p.companyDomains || []) chip($('domains'), d, true);
  for (const d of sug.domains.slice(0, 8)) if (!saved.has(d)) chip($('domains'), d, false);

  for (const c of p.categories || []) addCategory(c, true);
  for (const c of sug.categories) addCategory(c, false);
  show(0);
}

load();
