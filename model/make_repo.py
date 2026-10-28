"""Assemble the Hugging Face repo the extension downloads, and (optionally) upload it.

    python model/make_repo.py MODEL REVISION ASSETS_DIR OUT_DIR SELFTEST_JSON [HF_REPO]

REPO layout (same as onnx-community/strands-decider-2B-hobson-v19-ONNX, plus selftest.json):
  config.json            decider section: temperatures, max_length, input contract
  tokenizer.json, tokenizer_config.json
  onnx/model_q4f16.onnx, onnx/model_q4f16.onnx_data
  selftest.json          token positions + torch reference probabilities the browser checks against
  README.md
"""
import json
import os
import shutil
import sys
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download

model_id, revision, assets, out, selftest = sys.argv[1:6]
hf_repo = sys.argv[6] if len(sys.argv) > 6 else ""
assets, out = Path(assets), Path(out)
repo = out / "repo"
(repo / "onnx").mkdir(parents=True, exist_ok=True)

for f in (out / "onnx").glob("model_q4f16.onnx*"):
    target = repo / "onnx" / f.name
    target.unlink(missing_ok=True)
    os.link(f, target)

head = json.loads((out / "decider_head.json").read_text())
src_cfg = json.loads(Path(hf_hub_download(model_id, "strands_decider_config.json", revision=revision)).read_text())
name = model_id.split("/")[-1]
config = {
    "architectures": ["StrandsDeciderModel"],
    "model_type": "qwen3_5_text",
    "hidden_size": head["hidden_size"],
    "pad_token_id": 248044,
    "decider": {
        "description": f"{name}: Qwen3.5-2B-Base + LoRA (merged) + a pointer head (dim {head['pointer_dim']}), fused into one 4-bit graph. One prompt per question: <state>…</state> then the rendered question ending at <answer>. Divide logits by temperature_by_kind[type] and softmax.",
        "source": model_id,
        "source_revision": revision,
        "max_length": head.get("max_length", src_cfg.get("max_length", 4096)),
        "max_question_fraction": 0.75,
        "pointer_dim": head["pointer_dim"],
        "temperature": head.get("temperature", src_cfg.get("temperature")),
        "temperature_by_kind": head.get("temperature_by_kind", src_cfg.get("temperature_by_kind")),
        "ordinal_smoothing": head.get("ordinal_smoothing", src_cfg.get("ordinal_smoothing")),
        "inputs": {"answer_pos": "index of the last real token (<answer>) per row", "option_pos": "index of each option line's last token, per row"},
    },
    "transformers.js_config": {"use_external_data_format": {"model_q4f16.onnx": 1}, "dtype": "q4f16"},
}
(repo / "config.json").write_text(json.dumps(config, indent=2) + "\n")
for f in ("tokenizer.json",):
    shutil.copyfile(assets / f, repo / f)
shutil.copyfile(hf_hub_download(model_id, "tokenizer_config.json", revision=revision), repo / "tokenizer_config.json")
shutil.copyfile(selftest, repo / "selftest.json")

st = json.loads(Path(selftest).read_text())
table = "\n".join(
    f"| {c['id']} | {c['probs']} | {c.get('onnx_q4f16_probs', '')} |" for c in st["cases"]
)
size = sum(f.stat().st_size for f in (repo / "onnx").iterdir()) / 1e9
(repo / "README.md").write_text(f"""---
license: apache-2.0
base_model:
- {model_id}
- Qwen/Qwen3.5-2B-Base
pipeline_tag: text-classification
library_name: onnxruntime
tags: [strands-decider, decision-model, onnx, webgpu, q4f16]
---

# {name} — ONNX q4f16 for WebGPU

Unofficial 4-bit browser build of [{model_id}](https://huggingface.co/{model_id}) (revision `{revision}`),
built by the [chrome-tab-decider](https://github.com/jsamuel1/chrome-tab-decider) model workflow:

1. strands-labs/strands-decider PR #77 `deploy/lambda/scripts/prepare_model.py` folds the LoRA into the torso
   and writes the pointer head (`head.safetensors`, `head_config.json`).
2. The torso's weights go into [onnx-community/Qwen3.5-2B-ONNX-OPT](https://huggingface.co/onnx-community/Qwen3.5-2B-ONNX-OPT)'s
   q4f16 graphs (every MatMulNBits weight re-quantized to 4 bits, block 32), the LM head is dropped, and the pointer head
   is appended in fp32 — the method of [onnx-community/strands-decider-2B-hobson-v19-ONNX](https://huggingface.co/onnx-community/strands-decider-2B-hobson-v19-ONNX)'s `conversion/`.

```
input_ids [B, L], attention_mask [B, L], answer_pos [B], option_pos [B, K]  ->  logits [B, K]
```

Divide by `decider.temperature_by_kind[type]` in `config.json` and softmax. Size: {size:.2f} GB. Needs WebGPU with `shader-f16`.

## Parity (ONNX Runtime CPU vs the upstream torch engine, fp32)

| case | torch fp32 | this q4f16 |
|---|---|---|
{table}

`selftest.json` holds these cases with exact token ids and option positions; the extension's self-test reproduces them in the browser.

Apache-2.0, as the original model and Qwen3.5-2B-Base.
""")
print(sorted(str(p.relative_to(repo)) for p in repo.rglob("*") if p.is_file()), file=sys.stderr)

if hf_repo:
    api = HfApi()
    api.create_repo(hf_repo, repo_type="model", exist_ok=True)
    commit = api.upload_folder(repo_id=hf_repo, folder_path=str(repo), commit_message=f"{name} q4f16 from {revision}")
    print("uploaded", commit.commit_url, file=sys.stderr)
