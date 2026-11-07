# Chrome Web Store listing — TabSage

The answers to paste into the Chrome Web Store Developer Dashboard. They must agree with
[PRIVACY.md](../PRIVACY.md) and the public privacy policy; when one changes, change all of them.

## Store listing tab

**Short description** (132 characters at most; this is the manifest's `description`, so it is filled
in already):

> Keeps your tabs in auto-sorted Chrome tab groups, classified on-device with Strands Decider (WebGPU) and Chrome's built-in LLM.

**Category:** Productivity → Workflow & Planning. **Language:** English.

**Detailed description:**

```
TabSage sorts your open tabs into Chrome's own tab groups, and it does it on your computer: the classifier that decides where each tab belongs runs inside your browser, and nothing you browse ever leaves it.

• Groups that match how you work. Tell TabSage where you work, what you do and which projects or customers you have, and work tabs are grouped by project ("Amazon · Acme") while personal tabs are grouped by topic.
• It learns from you. Move a tab to another group and a small card asks why, with one-click answers. Your reasons shape later decisions, and pages you place by hand stay where you put them.
• New folders found in your own tabs. Distinctive words shared by several of your tabs become candidate folders, checked by the classifier before they are created. You can keep, rename or merge new folders in Settings.
• A tab bar that holds still. Your most recently used tabs are never moved, so Ctrl+Tab still finds the tab you were just on, and other tabs are only sorted after you have left the tab bar alone for a few minutes.
• Recent tabs one click away. The Recent side panel (Alt+Shift+R) lists your recent and most-used tabs, and your most-used pages are kept as pinned tabs.
• Trims tabs you have stopped using. Tabs you have not looked at for a week are closed but stay searchable from the toolbar, and recently closed ones come back with their Back history.
• Your layout survives restarts. Groups are restored without reloading every tab.

Private by design: TabSage reads only each page's title, description, site name, main heading and language, plus your bookmark folders, and keeps them in the browser's local storage. There is no account, no server, no analytics and no tracking. Its only network request is a one-time download of the classifier from Hugging Face.

Needs Chrome 138 or later. The classifier runs best on a graphics card with WebGPU (shader-f16).
```

**Images you upload yourself:** the 128 × 128 store icon (`static/icons/icon128.png`), at least one
1280 × 800 screenshot, and the 440 × 280 small promo tile.

**Homepage URL:** https://github.com/jsamuel1/chrome-tab-decider · **Support URL:**
https://github.com/jsamuel1/chrome-tab-decider/issues

## Single purpose

> TabSage keeps your open tabs sorted into Chrome's native tab groups. It decides which group each
> tab belongs in using a classifier that runs inside the browser, and keeps your recent and most-used
> tabs within easy reach.

Everything else it does serves that purpose: the toolbar search finds tabs it closed for you, the
Recent side panel lists your recent and most-used tabs, the saved layout puts your groups back after
Chrome restarts, and onboarding and the "Why?" card tell it how you like your tabs sorted.

## Permission justifications

**`tabs`** — TabSage sorts tabs. It reads each tab's address, title and last-used time to decide
which group it belongs in, to move it there, and to close tabs you have not used for a while (they
stay searchable and can be reopened).

**`tabGroups`** — TabSage creates, names, colours, collapses and reorders Chrome's native tab
groups. This is the extension's main output.

**`storage`** — Keeps your settings, the profile you fill in during onboarding, your saved reasons,
where each page was filed, and a snapshot of your groups, in the browser's local extension storage
on this computer. Nothing is synced or sent anywhere.

**`unlimitedStorage`** — The classifier that decides where tabs go is far larger than the ordinary
storage allowance, and is kept in the browser's cache so it is only downloaded once.

**`offscreen`** — A Manifest V3 service worker cannot use the graphics card. A hidden offscreen page
hosts the classifier so it can run on the graphics card through WebGPU.

**`alarms`** — Wakes the extension up to re-sort tabs at a quiet moment, to save the layout, and to
close tabs you have stopped using.

**`favicon`** — Shows a saved site icon on a placeholder tab that has not been loaded back in yet
after Chrome restarts.

**`sidePanel`** — Shows the Recent side panel, which lists the user's most recently used and most-used open tabs so they can switch to one with a click or the keyboard. It only reads tab titles and addresses already available through `tabs`, and never sends them anywhere.

**`sessions`** — When the user reopens, from TabSage's search, a tab TabSage closed after it went unused, TabSage looks for that tab in Chrome's recently closed tabs and restores it, so it comes back with its Back history instead of as a fresh tab. Only the entry for that page is used; nothing is read for any other purpose or sent anywhere.

**`scripting`** — Shows a small "Why?" card on a page right after you move its tab to another group
by hand, so you can say why with one click; and, once on install or update, reads the page details
below from tabs that were already open (Chrome only runs content scripts on pages loaded after
install).

**`bookmarks`** — Reads, and never changes, your bookmark folder names and which pages are in them.
Folder names are offered as categories during onboarding, and a page bookmarked in a folder is a
hint for which group its tab belongs in.

**Host permission: access to all websites (`<all_urls>`)** — A content script reads a short, fixed
set of details from each page you open: the page title, the meta description, the site name and
social title it declares (`og:site_name`, `og:title`), the first main heading (`h1`) and the page
language. Each item is cut to a short length. It never reads body text, form fields or anything you
type. These details let the classifier tell apart pages on the same site, such as a work document and
a personal one. They are kept in local extension storage only while the page is open and never leave
the browser. The same access lets the "Why?" card appear on whichever page you moved.

**Host permissions: `huggingface.co`, `*.huggingface.co`, `*.hf.co`** — Downloads the classifier
from Hugging Face, the only network request TabSage makes. Nothing is uploaded.

**Remote code** — No. All code is packaged in the extension. The classifier download is a model
file (data), not code.

## Data usage

TabSage handles the following on the user's device only. None of it is ever sent off the device, so
it is not sold, not shared, and not used for anything but sorting tabs. They are ticked to be plain
about what is read, even though none of it leaves the browser.

| Dashboard category | Ticked | What TabSage handles |
|---|---|---|
| Personally identifiable information | No | — |
| Health information | No | — |
| Financial and payment information | No | — |
| Authentication information | No | — |
| Personal communications | No | — |
| Location | No | — |
| Web history | Yes | Address, title and last-used time of open tabs, and of tabs it closed for you so you can find them again. |
| User activity | Yes | How often you switch to each tab, which group you move a tab to, and the reason you give in the "Why?" card. No keystrokes, clicks on pages or scrolling. |
| Website content | Yes | The page title, description, site name, social title, main heading and language of open pages. |

Bookmark folder names and the onboarding profile (company name and web addresses, kind of work,
projects and categories) are also kept locally; they fit none of the categories above.

Certifications (all ticked):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://me.sauhsoj.wtf/privacy.html#tabsage

## References

- Chrome Web Store program policies — https://developer.chrome.com/docs/webstore/program-policies
- Filling in the Privacy tab — https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Permission warnings — https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings
