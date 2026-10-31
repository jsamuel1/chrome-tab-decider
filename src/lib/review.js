// What the user can do with a folder TabSage made on its own: keep it, rename it, fold it into another,
// or say where it belongs.

import { uid } from './store.js';

const MAX_NAME = 80;

export function reviewFolder(st, { catId, action, name, intoId }, at = Date.now()) {
  const cat = st.categories[catId];
  if (!cat) return st;
  if (action === 'keep') {
    cat.isNew = false;
  } else if (action === 'rename') {
    const next = String(name || '').trim().slice(0, MAX_NAME);
    if (next) { cat.name = next; cat.isNew = false; }
  } else if (action === 'place') {
    // where the folder belongs: under the company (work), under a category, or on its own
    if (cat.kind === 'company' || cat.kind === 'daily' || cat.source === 'system') return st;
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
    delete st.categories[catId];
  }
  return st;
}
