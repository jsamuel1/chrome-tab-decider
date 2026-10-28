"""Run the fused q4f16 graph in ONNX Runtime (CPU) on the self-test cases and compare it with
the torch reference. Fails (exit 1) if token positions differ or a clear answer flips.

    python model/parity.py OUT_DIR SELFTEST_JSON TEMPS_JSON
"""
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

out, selftest, temps_path = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()), Path(sys.argv[3])
temps = json.loads(temps_path.read_text())["temperature_by_kind"]
so = ort.SessionOptions()
so.log_severity_level = 3
sess = ort.InferenceSession(str(out / "onnx/model_q4f16.onnx"), so, providers=["CPUExecutionProvider"])

worst, flips, rows = 0.0, 0, []
for c in selftest["cases"]:
    ids = np.array([c["ids"]], np.int64)
    L = ids.shape[1]
    (lg,) = sess.run(None, {
        "input_ids": ids, "attention_mask": np.ones((1, L), np.int64),
        "answer_pos": np.array([L - 1], np.int64), "option_pos": np.array([c["opt"]], np.int64),
    })
    z = lg[0] / temps[c["kind"]]
    p = np.exp(z - z.max()); p /= p.sum()
    ref = np.array(c["probs"])
    d = float(np.abs(p - ref).max())
    clear = ref.max() - np.sort(ref)[-2] > 0.15  # a near-tie may flip under 4-bit; a clear answer may not
    flip = int(p.argmax() != ref.argmax())
    worst = max(worst, d)
    flips += flip and clear
    c["onnx_q4f16_probs"] = [round(float(x), 4) for x in p]
    rows.append((c["id"], [round(float(x), 3) for x in p], c["probs"], round(d, 3), "FLIP" if flip else ""))
    print(*rows[-1], file=sys.stderr)

Path(sys.argv[2]).write_text(json.dumps(selftest, indent=1))
print(f"q4f16 vs torch fp32: worst |dp| {worst:.3f}, clear flips {flips}", file=sys.stderr)
if flips or worst > 0.2:
    sys.exit(1)
