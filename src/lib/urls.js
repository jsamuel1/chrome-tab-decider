// URL helpers: real URL behind lazy placeholders, page keys.

export const LAZY_PATH = '/lazy.html';

export function lazyUrl({ url, title = '', favIconUrl = '' }) {
  const p = new URLSearchParams({ u: url, t: title, f: favIconUrl || '' });
  return chrome.runtime.getURL(LAZY_PATH) + '#' + p.toString();
}

export function isLazy(url) {
  return typeof url === 'string' && url.startsWith(chrome.runtime.getURL(LAZY_PATH));
}

/** The URL the user actually cares about (unwraps lazy placeholders). */
export function realUrl(tabOrUrl) {
  const url = typeof tabOrUrl === 'string' ? tabOrUrl : (tabOrUrl.url || tabOrUrl.pendingUrl || '');
  if (isLazy(url)) {
    const hash = url.split('#')[1] || '';
    return new URLSearchParams(hash).get('u') || url;
  }
  return url;
}

export function realTitle(tab) {
  if (isLazy(tab.url)) {
    const hash = tab.url.split('#')[1] || '';
    return new URLSearchParams(hash).get('t') || tab.title || '';
  }
  return tab.title || '';
}

/** Tabs we never group: internal pages, new tab pages, extension pages (except lazy placeholders). */
export function isGroupable(tab) {
  if (tab.pinned) return false;
  const url = realUrl(tab);
  if (!url) return false;
  if (/^(chrome|edge|about|devtools|view-source):/i.test(url)) return false;
  if (url.startsWith('chrome-extension://') && !isLazy(tab.url)) return false;
  return /^(https?|file):/i.test(url);
}

export function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return 'local files';
    return u.hostname.replace(/^www\d?\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** What we remember a decision against: the real URL without its #fragment (single-page apps change it freely). */
export function pageKey(url) {
  const real = realUrl(url || '');
  const i = real.indexOf('#');
  return i === -1 ? real : real.slice(0, i);
}

/** Human-ish site name: "docs.google.com" -> "Google Docs"-ish fallback "docs.google". */
export function siteLabel(host) {
  const parts = host.split('.');
  if (parts.length <= 2) return parts[0];
  return parts.slice(0, -1).join('.');
}
