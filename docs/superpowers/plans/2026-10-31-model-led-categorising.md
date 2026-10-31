# Model-led categorising Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TabSage files each tab with the Strands Decider classifier, using page details, an onboarding profile, bookmark folders and the user's own reasons, with no fixed keyword rules; keeps most-used tabs pinned or in a Daily group; and keeps everything it reads in the browser.

**Architecture:** A content script reads a few descriptive items from each page and reports them to the service worker, which stores them per page. The organizer decides each page separately: a hand-written BM25 module finds candidate folder names and shortlists folders, and the classifier (in the offscreen document) confirms names and makes every choice. New pure modules hold the logic (BM25, profile text, grouping plan, pin plan, reasons) so it can be unit-tested in Node; the organizer and UI pages wire them to Chrome.

**Tech Stack:** Chrome Manifest V3, plain ES modules bundled by esbuild (`scripts/build.mjs`), ONNX Runtime Web on WebGPU, `node --test` for unit tests, Playwright for the CI smoke test (`test/e2e/run.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-31-categorisation-design.md`

## Global Constraints

- No fixed keyword, site or category lists may decide where a tab goes or what a folder is called. (`src/lib/heuristics.js` is deleted.)
- Nothing TabSage reads (page details, bookmarks, usage, profile, reasons) leaves the browser. The only network request remains the classifier download from Hugging Face.
- Until the classifier is downloaded, TabSage does not move, group, pin or name any tab.
- Page details read: title, meta description, `og:site_name`, `og:title`, first `h1`, page language. No body text, form fields or typed input. Each item capped at 200 characters.
- A tab is never moved while it is the active tab of a focused window.
- A page the user placed by hand is never moved by the classifier.
- Work folder group titles: `"<Company> · <Folder>"`; the plain company group is titled `"<Company>"`.
- Defaults: pinned slots 5, Daily slots 8, usage half-life 7 days, pin cooldown 3 days, group limit `maxGroups` (existing setting, default 8; Daily does not count).
- No new runtime npm dependencies. Minimum Chrome stays 138.
- Code style: match the existing files — ES modules, two-space indent, few comments that explain why.

## Review Focus

1. **Single-page apps that change their address constantly (Gmail, Docs):** expected no re-decision and no moving while only the `#` part changes. Pinned by the `pageKey` and "unchanged key is not re-decided" tests in Tasks 3 and 6.
2. **Pages where content scripts cannot run (`chrome://`, the Web Store, PDFs, `file://`):** expected the tab is still decided from title and address, with no errors. Pinned by the `pageText` fallback test in Task 6 and the E2E check in Task 11.
3. **A large tab set (hundreds of tabs) on first run:** expected the active window's active and newest tabs are decided first and the organizer never blocks on the whole set. Pinned by the `decisionOrder` test in Task 6.
4. **Closing or unpinning a tab TabSage pinned:** expected it is not re-pinned for the cooldown period. Pinned by the cooldown test in Task 8.
5. **Non-English titles, including Japanese and Chinese with no spaces:** expected BM25 still produces tokens and candidates. Pinned by the `tokenize` CJK test in Task 4.

---

### Task 1: No model, no filing; remove the keyword fallbacks

**Files:**
- Delete: `src/lib/heuristics.js`, `test/heuristics.test.js`
- Modify: `src/lib/organizer.js` (remove heuristic imports and paths, remove the built-in-LLM assignment fallback, add the readiness gate)
- Modify: `src/background.js` (`status` reports readiness)
- Modify: `src/lib/ui-common.js` (`engineSummary` shows "Waiting for the classifier" with progress)
- Test: `test/organizer-gate.test.js`

**Interfaces:**
- Produces: `export async function classifierReady(settings): Promise<boolean>` in `src/lib/organizer.js` — true only when `ai('decider.status', { settings })` reports `downloaded: true`. `_organize` returns `{ skipped: 'model-not-ready' }` before touching any tab when false.

- [ ] **Step 1: Write the failing test** — `test/organizer-gate.test.js`: with a fake `chrome` whose `tabs.group`, `tabGroups.update` and `tabs.update` record calls, and `ai` stubbed so `decider.status` returns `{ downloaded: false }`, `organize({ reason: 'test' })` resolves to `{ skipped: 'model-not-ready' }` and the recorded call lists are empty. Make `ai` injectable for tests through `export function setAiForTest(fn)` in `src/lib/ai.js`.
- [ ] **Step 2: Run it** — `node --test test/organizer-gate.test.js` → FAIL (no gate).
- [ ] **Step 3: Implement** the gate and remove `heuristicDiscover`, `heuristicAssign`, `hostHint` and the `llm.assign` fallback. When the decider errors during assignment, the tab is left where it is, not sent to Other.
- [ ] **Step 4: Run** `npm test` → all pass (the heuristics test file is gone).
- [ ] **Step 5: Commit** — `git commit -m "Leave tabs alone until the classifier is ready, and drop the keyword rules"`

### Task 2: Read page details with a content script

**Files:**
- Create: `src/content/extract.js` (pure extraction), `src/content/details.js` (content script entry)
- Modify: `static/manifest.json` — add `"<all_urls>"` to `host_permissions`, add `"scripting"` and `"bookmarks"` to `permissions`, add a `content_scripts` entry for `details.js` on `<all_urls>` at `document_idle`
- Modify: `scripts/build.mjs` — entry `content: 'src/content/details.js'`, built as a classic script (IIFE)
- Modify: `src/background.js` — handle `pageDetails` messages; on install and startup, inject `details.js` into already-open tabs with `chrome.scripting.executeScript`, ignoring tabs where injection fails
- Test: `test/extract.test.js`

**Interfaces:**
- Produces: `export function extractDetails(doc): { title, description, siteName, ogTitle, h1, lang }`. Each value is a string trimmed, whitespace-collapsed and capped at 200 characters, or `''`. `doc` needs only `title`, `querySelector(sel)` and `documentElement.lang`.
- Produces: message `{ target: 'background', type: 'pageDetails', url, details }` sent by `details.js`; the background stores it at `st.tabMeta[pageKey(url)].details` (`pageKey` from Task 3).

- [ ] **Step 1: Write the failing tests** — with a fake `doc` object: all six fields read from `<title>`, `meta[name=description]`, `meta[property="og:site_name"]`, `meta[property="og:title"]`, the first `h1` and `html[lang]`; a 500-character description is cut to 200; missing tags give `''`; body text is never returned (a fake `doc.body.innerText` set to "SECRET" does not appear in any field).
- [ ] **Step 2: Run** `node --test test/extract.test.js` → FAIL.
- [ ] **Step 3: Implement** `extractDetails`, then `details.js` calling it once on load and once more if the title changes within 5 seconds.
- [ ] **Step 4: Run** `npm test && npm run build` → pass; `dist/content.js` exists and `dist/manifest.json` contains `<all_urls>`.
- [ ] **Step 5: Commit** — `git commit -m "Read a few page details, locally, to classify each tab"`

### Task 3: Pages, not sites — storage and migration

**Files:**
- Modify: `src/lib/urls.js` — add `pageKey`, remove `domainKey` and its `mode`
- Modify: `src/lib/store.js` — drop the `domainKey` setting; state gains `pageMap`, `siteRules`, `reasons`, `usage`, `ourPins`, `pinCooldown`, `profile`; add `migrate(st)`
- Modify: `src/lib/sorter.js`, `src/lib/archive.js` — use `hostOf` where they used `domainKey`
- Modify: `static/options.html`, `src/options/options.js` — remove the host-name-versus-domain setting
- Test: `test/store-migrate.test.js`, add `pageKey` cases to a new `test/urls.test.js`

**Interfaces:**
- Produces: `export function pageKey(url: string): string` — the real URL without its `#` fragment; for lazy placeholder URLs, the wrapped URL.
- Produces: state shapes —
  - `pageMap: { [pageKey]: { catId, confidence, source: 'decider'|'user', at, fixed: boolean } }`
  - `siteRules: { [host]: { catId, reasonId } }`
  - `reasons: [{ id, catId, text, scope: 'page'|'site', host, url, at }]`
  - `usage: { [pageKey]: { score: number, at: number } }`
  - `ourPins: { [pageKey]: number }`, `pinCooldown: { [pageKey]: number }`
  - `profile: { company: '', companyDomains: [], work: '', projects: [], style: 'specific-work'|'generic', categories: [] , onboarded: false }`
  - category fields added: `kind: 'work'|'company'|'personal'|'daily'|'other'`, `parentId: string|null`, `isNew: boolean`
- Produces: `export function migrate(st): st` — `domainMap` entries with `source: 'user'` become `siteRules` (with a reason "Moved here by hand"); all other `domainMap` entries are dropped; existing categories get `kind: 'personal'`, `parentId: null`, `isNew: false`; `domainMap` is deleted. Idempotent.

- [ ] **Step 1: Write the failing tests** — `pageKey('https://mail.google.com/mail/u/0/#inbox') === pageKey('https://mail.google.com/mail/u/0/#sent')`; query strings are kept; `migrate` turns `{ domainMap: { 'phonetool.amazon.com': { catId: 'c1', source: 'user' }, 'x.com': { catId: 'c2', source: 'heuristic' } } }` into one `siteRules` entry for `phonetool.amazon.com`, no `x.com` entry, no `domainMap`; running `migrate` twice gives the same result.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**, calling `migrate` inside `getState()` on load.
- [ ] **Step 4: Run** `npm test && npm run build` → pass.
- [ ] **Step 5: Commit** — `git commit -m "Remember decisions per page, and carry hand-made corrections over"`

### Task 4: BM25

**Files:**
- Create: `src/lib/bm25.js`
- Test: `test/bm25.test.js`

**Interfaces:**
- Produces: `export function tokenize(text: string, lang?: string): string[]` — lower-cased word tokens from `Intl.Segmenter(lang, { granularity: 'word' })`, keeping only `isWordLike` segments, dropping tokens that are all digits or one character long. A single Han ideograph or Hangul syllable is kept; a single kana (usually a particle such as "の") is dropped.
- Produces: `export function index(docs: { id, text }[]): Index` and `export function score(idx: Index, query: string): { id, score }[]` sorted descending, standard Okapi BM25 with `k1 = 1.2`, `b = 0.75`.
- Produces: `export function candidateTerms(docs: { id, text }[], { minDocs = 2, max = 12 } = {}): { term, docIds, score }[]` — unigrams and adjacent-word bigrams that appear in at least `minDocs` documents and in no more than half of them, scored by document frequency × IDF. A bigram is formed only from two words separated by plain spaces, so words with punctuation or a dropped token between them are never paired, and Japanese or Chinese words that touch with no space are never joined (Korean, which uses spaces, does form bigrams). A bigram replaces one of its words when it covers the same documents and its other word is also a candidate; when the other word is too common to be a candidate, both are kept, so "the acme" cannot hide "acme". No stopword list: frequency across the user's own documents is the only filter.

- [ ] **Step 1: Write the failing tests** —
  - `tokenize('ESP32-S3 Technical Reference')` contains `esp32` and `technical`.
  - `tokenize('京都の旅行プラン', 'ja')` returns more than one token. (Review Focus 5.)
  - `score` ranks a document containing "acme invoice" above one that does not, for query `"acme"`.
  - `candidateTerms` over six docs — three mentioning "Acme", two "ESP32", and the word "the" in all six — returns `acme` and `esp32` and not `the`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test test/bm25.test.js` → pass.
- [ ] **Step 5: Commit** — `git commit -m "Add BM25 for finding folder names in your own tabs"`

### Task 5: Profile, bookmarks and folder structure

**Files:**
- Create: `src/lib/profile.js`, `src/lib/bookmarks.js`, `src/lib/grouping.js`
- Modify: `src/lib/categories.js` — `mergeCategories` accepts `kind`, `parentId`, `isNew`
- Test: `test/profile.test.js`, `test/grouping.test.js`

**Interfaces:**
- Produces: `export function profileText(profile): string` — at most 600 characters, e.g. "This person works at Amazon (amazon.com, a2z.com) as a solutions architect. Pages on those domains are usually work. Current projects: Acme, Payroll. Work tabs are grouped by project or customer; personal tabs by general topic." Empty string when `profile.onboarded` is false and every field is empty.
- Produces: `export async function bookmarkFolders(): Promise<{ id, name, urls: Set<string> }[]>` (read-only, via `chrome.bookmarks.getTree`) and `export function bookmarkHint(url, folders): string|null` — the deepest folder name containing that `pageKey`, or null.
- Produces: `export function groupTitle(cat, profile): string` — `"<Company> · <name>"` for `kind: 'work'`, `"<Company>"` for `kind: 'company'`, `cat.name` otherwise.
- Produces: `export function planGroups(cats, counts: Map<catId, number>, maxGroups): Map<catId, catId>` — maps each category with open tabs to the category whose group it shows in. Pinned categories first, then by count; Daily and Other are never folded and Daily does not count towards `maxGroups`; when over the limit, the lowest-ranked fold into `parentId` (work → the `company` category; personal → its `parentId` high-level category), and only categories with no parent fold into Other.

- [ ] **Step 1: Write the failing tests** —
  - `profileText` mentions the company and both domains, and stays within 600 characters for a profile with 30 projects.
  - `groupTitle` gives `"Amazon · Acme"` for a work category and `"Amazon"` for the company category.
  - `planGroups` with `maxGroups: 3` and categories company(5 tabs), work Acme(4), work Payroll(1), personal Travel(3), daily(8): Payroll folds into company; daily is kept and not counted; Travel is kept.
  - `bookmarkHint` returns `"House"` for a URL bookmarked under Bookmarks Bar › House.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → pass.
- [ ] **Step 5: Commit** — `git commit -m "Add the profile, bookmark hints and the flat folder layout"`

### Task 6: Decide each tab, with discovery and calm re-deciding

**Files:**
- Modify: `src/lib/organizer.js` — replace domain clusters with per-tab decisions
- Create: `src/lib/decide.js` — pure helpers the organizer uses
- Test: `test/decide.test.js`

**Interfaces:**
- Consumes: `pageKey` (Task 3), `index`/`score`/`candidateTerms` (Task 4), `profileText`, `bookmarkHint`, `groupTitle`, `planGroups` (Task 5).
- Produces (in `src/lib/decide.js`):
  - `export function pageText(tab, details): string` — title, description, site name, `og:title`, `h1`, then host; when `details` is missing it uses the tab title and URL only. (Review Focus 2.)
  - `export function decisionOrder(tabs, { activeTabIds, focusedWindowId }): tab[]` — active tabs first, then the focused window's tabs newest first, then the rest. (Review Focus 3.)
  - `export function shortlist(page, cats, reasons, k = 8): cat[]` — BM25 over each category's `name`, `description` and its reasons' text, top `k`.
  - `export function decisionState(page, { profile, hint, reasons }): string` — the text given to the classifier: profile text, then "Page:" details, then the bookmark hint and up to five relevant reasons, total under 1,500 characters.
  - `export function shouldMove(current, next, { margin = 0.15 }): boolean` — false if `current.fixed`; true if there is no current decision, its folder no longer exists, or `next.confidence >= current.confidence + margin`.
- The organizer:
  - decides tabs whose `pageKey` has no `pageMap` entry, in `decisionOrder`, applying `siteRules` first (a rule fixes the tab without asking the classifier);
  - runs discovery when Other holds three or more undecided pages: `candidateTerms` over Other's pages, then for each candidate `ai('decider.noul', { state, instructions: 'Would "<term>" be a sensible name for a folder holding these browser tabs?' })`, accepting at P(true) ≥ 0.6, creating each accepted folder with `isNew: true`; if Chrome's built-in model is available, its names go through the same check;
  - re-decides already-filed, unfixed pages only when the user has been idle for 2 minutes (`chrome.idle` is not needed: use the time since the last tab or group event), applying `shouldMove`, and never for the active tab of the focused window;
  - groups with `planGroups` and titles with `groupTitle`;
  - when `decider.status` reports `device: 'wasm'`, decides at most 5 tabs per organize run and schedules another run, so the slow engine works through tabs gradually.

- [ ] **Step 1: Write the failing tests** —
  - `pageText` with no details returns the title and host.
  - `decisionOrder` puts the active tab first and the focused window before others.
  - `shortlist` puts the "Acme" folder first for a page mentioning Acme.
  - `decisionState` stays under 1,500 characters with 50 reasons.
  - `shouldMove` is false for a fixed decision, false within the margin, true above it.
  - With a fake `chrome` and stubbed `ai`: a tab whose URL changes only after `#` is not re-decided (Review Focus 1); a `siteRules` host is fixed without any `decider.choice` call.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `decide.js`, then rewrite `_organize` around it.
- [ ] **Step 4: Run** `npm test && npm run build` → pass.
- [ ] **Step 5: Commit** — `git commit -m "Decide each tab from its page, your profile and your reasons"`

### Task 7: "Why?" card and reasons

**Files:**
- Create: `src/content/why.js` (card, injected on demand), `src/lib/reasons.js`
- Modify: `src/lib/organizer.js` — `learnFromUser` fixes the page, then asks the tab to show the card
- Modify: `src/background.js` — handle `saveReason` and `deleteReason`
- Modify: `scripts/build.mjs` — entry `why: 'src/content/why.js'` (IIFE)
- Test: `test/reasons.test.js`

**Interfaces:**
- Produces: `export function whyOptions(cat, profile, host): { id, label, scope, text }[]` — three or four answers: "Part of <folder>" (page), "It's for <Company>" when the profile has a company and the category is work or company, otherwise "It's personal", and "Everything on <host>, not just this page" (site).
- Produces: `export function applyReason(st, { url, catId, optionId, text, scope }): st` — adds to `st.reasons`; `scope: 'site'` also sets `st.siteRules[host]`; always sets `pageMap[pageKey(url)].fixed = true`.
- Produces: `export function deleteReason(st, id): st` — removes the reason and any `siteRules` entry it created.
- The card: a closed shadow root in the page's corner, the answer buttons and an optional text box, dismissed after 8 seconds untouched; it sends `{ type: 'saveReason', ... }`. It is injected with `chrome.scripting.executeScript` only when needed.

- [ ] **Step 1: Write the failing tests** — `whyOptions` includes the company answer for a work folder and "It's personal" otherwise; `applyReason` with site scope creates the rule and fixes the page; `deleteReason` removes both.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build` → pass.
- [ ] **Step 5: Commit** — `git commit -m "Ask why when you move a tab, and remember the answer"`

### Task 8: Pinned tabs and the Daily group

**Files:**
- Create: `src/lib/usage.js`
- Modify: `src/background.js` — `tabs.onActivated` records usage; `tabs.onRemoved` and pin changes record cooldowns for pages in `ourPins`
- Modify: `src/lib/organizer.js`, `src/lib/sorter.js` — apply the pin plan; Daily group first and never collapsed
- Test: `test/usage.test.js`

**Interfaces:**
- Produces: `export function recordUse(usage, key, now, halfLifeDays = 7): usage` — decays the old score to `now`, then adds 1.
- Produces: `export function planPins(openPages: { key, tabId, pinned, userPinned }[], usage, { now, pinMax = 5, dailyMax = 8, ourPins, cooldown }): { pin: key[], unpin: key[], daily: key[] }` — ranks by decayed score; never unpins `userPinned`; skips keys in `cooldown`; only changes a slot when the challenger's score exceeds the holder's by 25%.
- Produces: `export function startCooldown(cooldown, key, now, days = 3): cooldown`.

- [ ] **Step 1: Write the failing tests** — a page used 20 times last week outranks one used 30 times two months ago; the top five become `pin`; user pins are never in `unpin`; a page in cooldown is not pinned (Review Focus 4); a challenger 10% ahead does not displace a holder.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**, storing `ourPins` so restored pins after a restart are told apart from the user's.
- [ ] **Step 4: Run** `npm test && npm run build` → pass.
- [ ] **Step 5: Commit** — `git commit -m "Keep your most-used tabs pinned or in a Daily group"`

### Task 9: Onboarding

**Files:**
- Create: `static/onboarding.html`, `src/onboarding/onboarding.js`
- Modify: `scripts/build.mjs` — entry `onboarding`
- Modify: `src/background.js` — on install open `onboarding.html` instead of the options page; message `onboardingSuggestions` returns `{ domains, categories }`; message `saveProfile`
- Modify: `static/options.html`, `src/options/options.js` — "Your profile" section (edit, and "Run onboarding again"); remove "Always-offered folders", whose job the profile now does

**Interfaces:**
- Consumes: `candidateTerms` (Task 4), `bookmarkFolders` (Task 5).
- Produces: `onboardingSuggestions` — `domains`: the registrable domains of open tabs, most frequent first (for the company-domain field); `categories`: bookmark folder names plus the top `candidateTerms` over open tabs, de-duplicated, at most 15.
- Produces: `saveProfile({ profile })` — stores `st.profile` with `onboarded: true`, creates the company category (`kind: 'company'`), one work category per project (`parentId` = company), and one personal category per chosen category; then runs `organize`.
- Screens, in order: company and domains; type of work; projects or customers; grouping style; categories (checkboxes from suggestions, plus "add your own"); a closing screen with the download progress.

- [ ] **Step 1: Write the failing test** — `test/onboarding.test.js`: `saveProfile` with company "Amazon", projects ["Acme"], categories ["Travel"] creates three categories with the right `kind` and `parentId`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the handlers, then the page, styled with `static/ui.css`.
- [ ] **Step 4: Run** `npm test && npm run build` → pass.
- [ ] **Step 5: Commit** — `git commit -m "Ask about you on first install, and suggest categories from your tabs and bookmarks"`

### Task 10: Settings — review new folders and reasons

**Files:**
- Modify: `static/options.html`, `src/options/options.js`, `src/popup/popup.js`, `src/background.js`

**Interfaces:**
- Produces: messages `reviewFolder({ catId, action: 'keep'|'rename'|'merge', name?, intoId? })` — keep clears `isNew`; rename sets the name and clears `isNew`; merge moves its `pageMap` entries (keeping `fixed`) to `intoId`, adds a reason "Merged <old> into <new>", deletes the folder, and re-runs `organize`.
- The Settings page lists New folders with Keep / Rename / Merge into…, and lists reasons with a delete button. The popup shows a count of New folders linking to Settings.

- [ ] **Step 1: Write the failing test** — `test/review.test.js`: `reviewFolder` merge moves the pages and leaves a reason; keep clears `isNew`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build` → pass.
- [ ] **Step 5: Commit** — `git commit -m "Review new folders and saved reasons in Settings"`

### Task 11: Privacy, Store wording, and the CI smoke test

**Files:**
- Modify: `PRIVACY.md`, `README.md`
- Modify: `~/src/personal/me-sauhsoj-wtf/site/privacy.html` (separate repo, deployed on push to its `main`)
- Create: `docs/store-listing.md` — single purpose, a justification for each permission (`<all_urls>`, `scripting`, `bookmarks` added), and the data-usage answers
- Modify: `test/e2e/run.mjs`, `.github/workflows/extension.yml` (the `grep -q` lines)

**Interfaces:**
- The privacy text says what is read (page title, description, site name, social title, main heading and language; bookmark folders and which pages are in them; how often you use tabs; your profile and reasons), that it is stored only in the browser's local extension storage, and that it never leaves the browser. It removes "TabSage cannot read or change the contents of the pages you visit". The Hugging Face download stays the only network request.
- The E2E test, with no model in CI, prints and the workflow greps for:
  - `OK no tabs grouped before the classifier is ready`
  - `OK page details stored for open tabs` (via a `pageDetails` debug read of state through the existing `exportData` message)
  - `OK onboarding opened on install`
  - `no console errors`
  - and loads a `chrome://version` tab to show it causes no errors (Review Focus 2).

- [ ] **Step 1: Update** `test/e2e/run.mjs` to the checks above, and the workflow's grep lines to match.
- [ ] **Step 2: Run** locally `npm run build && node test/e2e/run.mjs` (needs `npm install --no-save playwright@1 && npx playwright install chromium`) → all four OK lines.
- [ ] **Step 3: Update** `PRIVACY.md`, the site's `privacy.html`, `README.md`, and write `docs/store-listing.md`.
- [ ] **Step 4: Commit** each repo — `git commit -m "Say plainly what TabSage now reads, and that it stays in the browser"`; push `me-sauhsoj-wtf` and confirm `https://me.sauhsoj.wtf/privacy.html` shows the new text.
- [ ] **Step 5: Tag** `v0.2.7-test` in TabSage and confirm the run passes and the Store accepts the draft.
