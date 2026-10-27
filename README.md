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

## Install (developer mode)

```bash
npm install --ignore-scripts
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, **Load unpacked** → select `dist/`.

On first install the settings page opens. Click **Download & load** to fetch the classifier (≈1.1 GB, cached), then **Run self-test** to check tokenization and probabilities against the upstream PyTorch reference on your GPU. Until the model is downloaded, the built-in LLM or keyword matching is used.

Shortcuts: `Alt+Shift+T` opens search, `Alt+Shift+O` organizes now.

## Models

Configurable in Settings. All entries share the fused-graph contract
`input_ids, attention_mask, answer_pos, option_pos → logits [B, K]`.

| Setting | Repo | Size | Notes |
|---|---|---|---|
| **v19 q4f16 (default)** | [`onnx-community/strands-decider-2B-hobson-v19-ONNX`](https://huggingface.co/onnx-community/strands-decider-2B-hobson-v19-ONNX) | 1.09 GB | Newest 4-bit ONNX build; needs WebGPU `shader-f16` |
| v19 q8 | same repo | 1.80 GB | More stable on near-ties |
| v1-2610 fp16 (experimental) | [`warsang/strands-decider-2b-qwen3v1-web`](https://huggingface.co/warsang/strands-decider-2b-qwen3v1-web) | 3.9 GB | Newest checkpoint (`strands-decider-2B-qwen3.5-v1-2610`), community fp16 export; needs a lot of GPU memory |
| Custom | any HF repo | — | Same graph contract; temperatures read from `config.json` (`decider.temperature_by_kind`) or `strands_decider_config.json` |

The newer official `v1-2610` checkpoint has no 4-bit ONNX export yet; when one appears, add it as a Custom model (or to `src/engine/models.js`).

## How classification works

1. **Cluster** tabs by hostname (or registrable domain — setting).
2. **Discover** folders once over all titles (`LanguageModel.prompt` with a JSON schema), merged with any "always-offered" folders you set. Existing folder names are passed back in so they stay stable.
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

## Tests

```bash
npm test                                   # prompt rendering vs upstream fixtures, heuristics, URL helpers
NODE_PATH=$(npm root -g) node test/e2e/run.mjs   # loads dist/ in Chromium (Playwright), organizes test tabs
```

## Requirements

Chrome 138+. WebGPU with `shader-f16` for the 4-bit model (falls back to WebAssembly, slowly). The built-in LLM needs the hardware Chrome lists for Gemini Nano (22 GB free disk; >4 GB VRAM or 16 GB RAM).

## License

Apache-2.0. Strands Decider and Qwen3.5 weights are Apache-2.0 by their authors.
