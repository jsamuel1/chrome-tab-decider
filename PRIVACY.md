# Privacy policy — TabSage

_Last updated: 2026-10-31_

TabSage sorts your open tabs into Chrome's own tab groups. It works out where
each tab belongs on your own computer. Everything it reads stays in your
browser: it does not collect, transmit or sell your browsing data, and there is
no TabSage account, sign-in or server.

## What TabSage reads

To decide where each tab belongs, it reads the following, all from the browser
you are using:

- **Your open tabs:** their address and title, which group each tab is in, and
  any name you gave that group.
- **A few details from each page you open:** the page title, its short
  description, the site name and social-media title the page gives itself, its
  main heading, and its language. Each item is cut to a short length. TabSage
  does not read the rest of the page — no body text, no form fields, and nothing
  you type.
- **Your bookmark folders,** and which pages are in them. TabSage only reads
  your bookmarks; it never changes them.
- **How often you use your tabs:** when you last looked at each tab and how
  often you switch to it, so your most-used pages can be kept pinned or in the
  Daily group.
- **What you tell it:** the profile you fill in when you install it (your
  company and its web addresses, your kind of work, your projects and the
  categories you want), and the reasons you give when you move a tab and
  TabSage asks why.

Pages where Chrome does not let extensions run, such as Chrome's own pages and
the Chrome Web Store, are sorted from their address and title alone.

## Where the sorting happens

Both of the models that decide where a tab belongs run inside your browser:

- **Strands Decider** chooses the folder for each tab. It runs on your graphics
  card through ONNX Runtime Web.
- **Chrome's built-in model** suggests folder names, on computers that support
  it. Chrome provides that model and runs it locally; TabSage only asks it
  questions. You can turn it off in Settings.

The items listed above are what these models are given to read. Neither of them
sends anything out.

## The one network request

The first time it needs the classifier, TabSage downloads it from Hugging Face
and keeps it in the browser's cache, so later starts reuse it. That download is
the only thing TabSage fetches from the internet.

Hugging Face serves the file, so — as with any download — it can see your
network address and which file was asked for. It is told nothing about your
tabs, your pages, your bookmarks or you. Turning off automatic download in
Settings stops TabSage fetching it in the background; it is then only fetched
when a decision needs it. Until the classifier is present, TabSage does not
move, group, pin or name any tab.

Nothing else leaves your browser. There is no analytics, no crash or usage
reporting, no advertising and no tracking of any kind. The extension loads no
code from the internet — it only runs the scripts packaged inside it.

## What is kept, and how to get rid of it

TabSage keeps the following in the browser's local extension storage, on that
computer only. None of it is synced to your Google account or sent anywhere.

- your settings, profile and saved reasons;
- the folders and where each page was filed;
- the page details of pages that are open in a tab, which are forgotten once
  the page is no longer open;
- how often you have used each page lately, which fades away when you stop
  using it;
- a snapshot of your groups, so your layout survives closing Chrome;
- the address and title of tabs it closed for you after you stopped using them,
  so you can search for and reopen them.

To remove it:

- **Reset to defaults** on the Settings page clears all of it.
- Your saved reasons can be deleted one by one in Settings.
- Removing TabSage from `chrome://extensions` deletes all of it, along with the
  cached classifier.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `tabs` | Read the address, title and last-used time of your tabs — the thing being sorted. |
| `tabGroups` | Create, name, colour and reorder Chrome's native tab groups. |
| Access to all websites | Read the short list of page details above from each page you open, and let the small "Why?" card appear on any page whose tab you move by hand. Nothing read is sent anywhere. |
| `scripting` | Show the "Why?" card on a page after you move its tab by hand, and read page details from tabs that were already open when TabSage was installed or updated. |
| `bookmarks` | Read your bookmark folder names and which pages are in them, as a hint for where tabs belong. Bookmarks are never changed. |
| `storage` | Keep your settings, profile and saved layout on this computer. |
| `unlimitedStorage` | The classifier is far larger than the ordinary storage allowance. |
| `offscreen` | A background worker cannot reach the graphics card, so a hidden page hosts the model. |
| `alarms` | Wake up to re-sort, and to close tabs you have stopped using. |
| `favicon` | Show a saved site icon for a tab that has not been loaded back in yet. |
| `huggingface.co`, `hf.co` | Download the classifier. Nothing is uploaded to them. |

## Children

TabSage is not directed at children, and collects nothing from anyone.

## Changes to this policy

Any change will be recorded here with a new date at the top, and the version
history is public in the repository below.

## References

- Source code — https://github.com/jsamuel1/chrome-tab-decider
- Questions, or to report a problem — https://github.com/jsamuel1/chrome-tab-decider/issues
- Strands Decider, the classifier — https://github.com/strands-labs/strands-decider
