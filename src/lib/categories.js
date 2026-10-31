// Category bookkeeping shared by organizer, sorter and UI.

import { uid } from './store.js';

export const OTHER_ID = 'other';
export const DAILY_ID = 'daily';
export const COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

export function ensureOther(st, settings) {
  if (!st.categories[OTHER_ID]) {
    st.categories[OTHER_ID] = {
      id: OTHER_ID, name: settings.otherGroupName, description: 'none of the other folders fit',
      color: 'grey', pinned: false, lastActive: 0, createdAt: Date.now(), source: 'system',
    };
  }
  st.categories[OTHER_ID].name = settings.otherGroupName;
  return st.categories[OTHER_ID];
}

/** The Daily group's category, made the first time a page earns a place in it. */
export function ensureDaily(st) {
  if (!st.categories[DAILY_ID]) {
    st.categories[DAILY_ID] = {
      id: DAILY_ID, name: 'Daily', description: 'the pages you use most', color: 'grey',
      pinned: false, lastActive: 0, createdAt: Date.now(), source: 'system', kind: 'daily', parentId: null, isNew: false,
    };
  }
  return st.categories[DAILY_ID];
}

export function findByName(st, name) {
  const k = String(name || '').trim().toLowerCase();
  return Object.values(st.categories).find((c) => c.name.toLowerCase() === k) || null;
}

function pickColor(st) {
  const used = new Map(COLORS.map((c) => [c, 0]));
  for (const c of Object.values(st.categories)) if (used.has(c.color)) used.set(c.color, used.get(c.color) + 1);
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

/** Add categories by name; existing names are kept (description, kind and parent refreshed). Returns the category objects. */
export function mergeCategories(st, list, source) {
  const out = [];
  for (const c of list) {
    let cat = findByName(st, c.name);
    if (!cat) {
      const id = uid('c');
      cat = st.categories[id] = {
        id, name: c.name, description: c.description || '', color: c.color || pickColor(st),
        pinned: false, lastActive: 0, createdAt: Date.now(), source,
        kind: c.kind || 'personal', parentId: c.parentId || null, isNew: !!c.isNew,
      };
    } else if (c.description && cat.source !== 'user') {
      cat.description = c.description;
    }
    if (cat && c.kind !== undefined) cat.kind = c.kind;
    if (cat && c.parentId !== undefined) cat.parentId = c.parentId;
    out.push(cat);
  }
  return out;
}

export function seedList(settings) {
  return String(settings.seedCategories || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, description: '' }));
}
