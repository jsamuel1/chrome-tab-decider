"""Reference answers for the self-test cases from the upstream torch engine (fp32, CPU),
plus the exact token positions from the upstream tokenizer and prompting code.

    python model/reference.py MODEL REVISION ASSETS_DIR OUT_JSON

ASSETS_DIR is prepare_model.py's assets/ (PR #77): tokenizer.json, head_config.json.
"""
import json
import sys
from pathlib import Path

from tokenizers import Tokenizer

from strands_decider.infer import load_engine
from strands_decider.modeling import checkpoint_dir
from strands_decider.prompting import option_token_index, render_question, render_state
from strands_decider.schema import SystemOneRequest

model_id, revision, assets, out = sys.argv[1:5]
cases = json.loads((Path(__file__).parent / "cases.json").read_text())["cases"]
tok = Tokenizer.from_file(str(Path(assets) / "tokenizer.json"))
tok.no_truncation()
tok.no_padding()
engine = load_engine(checkpoint_dir(model_id, revision), device="cpu", use_prefix_cache=False)

rows = []
for c in cases:
    req = SystemOneRequest(state=c["state"], questions={"q": c["question"]})
    rq = render_question(req.questions["q"])
    s = tok.encode(render_state(req.state), add_special_tokens=True).ids
    e = tok.encode(rq.text, add_special_tokens=False)
    opt = [len(s) + j for j in option_token_index(list(e.offsets), rq.option_spans, 0)]
    a = engine.evaluate(req).answers["q"].model_dump()
    if rq.kind == "noul":
        assert list(rq.slot_labels) == ["false", "true"]
        probs = [1 - a["noul"], a["noul"]]
    else:
        probs = [a["probabilities"][label] for label in rq.slot_labels]
    rows.append({
        "id": c["id"], "state": c["state"], "question": c["question"], "kind": rq.kind,
        "labels": list(rq.slot_labels), "ids": s + e.ids, "len": len(s) + len(e.ids), "opt": opt,
        "probs": [round(float(p), 4) for p in probs],
    })
    print(c["id"], rows[-1]["len"], opt, rows[-1]["probs"], file=sys.stderr)

Path(out).write_text(json.dumps({"model": model_id, "revision": revision, "reference": "strands_decider torch engine, fp32, CPU", "cases": rows}, indent=1))
