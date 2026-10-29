# Privacy policy — TabSage

_Last updated: 2026-10-28_

TabSage sorts your open tabs into Chrome's own tab groups. It works out where
each tab belongs on your own computer. It does not collect, store, transmit or
sell your browsing data, and there is no TabSage account, sign-in or server.

## What TabSage reads

To group and sort your tabs, it reads from the browser you are using:

- the address and title of your open tabs
- which group each tab is in, and any name you gave that group
- when you last looked at each tab

That is the whole list, and all of it stays on your computer.

## Where the sorting happens

Both of the models that decide where a tab belongs run inside your browser:

- **Strands Decider** picks the group for each site. It runs on your graphics
  card through ONNX Runtime Web.
- **Chrome's built-in model** suggests the group names, on computers that
  support it. Chrome provides that model and runs it locally; TabSage only asks
  it questions. You can turn it off in Settings.

Your tab addresses and titles are what these models are given to read. Neither
of them sends anything out.

## The one network request

The first time it needs the classifier, TabSage downloads it from Hugging Face
and keeps it in the browser's cache, so later starts reuse it. That download is
the only thing TabSage fetches from the internet.

Hugging Face serves the file, so — as with any download — it can see your
network address and which file was asked for. It is told nothing about your
tabs. Turning off automatic download in Settings stops TabSage fetching it in
the background; it is then only fetched if and when a classification needs it.
Until the classifier is present, group names come from Chrome's built-in model
or from matching words in your titles.

Nothing else leaves your browser. There is no analytics, no crash or usage
reporting, no advertising and no tracking of any kind. The extension loads no
code from the internet — it only runs the scripts packaged inside it.

## What is kept, and how to get rid of it

TabSage saves your settings and a snapshot of your groups in the browser's
local extension storage, so your layout survives closing Chrome. It is kept on
that computer only and is **not** synced to your Google account.

- **Reset to defaults** on the Settings page clears it.
- Removing TabSage from `chrome://extensions` deletes all of it, along with the
  cached classifier.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `tabs` | Read the address, title and last-used time of your tabs — the thing being sorted. |
| `tabGroups` | Create, name, colour and reorder Chrome's native tab groups. |
| `storage` | Keep your settings and the saved layout on this computer. |
| `unlimitedStorage` | The classifier is far larger than the ordinary storage allowance. |
| `offscreen` | A background worker cannot reach the graphics card, so a hidden page hosts the model. |
| `alarms` | Wake up to re-sort, and to close tabs you have stopped using. |
| `favicon` | Show a saved site icon for a tab that has not been loaded back in yet. |
| `huggingface.co`, `hf.co` | Download the classifier. Nothing is uploaded to them. |

TabSage asks for no permission to read or change the contents of the pages you
visit.

## Children

TabSage is not directed at children, and collects nothing from anyone.

## Changes to this policy

Any change will be recorded here with a new date at the top, and the version
history is public in the repository below.

## References

- Source code — https://github.com/jsamuel1/chrome-tab-decider
- Questions, or to report a problem — https://github.com/jsamuel1/chrome-tab-decider/issues
- Strands Decider, the classifier — https://github.com/strands-labs/strands-decider
