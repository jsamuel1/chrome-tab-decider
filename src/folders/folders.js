// Folders: review the new ones TabSage proposed, merge, rename, nest and delete folders, and see the reasons you gave.
import { bg, esc } from '../lib/ui-common.js';
import { describeReason, newestFirst } from '../lib/reasons.js';

const $ = (id) => document.getElementById(id);

// "Belongs under": the company (its folders are work) or one of the high-level personal folders.
function placeSelect(c, all) {
  if (c.kind === 'company' || c.source === 'system') return '<span class="muted">—</span>';
  const tops = all.filter((o) => o.id !== c.id && (o.kind === 'company' || (o.kind === 'personal' && !o.parentId && o.source !== 'system')));
  const opt = (id, label) => `<option value="${esc(id)}" ${(c.parentId || '') === id ? 'selected' : ''}>${esc(label)}</option>`;
  return `<select data-place="${esc(c.id)}">${opt('', 'Nothing (its own folder)')}${tops.map((o) => opt(o.id, o.kind === 'company' ? `${o.name} (work)` : o.name)).join('')}</select>`;
}

// A folder's name, with a Rename button that edits it in place: Enter or Save renames, Esc or Cancel
// leaves it as it was. A name another folder already has offers to merge into that folder instead.
const nameCell = (c) => c.id === 'other'
  ? `<span class="fname">${esc(c.name)}</span>`
  : `<span class="fname">${esc(c.name)}</span><button class="link" data-edit="${esc(c.id)}" aria-label="Rename ${esc(c.name)}">Rename</button>`;

function startRename(btn) {
  const cell = btn.closest('.namecell');
  const name = cell.querySelector('.fname').textContent;
  cell.innerHTML = `<form class="rename" data-cat="${esc(btn.dataset.edit)}">
    <input type="text" value="${esc(name)}" aria-label="New name for ${esc(name)}" maxlength="80" required />
    <button type="submit" class="primary">Save</button><button type="button" data-cancel>Cancel</button></form>`;
  const input = cell.querySelector('input');
  input.focus();
  input.select();
}

async function saveRename(form) {
  const catId = form.dataset.cat;
  const name = form.querySelector('input').value.trim();
  if (!name) return;
  const r = await bg('renameCategory', { catId, name });
  if (r?.clash) {
    if (!confirm(`There is already a folder called ${r.clash.name}. Merge this folder into it? Its tabs move there, and this folder is gone for good.`)) {
      return form.querySelector('input').focus();
    }
    await bg('reviewFolder', { catId, action: 'merge', intoId: r.clash.id });
    say(`Merged into ${r.clash.name}.`);
  } else if (r?.ok) say(`Renamed to ${name}.`);
  refresh();
}

const say = (text) => { $('folderMsg').textContent = text; };
const refresh = () => { cats(); review(); };

document.addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  if (edit) return startRename(edit);
  if (e.target.closest('[data-cancel]')) refresh();
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form.rename');
  if (!form) return;
  e.preventDefault();
  saveRename(form);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.closest('form.rename')) { e.preventDefault(); refresh(); }
});

async function cats() {
  const s = await bg('status');
  $('cats').innerHTML = s.categories.map((c) => `
    <tr>
      <td><div class="namecell"><span class="dot" style="background:var(--g-${c.color})"></span>${nameCell(c)}${c.pinned ? ' <span title="Pinned">★</span>' : ''}</div></td>
      <td>${placeSelect(c, s.categories)}</td>
      <td><div class="chips">${c.domains.map((d) => `<span class="chip" data-forget="${esc(d)}" title="Forget: pages on this site are decided one by one again">${esc(d)}</span>`).join('') || '<span class="muted">—</span>'}</div></td>
      <td>${c.id === 'other' ? '' : `<button data-del="${c.id}">Delete</button>`}</td>
    </tr>`).join('');
}
$('cats').addEventListener('click', async (e) => {
  const f = e.target.closest('[data-forget]');
  if (f) { await bg('forgetDomain', { domain: f.dataset.forget }); return cats(); }
  const d = e.target.closest('[data-del]');
  if (d && confirm('Delete this folder? Its pages will be decided again, and the sites you bound to it are let go.')) { await bg('deleteCategory', { catId: d.dataset.del }); cats(); }
});
$('cats').addEventListener('change', async (e) => {
  const p = e.target.closest('[data-place]');
  if (p) { await bg('reviewFolder', { catId: p.dataset.place, action: 'place', intoId: p.value }); cats(); review(); }
});
async function review() {
  const s = await bg('status');
  const fresh = s.categories.filter((c) => c.isNew);
  $('newNone').hidden = fresh.length > 0;
  $('newCount').textContent = fresh.length ? `· ${fresh.length}` : '';
  $('newFolders').innerHTML = fresh.map((c) => `
    <tr data-new="${c.id}">
      <td><div class="namecell">${nameCell(c)}</div></td>
      <td class="muted">${c.tabCount} tab${c.tabCount === 1 ? '' : 's'}</td>
      <td><div class="acts">
        <button data-keep>Keep</button>
        <select data-merge><option value="">Merge into…</option>${s.categories.filter((o) => o.id !== c.id && !o.isNew).map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
        <label class="small muted">Belongs under ${placeSelect(c, s.categories)}</label>
      </div></td>
    </tr>`).join('');
  $('reasonsNone').hidden = s.reasons.length > 0;
  $('reasons').innerHTML = newestFirst(s.reasons).map((r) => `
    <tr><td>${esc(describeReason(r, s.categories))}</td><td><button data-delreason="${r.id}">Delete</button></td></tr>`).join('');
}
async function reviewAction(e) {
  const row = e.target.closest('[data-new]');
  if (!row) return;
  const catId = row.dataset.new;
  if (e.target.matches('[data-keep]')) await bg('reviewFolder', { catId, action: 'keep' });
  else if (e.target.matches('[data-place]') && e.type === 'change') await bg('reviewFolder', { catId, action: 'place', intoId: e.target.value });
  else if (e.target.matches('[data-merge]') && e.target.value && e.type === 'change') {
    // merging cannot be undone, so a stray arrow key on the list must not do it
    const name = row.querySelector('.fname')?.textContent || '';
    const target = e.target.selectedOptions[0]?.textContent || '';
    if (!confirm(`Merge ${name} into ${target}? Its tabs move there, and ${name} is gone for good.`)) {
      e.target.value = '';
      return;
    }
    await bg('reviewFolder', { catId, action: 'merge', intoId: e.target.value });
  } else return;
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


cats();
review();
