// Pure page-detail extraction: reads a handful of metadata fields and never the body text.

const MAX = 200;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX);
const meta = (doc, sel) => clean(doc.querySelector(sel)?.getAttribute('content'));

/** @param doc needs only `title`, `querySelector(sel)` and `documentElement.lang`. */
export function extractDetails(doc) {
  return {
    title: clean(doc.title),
    description: meta(doc, 'meta[name="description"]'),
    siteName: meta(doc, 'meta[property="og:site_name"]'),
    ogTitle: meta(doc, 'meta[property="og:title"]'),
    h1: clean(doc.querySelector('h1')?.textContent),
    lang: clean(doc.documentElement?.lang),
  };
}
