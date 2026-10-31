# chrome-tab-decider (TabSage)

A Chrome extension (Manifest V3) that keeps your tabs organized in **native Chrome tab groups**:

- **Nothing moves until the classifier is here.** Until Strands Decider has downloaded, TabSage does not move, group, pin or name any tab. Onboarding opens on first install while it downloads, and asks about your company, your work, your projects and the categories you want.
- **Each tab is decided on its own page.** A content script reads a short, fixed set of details from each page (title, meta description, `og:site_name`, `og:title`, first `h1`, language; each capped at 200 characters; never body text, form fields or typed input). [Strands Decider](https://github.com/strands-labs/strands-decider), running locally through ONNX Runtime Web (WebGPU), chooses each page's folder from a short list, given those details, your profile, any bookmark hint and your saved reasons. Low-confidence answers go to **Other**.
- **Folders come from you and your own tabs.** Your onboarding answers, groups you name, your bookmark folders, and terms that BM25 finds shared by several of your tabs but rare across the rest; the classifier checks each candidate before it becomes a folder. Chrome's built-in model may propose names too, when it is available. No fixed keyword or site list decides anything.
- **Work and personal, flat.** Work folders are titled `<Company> · <Folder>`, work tabs that fit no project go in a plain `<Company>` group, and personal folders have plain names. Only the top *N* folders get groups; the rest fold into their parent.
- **Your most-used tabs stay in reach.** The pages you switch to most become pinned tabs, and the next tier goes in a **Daily** group that is always first. Pages move in and out slowly, and your own pins are never touched.
- **Learns from you.** Drag a tab to another group and a small "Why?" card asks why, with one-click answers; the move is final for that page (or the whole site, if you say so) and the reason guides later decisions. Rename a group and the folder is renamed; name a group you made yourself and it becomes a folder.
- **Dynamic, configurable sorting.** Default: groups by most-recent use, tabs MRU with same-domain tabs kept together. Also by size, A–Z or manual. **Pinned groups always first**, Other always last.
- **Trims ad-hoc tabs.** Tabs not revisited in *X* days (default 7) are closed but stay **searchable** from the toolbar popup and reopen into their group. Pinned tabs, pinned groups, audible tabs and the active tab are never trimmed.
- **Persists and restores without reloading.** The layout is snapshotted continuously. On browser start, tabs Chrome already restored are regrouped in place; missing tabs come back as lightweight placeholders that show the saved title/favicon and only load when you open them.

Everything runs on-device. Page details, bookmarks, usage, your profile and your reasons are kept in the browser's local extension storage and never leave the browser. The only network traffic is the one-time model download from Hugging Face. See [PRIVACY.md](PRIVACY.md), and [docs/store-listing.md](docs/store-listing.md) for the Chrome Web Store answers.

## Install

**From CI (no build needed):** open the [`latest` pre-release](../../releases/tag/latest) (rebuilt on every push to `main`) or any tagged release, download `tabsage-<version>.zip`, unzip it, then `chrome://extensions` → **Developer mode** → **Load unpacked** → pick the unzipped folder. Every workflow run also has a `tabsage-extension-<version>` artifact with the same contents.

**From source:**

```bash
npm ci --ignore-scripts
npm run build        # → dist/
```

On first install onboarding opens and the classifier (≈1.1 GB) downloads from Hugging Face into the browser cache in the background; it is re-used on every later start. Click **Run self-test** in Settings to check tokenization and probabilities against the torch reference published with the model. Until the model is there, TabSage leaves your tabs where they are.

Shortcuts: `Alt+Shift+T` opens search, `Alt+Shift+O` organizes now.

## Models

The default is **Strands Decider 2B qwen3.5 v1-2610, 4-bit (q4f16)**, built by this repo's **Build model (q4f16)** workflow and published to [`sauhsoj/strands-decider-2B-qwen3.5-v1-2610-ONNX`](https://huggingface.co/sauhsoj/strands-decider-2B-qwen3.5-v1-2610-ONNX):

1. [strands-labs/strands-decider PR #77](https://github.com/strands-labs/strands-decider/pull/77)'s `prepare_model.py` folds the LoRA into the Qwen3.5 torso and exports the pointer head (`head.safetensors`, `head_config.json`) — the same split its torch-free `HiddenStateEngine` uses.
2. `model/reference.py` runs the self-test cases through the upstream torch engine (fp32) for exact token positions and reference probabilities.
3. `model/build_onnx.py` puts the torso into onnx-community's Qwen3.5-2B q4f16 graphs (4-bit, block 32), drops the LM head and appends the pointer head — one fused graph with the same inputs as the v19 build.
4. `model/parity.py` runs the graph in ONNX Runtime and fails the workflow if token positions differ or a clear answer flips.
5. `model/make_repo.py` publishes the graph, tokenizer, config and `selftest.json` to Hugging Face.

Run it from **Actions → Build model (q4f16) → Run workflow** after adding a `HF_TOKEN` repository secret (Hugging Face token with write access). Inputs let you pick another checkpoint, revision, strands-decider ref or target repo.

Other choices in Settings: All entries share the fused-graph contract
`input_ids, attention_mask, answer_pos, option_pos → logits [B, K]`.

| Setting | Repo | Size | Notes |
|---|---|---|---|
| **v1-2610 q4f16 (default)** | [`sauhsoj/strands-decider-2B-qwen3.5-v1-2610-ONNX`](https://huggingface.co/sauhsoj/strands-decider-2B-qwen3.5-v1-2610-ONNX) | ≈1.1 GB | Built by `.github/workflows/model.yml` |
| v19 q4f16 | [`onnx-community/strands-decider-2B-hobson-v19-ONNX`](https://huggingface.co/onnx-community/strands-decider-2B-hobson-v19-ONNX) | 1.09 GB | Newest 4-bit ONNX build; needs WebGPU `shader-f16` |
| v19 q8 | same repo | 1.80 GB | More stable on near-ties |
| v1-2610 fp16 (experimental) | [`warsang/strands-decider-2b-qwen3v1-web`](https://huggingface.co/warsang/strands-decider-2b-qwen3v1-web) | 3.9 GB | Newest checkpoint (`strands-decider-2B-qwen3.5-v1-2610`), community fp16 export; needs a lot of GPU memory |
| Custom | any HF repo | — | Same graph contract; temperatures read from `config.json` (`decider.temperature_by_kind`) or `strands_decider_config.json` |

## How classification works

1. **Read** each page's details through the content script (`src/content/`), kept per page only while it is open.
2. **Find folders** from your profile, your named groups, your bookmark folders and BM25 terms over your open tabs (`src/lib/bm25.js`); each new name is checked with a yes/no question to the classifier, and Chrome's built-in model (`LanguageModel.prompt` with a JSON schema) may add candidates.
3. **Decide** each new or changed page: BM25 picks a short list of folders, then a `choice` question over that list plus Other, with the page details, profile, bookmark hint and relevant reasons as state (`src/lib/decide.js`). The prompt is a byte-exact port of `strands_decider/prompting.py`; the option pointer positions are recovered from byte-level BPE token boundaries (`src/engine/tokens.js`) and verified by the self-test.
4. **Apply**: top *N* folders get groups per window, the rest fold into their parent; your most-used pages are pinned or put in Daily; then sort. Filed tabs are only re-decided at a quiet moment, and never while you are looking at them.

## Layout

```
src/background.js          service worker: events, alarms, messaging
src/lib/organizer.js       pages → folders → tab groups; pins; learns from user moves
src/content/               page details and the "Why?" card
src/lib/sorter.js          group/tab ordering (pinned first, MRU/count/alpha/manual)
src/lib/persist.js         snapshot + lazy restore on startup
src/lib/archive.js         trim stale tabs, search, reopen
src/engine/decider.js      ONNX Runtime Web (WebGPU) session for Strands Decider
src/engine/prompt.js       port of strands_decider prompting
src/engine/tokens.js       byte offsets for the pointer head
src/engine/llm.js          Chrome Prompt API category discovery
src/offscreen/offscreen.js offscreen document hosting the GPU + LLM sessions
static/                    manifest, popup, options, lazy placeholder
```

## CI

- `.github/workflows/extension.yml` — every push/PR: unit tests, build, Chromium E2E, packaged zip as an artifact; `main` updates the `latest` pre-release; `v*` tags publish a release.
- `.github/workflows/model.yml` — manual: builds and publishes the q4f16 model (above).

## Tests

```bash
npm test                                   # unit tests (node --test)
npm install --no-save --ignore-scripts playwright@1 && npx playwright install chromium   # once, for the E2E
node test/e2e/run.mjs                      # loads dist/ in Chromium (Playwright) with no classifier: nothing grouped, page details stored, onboarding opens
```

## Requirements

Chrome 138+. WebGPU with `shader-f16` for the 4-bit model (falls back to WebAssembly, slowly). The built-in LLM needs the hardware Chrome lists for Gemini Nano (22 GB free disk; >4 GB VRAM or 16 GB RAM).

## License

Apache-2.0. Strands Decider and Qwen3.5 weights are Apache-2.0 by their authors.
