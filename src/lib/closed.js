// Chrome's recently closed tabs keep their Back history, so a tab TabSage closed is best reopened from there.

import { realUrl } from './urls.js';

/**
 * The session id of the newest closed tab on `url` in Chrome's recently closed list (as returned by
 * chrome.sessions.getRecentlyClosed), or null. Closed windows are skipped: restoring one would bring
 * back every tab in it.
 */
export function closedTabFor(entries, url) {
  const match = (entries || [])
    .filter((e) => e.tab?.sessionId && realUrl(e.tab.url) === url)
    .sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))[0];
  return match ? match.tab.sessionId : null;
}
