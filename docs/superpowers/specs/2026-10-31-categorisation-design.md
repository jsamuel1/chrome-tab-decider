# Categorising tabs the way you think

## Why this is changing

TabSage is meant to keep your tabs in groups that match how you think about your work and life. In
practice it gets this wrong in ways that make it worse than doing nothing:

- Your employer's own sites are filed by keyword. An Amazon employee's phonetool tabs end up in
  Shopping, because a fixed list says anything on an Amazon address is shopping.
- Most tabs end up in Other. The classifier only sees a site's address and tab titles, so it is
  rarely sure enough to choose a folder.
- The tabs you use all day are not easy to reach. How often you use a tab only changes its order
  inside a group.

The fix is to let the model decide, with much better information: what each page says about itself,
what you told TabSage about yourself, your bookmarks, and the reasons you give when you correct it.
Nothing is decided by fixed rules.

## Goals

- Every tab is filed by the classifier from real information about that page and about you.
- Your employer's sites, projects and customers are filed as work, split the way you asked.
- Other holds only tabs that genuinely fit nowhere.
- Your most-used tabs are always visible near the top of the tab bar.
- When you correct TabSage, it learns why, and later decisions use that reason.
- Everything TabSage reads stays in the browser.

## Not in scope

- Reading the body text of pages. Only a small set of descriptive items is read (see below).
- Any server, account or cloud service. The only network request stays the one-time classifier
  download from Hugging Face.
- Syncing your profile or reasons between computers.
- Training or fine-tuning the classifier.

## What would make this a failure even if it works

- A confident wrong answer that comes from a rule rather than the model.
- Tabs reshuffling between groups or in and out of the pinned area from one minute to the next.
- Anything TabSage reads leaving the browser.
- The "why?" question feeling like a nag: it must never block you, and ignoring it must be fine.

## Constraints

- **The classifier only chooses.** Strands Decider answers multiple-choice, yes/no and rating
  questions about some text. It cannot write folder names or summaries. Anything that needs new
  words has to come from somewhere else.
- **Chrome's built-in model may not exist.** On managed browsers, such as the developer's work
  Chrome, an administrator policy blocks it, and older or smaller devices do not have it. Every
  feature has to work without it. When it is present it is a bonus, never a requirement.
- **The classifier has a limited reading window.** Instructions, your profile, reasons and page
  details all compete for it, so they have to be kept short and the most relevant parts chosen.
- **Manifest V3.** The classifier runs in the offscreen document, and the service worker can be
  stopped at any time.
- **Chrome Web Store review.** Access to all websites and to bookmarks means a slower, closer
  review, and every permission needs a plain justification.

## Decisions

### 1. No model, no filing

Until the classifier is downloaded and loaded, TabSage does not move, group or name any tab. It
shows its download progress in the popup and in Settings. The keyword lists and site lists in
`heuristics.js` (folder discovery by keyword, assignment by keyword, and site-name hints such as
Amazon → Shopping) are removed entirely, as are the code paths that fall back to them.

### 2. Each tab is decided on its own

The one-decision-per-website model goes. Each tab gets its own decision from its own page details,
and that decision is remembered for that page. When a tab moves to a different page, it is decided
again. The setting that chose between grouping by full host name or by registrable domain is
removed: the model decides whether `docs.google.com` and `mail.google.com` belong together.

"The same page" means the same address without its `#` part. A tab is only decided again when its
address changes beyond that, when its page details change, or when you merge or delete its folder.
New folders, new reasons and profile edits are applied to already-filed tabs only at a quiet moment
(when you have not touched the tab bar for a while), and a tab is only moved if the new decision is
clearly better. Tabs never move while you are looking at them.

Speed matters because every tab is now its own decision. New and active tabs are decided first, the
current window before others, and results are cached per page. When the GPU cannot run the
classifier and it falls back to the much slower WebAssembly engine, it still counts as ready, but
works through tabs gradually in the background instead of all at once.

### 3. Page details are read, and never leave the browser

TabSage requires access to all websites. A content script reads a fixed, short set of items from
each page, once per page load:

- the page title;
- the meta description;
- the site name (`og:site_name`) and social title (`og:title`);
- the first main heading (`h1`);
- the page language.

It does not read body text, form fields or anything you type. Each item is capped in length. The
details are kept with the tab's other information in the extension's local storage, used only by
the classifier inside the browser, and never sent anywhere. Pages where extensions cannot run
scripts, such as Chrome's own pages, the Web Store and some PDFs, are decided from their title and
address alone.

### 4. Onboarding learns about you

Onboarding opens on first install, while the classifier downloads, so the wait is used. It is a few
short screens, and can be reopened from Settings at any time. It asks for:

- your company name and its web domains, prefilled from your open tabs where possible (for example
  `amazon.com`), so your employer's sites are always treated as work;
- your type of work, in your own words;
- your current projects or customers (optional; each becomes a folder);
- how you want groups split: by project or customer at work and generic for personal, or generic
  everywhere;
- your high-level categories, chosen from a suggested list (see 5), which you can edit and add to.

Your answers form a short profile that the classifier sees with every decision. It is editable in
Settings. Your employer's domains are part of that profile, not a rule: the classifier is told
"pages on amazon.com are usually work for this person" and still decides each page itself.

### 4a. How folders become tab groups

Chrome's tab groups cannot be nested, so every folder is one flat group. Folders belong to a
high-level category, chosen in onboarding:

- Work folders are named with your company as a prefix: "Amazon · Acme", "Amazon · Payroll".
- Work tabs that match no project or customer go in a plain work group named after your company,
  such as "Amazon".
- Personal folders have plain names, such as "Shopping" or "Travel", and belong to the nearest
  high-level personal category you chose.

### 4b. When there are more folders than groups

Only so many groups are useful, and the limit stays configurable. When there are more folders with
open tabs than the limit allows, the lowest-ranked ones fold into their parent instead of into Other:
a work project into the plain company group, a personal folder into its high-level category. Other
is only for tabs that fit nothing. The Daily group does not count towards the limit.

### 5. Bookmarks are a hint

TabSage reads your bookmark folders, read-only. Folder names are offered as suggested categories
during onboarding, and when a page is bookmarked inside a folder, that folder is a strong hint for
where its tab belongs. TabSage never changes your bookmarks, and like page details, nothing read
from them leaves the browser.

### 6. New folders are found in your own tabs, with BM25

Folder names come from:

- your onboarding answers;
- groups you name yourself;
- your bookmark folders;
- distinctive terms in your open tabs.

For the last source, TabSage scores words and short phrases across the page details of your open
tabs with BM25 (or a similar measure). A term that several tabs share, but that is rare across
your tabs as a whole, becomes a candidate folder name: "Acme", "ESP32", "Kyoto". Common words drop
out because they are common in your own tabs, not because a list says so.

Each candidate is checked by the classifier with a yes/no question, such as "Is 'ESP32' a sensible
folder for these tabs?". Only accepted names become folders. When Chrome's built-in model is
available it may also propose names, which go through the same check.

New folders are created straight away and marked **New**. They can be reviewed later in Settings or
the popup: keep, rename, or merge into another folder. Merging refiles the tabs and is recorded as a
reason (see 8).

### 7. Assigning a tab

For each tab, BM25 compares the page details with each folder's name, description and saved reasons
to produce a short list. The classifier then chooses among that short list and Other, given the
page details, your profile, any bookmark hint and the relevant reasons. When it is not sure enough,
the tab goes to Other. Only the top folders get their own group, as today.

### 8. Moving a tab asks why, and remembers

When you drag a tab into a different group, a small card appears in the corner of that page. It
asks "Why does this belong in *Acme*?" and offers three or four 1-click answers that fit the move,
plus an optional text box. For example:

- "Part of *Acme*" (the folder you moved it to);
- "It's for Amazon" or "It's personal";
- "Everything on this site, not just this page".

The move applies to that page. It applies to the whole site only if you choose that answer. The card
disappears after a few seconds if you ignore it, and the move still counts.

A move you make is final. The classifier never moves that page somewhere else on its own, even if
the page's details change later. Choosing "Everything on this site" makes that binding for every
page on the site, including ones you open later. The reason you give is soft: it guides decisions
about other pages, and the classifier weighs it. Merging or deleting a folder moves its fixed pages
with it, and deleting a reason in Settings removes any binding it created.

Answers are saved as reasons. Some become notes on a folder, telling the classifier what belongs
there; others become rules about you, such as "anything on corp sites is work". Later decisions see
the relevant ones. You can review and delete them in Settings.

### 9. Your most-used tabs stay in reach

TabSage counts how often you switch to each tab over roughly the last two weeks, with older use
counting for less. Your very most-used pages, up to about five, become Chrome pinned tabs, which show
as icons at the top of the vertical tab bar. The next tier, up to about eight, goes in a **Daily**
group that is always first and never collapsed. Pages move in and out of these slowly, so the top of
the tab bar does not reshuffle every day. Tabs you pin or group yourself always stay where you put
them. Both limits can be changed in Settings.

This only rearranges tabs that are already open: TabSage never opens a page to pin it. Pinned tabs
stay in whichever window they are in. If you close or unpin a page that TabSage pinned, that counts
as "don't pin this", and it stays out of the pinned area for a while. TabSage remembers which tabs
it pinned (by page, in local storage), so after Chrome restarts and restores pinned tabs, it can
still tell your own pins, which it never touches, from its own.

### 10. The privacy promises change with it

The privacy policy at `me.sauhsoj.wtf/privacy.html`, `PRIVACY.md`, and the Chrome Web Store privacy
answers and permission justifications are updated to say plainly what is read (page details,
bookmark folders, how often you use tabs, your profile and reasons), that it is kept in the browser
only, and that it never leaves it. The line saying TabSage cannot read page contents is removed. The
Hugging Face download remains the only network request.

## Left to the builder

- BM25 parameters, how phrases are found, and how terms are cleaned up (case, punctuation,
  numbers), so long as no fixed list decides which terms count as folders.
- The confidence threshold for Other, and the limits on how many folders are offered at once.
  These should be set by trying them on real tab sets, not guessed.
- How the profile, reasons and page details are cut down to fit the classifier's reading window.
- The design of the onboarding screens and the "why?" card, which should match the existing
  Settings page and stay out of the page's way.
- How "most used" is weighted over time, and the exact rules that stop the pinned area flickering.
- The storage layout, and moving existing users' folders and their own past corrections to the new
  layout. Corrections made by hand should carry over as reasons; decisions made by the old keyword
  rules should not.

## References

- Strands Decider: https://github.com/strands-labs/strands-decider
- Chrome built-in AI (Prompt API): https://developer.chrome.com/docs/ai/prompt-api
- Chrome extension permissions and warnings: https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings
- Okapi BM25: https://en.wikipedia.org/wiki/Okapi_BM25
- Current privacy policy: https://me.sauhsoj.wtf/privacy.html
