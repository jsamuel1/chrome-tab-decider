// URL helpers: real URL behind lazy placeholders, domain keys.

// Common multi-part public suffixes (enough for grouping; not a full PSL).
const MULTI_SUFFIX = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'com.cn', 'com.hk', 'com.sg', 'com.mx', 'com.ar', 'com.tr', 'com.tw',
  'co.in', 'co.kr', 'co.za', 'co.il', 'co.id', 'com.my', 'com.ph', 'com.vn',
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'web.app',
  'firebaseapp.com', 'herokuapp.com', 'azurewebsites.net', 'cloudfront.net',
  'amazonaws.com', 'blogspot.com', 'substack.com', 'medium.com', 'notion.site',
]);

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

export function registrable(host) {
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes('.')) return host;
  const parts = host.split('.');
  const last2 = parts.slice(-2).join('.');
  if (MULTI_SUFFIX.has(last2) && parts.length >= 3) return parts.slice(-3).join('.');
  return last2;
}

export function domainKey(url, mode = 'hostname') {
  const h = hostOf(url);
  return mode === 'registrable' ? registrable(h) : h;
}

/** Human-ish site name: "docs.google.com" -> "Google Docs"-ish fallback "docs.google". */
export function siteLabel(host) {
  const parts = host.split('.');
  if (parts.length <= 2) return parts[0];
  return parts.slice(0, -1).join('.');
}
