// What the user can do with a folder TabSage made on its own: keep it, rename it, or fold it into another.

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
