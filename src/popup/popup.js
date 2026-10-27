import { bg, esc, faviconFor, engineSummary, ago } from '../lib/ui-common.js';
import { discoverCategories, hasPromptApi, llmAvailability } from '../engine/llm.js';

const $ = (id) => document.getElementById(id);
let status = null;
let sel = -1;
let rows = [];

async function refresh() {
  status = await bg('status');
  $('engine').innerHTML = engineSummary(status);
  const g = $('groups');
  const cats = status.categories.filter((c) => c.tabCount > 0 || c.pinned);
  g.innerHTML = cats.length
    ? cats.map((c) => `
      <div class="row" data-cat="${c.id}" data-gid="${c.groupIds[0] ?? ''}">
        <span class="dot" style="background:var(--g-${c.color})"></span>
        <span class="t">${esc(c.name)}</span>
        <span class="meta">${c.tabCount} tab${c.tabCount === 1 ? '' : 's'}</span>
        <button class="star ${c.pinned ? 'on' : ''}" data-pin="${c.id}" title="${c.pinned ? 'Unpin group' : 'Pin group to the front'}">${c.pinned ? '★' : '☆'}</button>
      </div>`).join('')
    : `<div class="empty">No groups yet — press Organize.</div>`;
  $('foot').textContent = `${status.archiveCount} archived · trims unvisited tabs after ${status.settings.archiveDays} days` +
    (status.stats?.organizedAt ? ` · organized ${ago(status.stats.organizedAt)}` : '');
}

$('groups').addEventListener('click', async (e) => {
  const pin = e.target.closest('[data-pin]');
  if (pin) {
    e.stopPropagation();
    const cat = status.categories.find((c) => c.id === pin.dataset.pin);
    await bg('setPinned', { catId: cat.id, pinned: !cat.pinned });
    return refresh();
  }
  const row = e.target.closest('[data-gid]');
  if (row?.dataset.gid) {
    const tabs = await chrome.tabs.query({ groupId: Number(row.dataset.gid) });
    if (tabs[0]) {
      await chrome.tabGroups.update(Number(row.dataset.gid), { collapsed: false });
      await bg('focusTab', { tabId: tabs[0].id, windowId: tabs[0].windowId });
    }
  }
});

async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try { await fn(); } catch (e) { alert(e.message); } finally {
    btn.disabled = false;
    btn.textContent = label;
    refresh();
  }
}

$('organize').onclick = () => busy($('organize'), () => bg('organize', {}));
$('rediscover').onclick = () =>
  busy($('rediscover'), async () => {
    // If the engine page can't reach the Prompt API, run the title pass here (extension page, user gesture).
    let categories = null;
    if (status?.llm === 'unsupported' && hasPromptApi() && status.settings.useLLM && (await llmAvailability()) !== 'unavailable') {
      const tabs = (await chrome.tabs.query({ windowType: 'normal' })).filter((t) => /^https?:/.test(t.url || ''));
      const items = tabs.map((t) => ({ domain: new URL(t.url).hostname.replace(/^www\./, ''), title: t.title || '' }));
      categories = await discoverCategories(items, [], { max: status.settings.maxGroups });
    }
    await bg('organize', { rediscover: true, categories });
  });
$('settings').onclick = () => chrome.runtime.openOptionsPage();

// ---------- search
let searchTimer;
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 80);
});

async function runSearch() {
  const q = $('q').value;
  $('home').hidden = !!q;
  $('results').hidden = !q;
  if (!q) return;
  const r = await bg('search', { query: q });
  const row = (it, i) => `
    <div class="row" data-i="${i}">
      <img src="${esc(faviconFor(it.url))}" alt="" />
      <span class="t" title="${esc(it.url)}">${esc(it.title || it.url)}</span>
      <span class="meta">${esc(it.catName || '')}${it.kind === 'archived' ? ' · ' + ago(it.archivedAt) : ''}</span>
      ${it.kind === 'archived' ? `<button class="x" data-del="${it.id}" title="Forget">✕</button>` : ''}
    </div>`;
  rows = [...r.open, ...r.archived];
  $('openList').innerHTML = r.open.map((it, i) => row(it, i)).join('') || (r.archived.length ? '' : '<div class="empty">No matches</div>');
  $('archHead').hidden = !r.archived.length;
  $('archList').innerHTML = r.archived.map((it, i) => row(it, i + r.open.length)).join('');
  sel = rows.length ? 0 : -1;
  paintSel();
}

function paintSel() {
  document.querySelectorAll('#results .row').forEach((el) => el.classList.toggle('sel', Number(el.dataset.i) === sel));
  document.querySelector('#results .row.sel')?.scrollIntoView({ block: 'nearest' });
}

async function openRow(i, e) {
  const it = rows[i];
  if (!it) return;
  if (it.kind === 'open') await bg('focusTab', { tabId: it.tabId, windowId: it.windowId });
  else await bg('reopen', { id: it.id, lazy: !!(e && (e.metaKey || e.ctrlKey)) });
  window.close();
}

$('results').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    await bg('deleteArchived', { id: del.dataset.del });
    return runSearch();
  }
  const r = e.target.closest('[data-i]');
  if (r) openRow(Number(r.dataset.i), e);
});

document.addEventListener('keydown', (e) => {
  if ($('results').hidden) return;
  if (e.key === 'ArrowDown') { sel = Math.min(rows.length - 1, sel + 1); paintSel(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paintSel(); e.preventDefault(); }
  if (e.key === 'Enter' && sel >= 0) openRow(sel, e);
});

chrome.runtime.onMessage.addListener((m) => {
  if (m.from === 'offscreen' && (m.type === 'model-progress' || m.type === 'model-ready') && status) {
    if (m.type === 'model-progress') status.engine = { ...status.engine, loading: true, progress: m.progress };
    else status.engine = { ...status.engine, loading: false, loaded: true, downloaded: true, device: m.device };
    $('engine').innerHTML = engineSummary(status);
  }
});

refresh();
