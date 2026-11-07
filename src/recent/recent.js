// The Recent page: TabSage's pinned first tab, listing your most recently used tabs, then the open
// pages you use most. It never moves a tab; it only switches to one.

import { bg, esc, faviconFor } from '../lib/ui-common.js';

const $ = (id) => document.getElementById(id);

function rows(list, start) {
  return list.map((t, i) => `
    <div class="row" role="option" tabindex="-1" data-i="${start + i}" data-id="${t.id}" data-win="${t.windowId}" title="${esc(t.url)}">
      <img src="${esc(t.icon || faviconFor(t.url))}" alt="" />
      <span class="t">${esc(t.title || t.url)}</span>
    </div>`).join('');
}

// fresh: coming back to this tab, so the top row (the tab you were just on) is the one Enter opens
async function render(fresh = false) {
  const keep = !fresh && document.activeElement?.dataset?.id;
  const { recent, used } = await bg('recentLists', { recent: 15, used: 10 });
  $('recentList').innerHTML = rows(recent, 0) || '<div class="empty">No recent tabs yet</div>';
  $('usedHead').hidden = !used.length;
  $('usedList').innerHTML = rows(used, recent.length);
  const again = keep && document.querySelector(`.row[data-id="${CSS.escape(keep)}"]`);
  (again || document.querySelector('.row[data-id]'))?.focus();
}

async function open(row) {
  await chrome.tabs.update(Number(row.dataset.id), { active: true });
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

// Kept current as you switch tabs (the page's visibility events are not reliable for a pinned tab
// that is in the background), and fresh whenever you come back to it.
let timer = 0;
const later = (fresh = false) => {
  clearTimeout(timer);
  timer = setTimeout(() => render(fresh), 150);
};
const self = chrome.tabs.getCurrent();
chrome.tabs.onActivated.addListener(async ({ tabId }) => later(tabId === (await self)?.id));
chrome.tabs.onCreated.addListener(() => later());
chrome.tabs.onRemoved.addListener(() => later());
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.title || info.url || info.status === 'complete') later(); });

render(true);
