// Pure helpers for deciding one tab: what the classifier reads about it, and when a new answer is worth a move.

import { index, score } from './bm25.js';
import { profileText } from './profile.js';
import { hostOf, pageKey, realTitle, realUrl } from './urls.js';

const MAX_STATE = 1499;
const MAX_PAGE = 700;
const MAX_REASON = 160;

/** What the page says about itself, one item per line, then its host. Without details: the tab title and address. */
export function pageText(tab, details) {
  const url = realUrl(tab);
  if (!details) return [realTitle(tab).trim(), pageKey(url).slice(0, 200)].filter(Boolean).join('\n');
  const lines = [];
  for (const v of [details.title || realTitle(tab), details.description, details.siteName, details.ogTitle, details.h1, hostOf(url)]) {
    const s = String(v || '').trim();
    if (s && !lines.includes(s)) lines.push(s);
  }
  return lines.join('\n');
}

/** Active tabs first, then the focused window's tabs newest first, then the rest newest first. */
export function decisionOrder(tabs, { activeTabIds = [], focusedWindowId = null } = {}) {
  const active = new Set(activeTabIds);
  const rank = (t) => (active.has(t.id) ? 0 : t.windowId === focusedWindowId ? 1 : 2);
  return tabs.slice().sort((a, b) => rank(a) - rank(b) || b.id - a.id);
}

/** The k folders whose name, description and reasons best match the page (BM25). */
export function shortlist(page, cats, reasons, k = 8) {
  const docs = cats.map((c) => ({
    id: c.id,
    text: [c.name, c.description, ...(reasons || []).filter((r) => r.catId === c.id).map((r) => r.text)].join(' '),
  }));
  const byId = new Map(cats.map((c) => [c.id, c]));
  return score(index(docs), page).slice(0, k).map((s) => byId.get(s.id));
}

/**
 * The text the classifier reads: the profile, the page, the bookmark hint and up to five reasons
 * that share words with the page. Reasons carry the name of their folder as `folder`.
 */
export function decisionState(page, { profile, hint, reasons = [] } = {}) {
  const parts = [];
  const who = profileText(profile);
  if (who) parts.push(who);
  parts.push(`Page:\n${String(page || '').slice(0, MAX_PAGE)}`);
  if (hint) parts.push(`Bookmarked in the folder "${String(hint).slice(0, 100)}".`);

  const docs = reasons.map((r, i) => ({ id: i, text: `${r.folder || ''} ${r.text || ''} ${r.host || ''}` }));
  const relevant = score(index(docs), page).filter((s) => s.score > 0).slice(0, 5).map((s) => reasons[s.id]);
  let out = parts.join('\n\n');
  if (relevant.length) {
    let block = '\n\nThis person said:';
    for (const r of relevant) {
      const line = `\n- ${r.folder ? `${r.folder}: ` : ''}${String(r.text || '').slice(0, MAX_REASON)}`;
      if (out.length + block.length + line.length > MAX_STATE) break;
      block += line;
    }
    if (block.includes('\n- ')) out += block;
  }
  return out.slice(0, MAX_STATE);
}

/** Whether a new decision should replace the current one. Pages placed by hand never move. */
export function shouldMove(current, next, { margin = 0.15, cats = null } = {}) {
  if (current?.fixed) return false;
  if (!current) return true;
  if (cats && !cats[current.catId]) return true;
  return next.confidence >= current.confidence + margin;
}
