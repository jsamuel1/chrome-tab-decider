// The answers the "Why?" card offers after a tab is moved by hand, and what saving one does.

import { uid } from './store.js';
import { hostOf, pageKey } from './urls.js';

const MAX_TEXT = 200;

/** The 1-click answers for a page moved into `cat` on `host`. */
export function whyOptions(cat, profile, host) {
  const company = String(profile?.company || '').trim();
  const forCompany = company && (cat.kind === 'work' || cat.kind === 'company');
  const options = [
    { id: 'folder', label: `Part of ${cat.name}`, scope: 'page', text: `Part of ${cat.name}` },
    forCompany
      ? { id: 'company', label: `It's for ${company}`, scope: 'page', text: `It's for ${company}` }
      : { id: 'personal', label: "It's personal", scope: 'page', text: "It's personal" },
  ];
  if (host) {
    options.push({
      id: 'site', label: `Everything on ${host}, not just this page`, scope: 'site', text: `Everything on ${host} belongs in ${cat.name}`,
    });
  }
  return options;
}

/** Save an answer: the page stays where the user put it, and a site-wide answer binds the whole site. */
export function applyReason(st, { url, catId, optionId, text, scope }, at = Date.now()) {
  const key = pageKey(url);
  const host = hostOf(key);
  const site = scope === 'site' && host;
  if (site) {
    // the reason behind an earlier rule for this site no longer holds
    st.reasons = st.reasons.filter((r) => !(r.scope === 'site' && r.host === host));
  }
  const reason = {
    id: uid('r'), catId, optionId, text: String(text || '').trim().slice(0, MAX_TEXT), scope: site ? 'site' : 'page', host, url: key, at,
  };
  st.reasons.push(reason);
  if (site) st.siteRules[host] = { catId, reasonId: reason.id };
  st.pageMap[key] = { ...st.pageMap[key], catId, confidence: 1, source: 'user', at, fixed: true };
  return st;
}

/** Forget a reason, and the site binding it made (pages it filed are decided again). */
export function deleteReason(st, id) {
  st.reasons = st.reasons.filter((r) => r.id !== id);
  for (const [host, rule] of Object.entries(st.siteRules)) {
    if (rule.reasonId !== id) continue;
    delete st.siteRules[host];
    for (const [k, m] of Object.entries(st.pageMap)) if (m.source === 'site' && hostOf(k) === host) delete st.pageMap[k];
  }
  return st;
}
