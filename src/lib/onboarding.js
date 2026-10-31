// Onboarding: suggestions drawn from the user's own tabs and bookmarks, and the answers turned into a profile and folders.

import { candidateTerms, displayName } from './bm25.js';
import { mergeCategories } from './categories.js';
import { pageKey, realTitle, realUrl } from './urls.js';

const MAX_CATEGORIES = 15;
// Second-level labels under a country code that are not themselves owned by anyone (example.co.uk, example.com.au).
const SHARED_SLD = /^(ac|co|com|edu|gov|ne|net|or|org)$/;

/** The part of a page's host its owner registered: "w.amazon.com" → "amazon.com". Empty for addresses and non-web pages. */
export function registrableDomain(url) {
  let host;
  try {
    const u = new URL(realUrl(url));
    if (!/^https?:$/.test(u.protocol)) return '';
    host = u.hostname.toLowerCase();
  } catch {
    return '';
  }
  if (!host || host.includes(':') || /^\d+(\.\d+){3}$/.test(host)) return '';
  const labels = host.split('.');
  const n = labels.length >= 3 && labels.at(-1).length === 2 && SHARED_SLD.test(labels.at(-2)) ? 3 : 2;
  return labels.slice(-n).join('.');
}

// What a tab says about itself, without its address: suggested names should be words, not hosts.
function tabText(tab, details) {
  const d = details || {};
  const lines = [];
  for (const v of [d.title || realTitle(tab), d.description, d.siteName, d.ogTitle, d.h1]) {
    const s = String(v || '').trim();
    if (s && !lines.includes(s)) lines.push(s);
  }
  return lines.join('\n');
}

/**
 * `domains`: registrable domains of the open tabs, most frequent first.
 * `categories`: bookmark folder names, then the top distinctive terms of the open tabs; de-duplicated, at most 15.
 */
export function onboardingSuggestions(tabs, folders, tabMeta = {}) {
  const counts = new Map();
  const docs = [];
  for (const t of tabs) {
    const d = registrableDomain(t.url || t.pendingUrl || '');
    if (!d) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
    docs.push({ id: String(docs.length), text: tabText(t, tabMeta[pageKey(realUrl(t))]?.details) });
  }
  const domains = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);

  const seen = new Set();
  const categories = [];
  const add = (name) => {
    const s = String(name || '').trim();
    if (!s || seen.has(s.toLowerCase()) || categories.length >= MAX_CATEGORIES) return;
    seen.add(s.toLowerCase());
    categories.push(s);
  };
  for (const f of folders || []) add(f.name);
  const texts = docs.map((d) => d.text);
  for (const c of candidateTerms(docs, { max: MAX_CATEGORIES })) add(displayName(c.term, c.docIds.map((id) => texts[Number(id)])));
  return { domains, categories };
}

const clean = (list) => (list || []).map((x) => String(x).trim()).filter(Boolean);

/**
 * `names` without any that match one already taken (case-insensitive). A category named after the
 * company or a project would otherwise turn that work folder into a personal one when it is saved.
 */
export function withoutNames(names, taken) {
  const t = new Set(clean(taken).map((x) => x.toLowerCase()));
  return clean(names).filter((n) => !t.has(n.toLowerCase()));
}

/**
 * Store the answers as the profile, and make their folders: the company, one work folder per project
 * under it, and one personal folder per chosen category. A project or category with the company's
 * name, or a category with a project's name, is left out. Run again, it renames the company folder
 * rather than making a second one.
 */
export function saveProfile(st, answers) {
  const a = answers || {};
  const name = String(a.company || '').trim();
  // Each name is one folder, so the company outranks a project, and a project outranks a category.
  const projects = withoutNames(a.projects, [name]);
  st.profile = {
    company: name,
    companyDomains: [...new Set(clean(a.companyDomains).map((d) => d.toLowerCase()))],
    work: String(a.work || '').trim(),
    projects,
    style: a.style === 'generic' ? 'generic' : 'specific-work',
    categories: withoutNames(a.categories, [name, ...projects]),
    onboarded: true,
  };
  const p = st.profile;
  let company = null;
  if (p.company) {
    const old = Object.values(st.categories).find((c) => c.kind === 'company');
    const taken = Object.values(st.categories).some((c) => c !== old && c.name.toLowerCase() === p.company.toLowerCase());
    if (old && !taken) old.name = p.company;
    [company] = mergeCategories(st, [{ name: p.company, kind: 'company', parentId: null }], 'user');
  }
  mergeCategories(st, p.projects.map((name) => ({ name, kind: 'work', parentId: company?.id ?? null })), 'user');
  mergeCategories(st, p.categories.map((name) => ({ name, kind: 'personal', parentId: null })), 'user');
  return st.profile;
}
