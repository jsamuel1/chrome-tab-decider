// Bookmark folders as a read-only hint for where a tab belongs. Never writes to bookmarks.

import { pageKey } from './urls.js';

/** Every named folder below the top-level roots (Bookmarks Bar, Other bookmarks) with the pages it directly holds. */
export async function bookmarkFolders() {
  const tree = await chrome.bookmarks.getTree();
  const out = [];
  const walk = (node, depth) => {
    if (node.url) return;
    const urls = new Set();
    for (const child of node.children || []) {
      if (child.url && /^https?:/i.test(child.url)) urls.add(pageKey(child.url));
      else walk(child, depth + 1);
    }
    if (depth >= 2 && node.title) out.push({ id: node.id, name: node.title, depth, urls });
  };
  for (const root of tree) walk(root, 0);
  return out;
}

/** The deepest folder name that holds this page, or null. */
export function bookmarkHint(url, folders) {
  const key = pageKey(url);
  let best = null;
  for (const f of folders || []) {
    if (f.urls.has(key) && (!best || (f.depth || 0) > (best.depth || 0))) best = f;
  }
  return best ? best.name : null;
}
