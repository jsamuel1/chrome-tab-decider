// What the user can do with a folder TabSage made on its own: keep it, rename it, fold it into another,
// or say where it belongs.

import { uid } from './store.js';

const MAX_NAME = 80;
const key = (name) => String(name || '').trim().toLowerCase();

// Names of folders you merged, deleted or renamed. Folder discovery does not propose them again, so a
// merged "aws" does not come back as a new folder the next time your tabs are organized.
export function retireName(st, name, { revive = false } = {}) {
  const k = key(name);
  if (!k) return;
  st.retiredNames = st.retiredNames || {};
  if (revive) delete st.retiredNames[k];
  else st.retiredNames[k] = Date.now();
}
export const isRetired = (st, name) => !!st.retiredNames?.[key(name)];

/** Rename a folder. A name another folder has is refused (the caller can offer a merge instead). */
export function renameFolder(st, catId, name) {
  const cat = st.categories[catId];
  if (!cat) return { error: 'missing' };
  const next = String(name || '').trim().slice(0, MAX_NAME);
  if (!next) return { error: 'empty' };
  const other = Object.values(st.categories).find((c) => c.id !== catId && key(c.name) === key(next));
  if (other) return { clash: { id: other.id, name: other.name } };
  if (key(cat.name) !== key(next)) retireName(st, cat.name);
  retireName(st, next, { revive: true });
  cat.name = next;
  cat.isNew = false;
  return { ok: true };
}

export function reviewFolder(st, { catId, action, name, intoId }, at = Date.now()) {
  const cat = st.categories[catId];
  if (!cat) return st;
  if (action === 'keep') {
    cat.isNew = false;
  } else if (action === 'rename') {
    renameFolder(st, catId, name);
  } else if (action === 'place') {
    // where the folder belongs: under the company (work), under a category, or on its own
    if (cat.kind === 'company' || cat.source === 'system') return st;
    const parent = st.categories[intoId];
    const top = parent && (parent.kind === 'company' || (parent.kind === 'personal' && !parent.parentId && parent.source !== 'system'));
    if (intoId && (!top || intoId === catId)) return st;
    if (parent?.kind === 'company') {
      cat.kind = 'work';
      cat.parentId = parent.id;
    } else {
      cat.kind = 'personal';
      cat.parentId = parent ? parent.id : null;
    }
  } else if (action === 'merge') {
    const into = st.categories[intoId];
    if (!into || intoId === catId) return st;
    for (const m of Object.values(st.pageMap)) if (m.catId === catId) m.catId = intoId;
    for (const r of Object.values(st.siteRules)) if (r.catId === catId) r.catId = intoId;
    for (const r of st.reasons) if (r.catId === catId) r.catId = intoId;
    st.reasons.push({
      id: uid('r'), catId: intoId, optionId: 'merge', text: `Merged ${cat.name} into ${into.name}`, scope: 'page', host: '', url: '', at,
    });
    retireName(st, cat.name);
    delete st.categories[catId];
  }
  return st;
}
