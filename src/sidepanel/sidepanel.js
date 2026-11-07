// The Recent side panel: your most recently used tabs, then the open pages you use most, one click away.
// It never moves a tab; it only switches to one.

import { bg, esc, faviconFor } from '../lib/ui-common.js';

const $ = (id) => document.getElementById(id);

function rows(list, start) {
  return list.map((t, i) => `
    <div class="row${t.active ? ' current' : ''}" role="option" tabindex="-1" data-i="${start + i}" data-id="${t.id}" data-win="${t.windowId}" title="${esc(t.url)}">
      <img src="${esc(faviconFor(t.url))}" alt="" />
      <span class="t">${esc(t.title || t.url)}</span>
    </div>`).join('');
}

async function render() {
  const keep = document.activeElement?.dataset?.id;
  const { recent, used } = await bg('recentLists');
  $('recentList').innerHTML = rows(recent, 0) || '<div class="empty">No recent tabs yet</div>';
  $('usedHead').hidden = !used.length;
  $('usedList').innerHTML = rows(used, recent.length);
  if (keep) document.querySelector(`.row[data-id="${CSS.escape(keep)}"]`)?.focus();
}

async function open(row) {
  const id = Number(row.dataset.id);
  await chrome.tabs.update(id, { active: true });
  await chrome.windows.update(Number(row.dataset.win), { focused: true });
}

document.addEventListener('click', (e) => {
  const row = e.target.closest('.row[data-id]');
  if (row) open(row);
});

document.addEventListener('keydown', (e) => {
  const all = [...document.querySelectorAll('.row[data-id]')];
  if (!all.length) return;
  const at = all.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = at === -1 ? 0 : (at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    all[next].focus();
  } else if (e.key === 'Enter' && at !== -1) {
    e.preventDefault();
    open(all[at]);
  }
});

// Keep the lists current as tabs are switched, opened, closed or change page.
let timer = 0;
const later = () => {
  clearTimeout(timer);
  timer = setTimeout(render, 150);
};
chrome.tabs.onActivated.addListener(later);
chrome.tabs.onCreated.addListener(later);
chrome.tabs.onRemoved.addListener(later);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.title || info.url || info.status === 'complete') later(); });

render();
