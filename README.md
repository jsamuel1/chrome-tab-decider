# chrome-tab-decider (TabSage)

A Chrome extension (Manifest V3) that keeps your tabs organized in **native Chrome tab groups**:

- **Same domain → same group**, always. One classification decision per domain, remembered.
- **Top categories, discovered from your titles.** A single pass over all tab titles with Chrome's built-in LLM (Prompt API / Gemini Nano, JSON-schema constrained) proposes folder names. Falls back to keyword extraction when the LLM isn't available.
- **Strands Decider on WebGPU as the classifier.** Each domain cluster is filed into one of the discovered folders with a `choice` question to [Strands Decider](https://github.com/strands-labs/strands-decider) running locally via ONNX Runtime Web (WebGPU). Low-confidence answers go to **Other**. Only the top *N* categories get groups; the rest fold into Other. When Other grows, new folders are discovered incrementally.
- **Dynamic, configurable sorting.** Default: groups by most-recent use, tabs MRU with same-domain tabs kept together. Also by size, A–Z or manual. **Pinned groups always first**, Other always last.
- **Trims ad-hoc tabs.** Tabs not revisited in *X* days (default 7) are closed but stay **searchable** from the toolbar popup and reopen into their group. Pinned tabs, pinned groups, audible tabs and the active tab are never trimmed.
- **Persists and restores without reloading.** The layout is snapshotted continuously. On browser start, tabs Chrome already restored are regrouped in place; missing tabs come back as lightweight placeholders that show the saved title/favicon and only load when you open them.
- **Learns from you.** Drag a tab to another group and its whole domain follows; rename a group and the folder is renamed; name a group you made yourself and it becomes a folder.

Everything runs on-device — no tab data leaves the browser. The only network traffic is the one-time model download from Hugging Face.

## Install

**From CI (no build needed):** open the [`latest` pre-release](../../releases/tag/latest) (rebuilt on every push to `main`) or any tagged release, download `tabsage-<version>.zip`, unzip it, then `chrome://extensions` → **Developer mode** → **Load unpacked** → pick the unzipped folder. Every workflow run also has a `tabsage-extension-<version>` artifact with the same contents.

**From source:**

```bash
npm ci --ignore-scripts
npm run build        # → dist/
```

On first install the settings page opens and the classifier (≈1.1 GB) downloads from Hugging Face into the browser cache in the background; it is re-used on every later start. Click **Run self-test** to check tokenization and probabilities against the torch reference published with the model. Until the model is there, the built-in LLM or keyword matching is used.

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

1. **Cluster** tabs by hostname (or registrable domain — setting).
2. **Discover** folders once over all titles (`LanguageModel.prompt` with a JSON schema), alongside the folders from your onboarding profile. Existing folder names are passed back in so they stay stable.
3. **Decide** for each *new* domain: state = site + its tab titles; question = `choice` over the folders + Other. The prompt is a byte-exact port of `strands_decider/prompting.py`; the option pointer positions are recovered from byte-level BPE token boundaries (`src/engine/tokens.js`) and verified by the self-test.
4. **Apply**: top *N* categories get groups per window; everything else goes to Other. Then sort.

## Layout

```
src/background.js          service worker: events, alarms, messaging
src/lib/organizer.js       clusters → categories → tab groups; learns from user moves
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
npm test                                   # prompt rendering vs upstream fixtures, URL helpers
NODE_PATH=$(npm root -g) node test/e2e/run.mjs   # loads dist/ in Chromium (Playwright), organizes test tabs
```

## Requirements

Chrome 138+. WebGPU with `shader-f16` for the 4-bit model (falls back to WebAssembly, slowly). The built-in LLM needs the hardware Chrome lists for Gemini Nano (22 GB free disk; >4 GB VRAM or 16 GB RAM).

## License

Apache-2.0. Strands Decider and Qwen3.5 weights are Apache-2.0 by their authors.
