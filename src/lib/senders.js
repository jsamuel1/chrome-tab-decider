// Who may ask the service worker and the engine for what. Every site's renderer can message the
// extension through the content script, so web pages get only the calls they need: a page reports
// its details, and the "Why?" card's frame asks its question and gives its answer. Everything else
// (stored data, settings, search, deleting) is for the extension's own pages.

const WHY_PAGE = 'why.html';
const FROM_PAGE = new Set(['pageDetails']);
const FROM_WHY = new Set(['whyQuestion', 'saveReason']);

/** 'extension' (our own pages and worker), 'why' (the card's frame in a page), 'page' (a content script) or null. */
export function senderKind(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return null;
  // content scripts always run in a tab; the worker and the offscreen document never do
  if (!sender.tab) return 'extension';
  const base = chrome.runtime.getURL('');
  const url = typeof sender.url === 'string' ? sender.url : '';
  if (!url.startsWith(base)) return 'page';
  return url.slice(base.length).split(/[?#]/)[0] === WHY_PAGE ? 'why' : 'extension';
}

/** True when `sender` may make the background call `type`. */
export function allowed(type, sender) {
  const kind = senderKind(sender);
  if (kind === 'extension') return true;
  if (kind === 'why') return FROM_WHY.has(type);
  if (kind === 'page') return FROM_PAGE.has(type) && sender.frameId === 0;
  return false;
}

/** True when `sender` may use the engine directly: only the extension's own pages and worker. */
export const mayUseEngine = (sender) => senderKind(sender) === 'extension';
