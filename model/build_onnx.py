"""Build a fused, 4-bit WebGPU graph of a Qwen3.5 strands-decider checkpoint.

    python model/build_onnx.py TORSO_DIR ASSETS_DIR BASE_ONNX_DIR MAPPING_JSON OUT_DIR

Inputs
  TORSO_DIR      prepare_model.py's torso/ (strands-labs/strands-decider PR #77): the decoder with
                 the LoRA folded in, saved as a Qwen3_5ForCausalLM checkpoint.
  ASSETS_DIR     prepare_model.py's assets/: tokenizer.json, head.safetensors, head_config.json.
  BASE_ONNX_DIR  onnx-community/Qwen3.5-2B-ONNX-OPT (decoder_model_merged_q4f16, embed_tokens_q4f16).
  MAPPING_JSON   the value-checked initializer → HF parameter map from
                 onnx-community/strands-decider-2B-hobson-v19-ONNX (conversion/qwen3_5_opt_mapping.json).

Output
  OUT_DIR/onnx/model_q4f16.onnx (+ .onnx_data): one graph,
      input_ids [B,L], attention_mask [B,L], answer_pos [B], option_pos [B,K] -> logits [B,K]
  the same contract as onnx-community/strands-decider-2B-hobson-v19-ONNX, so the extension's engine
  runs it unchanged. The method follows that repo's conversion/build_onnx.py and fuse.py (Apache-2.0):
  keep onnx-community's Qwen3.5 graphs, put the decider's weights into them, re-quantize every
  MatMulNBits weight to 4 bits (block 32), drop the LM head, append PR #77's pointer head in fp32.

Weights are read one tensor at a time, so peak memory stays near the size of the q4f16 graph.
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import onnx
import torch
from onnx import TensorProto, helper, numpy_helper
from onnxruntime.capi._pybind_state import quantize_matmul_4bits
from safetensors import safe_open

TORSO, ASSETS, BASE, MAPPING, OUT = map(Path, sys.argv[1:6])
MM_PREFIX = "model.language_model."  # parameter names in the mapping (multimodal Qwen3.5)


# ---------------------------------------------------------------- torso parameters, lazily
class Params:
    def __init__(self, torso: Path):
        self.files = {}
        for f in sorted(torso.glob("*.safetensors")):
            with safe_open(str(f), "pt") as st:
                for k in st.keys():
                    self.files[k] = f
        print(f"torso: {len(self.files)} tensors in {len(set(self.files.values()))} files", file=sys.stderr)

    def resolve(self, name: str) -> str:
        """Mapping names are model.language_model.X; a text-only causal LM saves model.X."""
        for cand in (name, name.replace(MM_PREFIX, "model."), name.replace(MM_PREFIX, "")):
            if cand in self.files:
                return cand
        raise KeyError(name)

    def __getitem__(self, name: str) -> np.ndarray:
        key = self.resolve(name)
        with safe_open(str(self.files[key]), "pt") as st:
            return st.get_tensor(key).to(torch.float32).numpy()


params = Params(TORSO)


# ---------------------------------------------------------------- mapping (as build_onnx.py)
def build_spec(graph):
    m = json.loads(MAPPING.read_text())["mapping"]["decoder_model_merged"]
    spec = {k: dict(v) for k, v in m.items() if not k.startswith("lm_head")}
    for init in graph.initializer:
        g = re.fullmatch(r"model\.layers\.(\d+)\.gdn\.(A_neg_exp|dt_bias|norm\.weight)", init.name)
        if g:
            param = f"{MM_PREFIX}layers.{g[1]}.linear_attn." + {"A_neg_exp": "A_log", "dt_bias": "dt_bias", "norm.weight": "norm.weight"}[g[2]]
            spec[init.name] = {"param": param, "transform": "neg_exp" if g[2] == "A_neg_exp" else "identity"}
    return spec


def transformed(s, shape=None):
    p = params[s["param"]]
    how = s["transform"]
    if how == "transpose":
        p = p.T
    elif how == "plus_one":
        p = p + 1.0
    elif how == "neg_exp":
        p = -np.exp(p)
    elif how != "identity":
        raise ValueError(how)
    return np.ascontiguousarray(p.reshape(shape) if shape is not None else p)


def quant4(w):
    """[K, N] float -> MatMulNBits 4-bit (packed [N, K/32, 16], fp16 scales [N, K/32], zp [N, ceil(K/32/2)])."""
    K, N = w.shape
    kb = (K + 31) // 32
    packed = np.zeros((N, kb, 16), "uint8")
    zp = np.zeros((N, (kb + 1) // 2), "uint8")
    scales = np.zeros((N, kb), np.float16)
    quantize_matmul_4bits(packed, np.ascontiguousarray(w.astype(np.float16)), scales, zp, 32, N, K, False)
    return packed, scales, zp


def set_init(init, array):
    dtype = helper.tensor_dtype_to_np_dtype(init.data_type)
    init.CopyFrom(numpy_helper.from_array(np.asarray(array).astype(dtype, copy=False).reshape(list(init.dims)), init.name))


def expose_hidden_state(model, hidden):
    g = model.graph
    head = [n for n in g.node if n.name.startswith("/lm_head/MatMul")]
    assert len(head) == 1, [n.name for n in head]
    sliced = head[0].input[0]
    g.node.remove(head[0])
    g.node.append(helper.make_node("Identity", [sliced], ["last_hidden_state"], name="/last_hidden_state"))
    logits = next(o for o in g.output if o.name == "logits")
    elem = logits.type.tensor_type.elem_type
    idx = list(g.output).index(logits)
    g.output.remove(logits)
    g.output.insert(idx, helper.make_tensor_value_info("last_hidden_state", elem, ["batch_size", "sequence_length", hidden]))
    used = {i for n in g.node for i in n.input}
    for init in [i for i in g.initializer if i.name not in used]:
        g.initializer.remove(init)


def main():
    (OUT / "onnx").mkdir(parents=True, exist_ok=True)
    head_cfg = json.loads((ASSETS / "head_config.json").read_text())
    D = int(head_cfg["pointer_dim"])

    # ---- decoder: swap weights, re-quantize
    model = onnx.load(str(BASE / "onnx/decoder_model_merged_q4f16.onnx"), load_external_data=True)
    cfg = json.loads((TORSO / "config.json").read_text())
    H = int((cfg.get("text_config") or cfg)["hidden_size"])
    spec = build_spec(model.graph)
    expose_hidden_state(model, H)
    by_flat = {name.replace(".", "_"): name for name in spec}
    inits = {i.name: i for i in model.graph.initializer}
    handled = set()
    for name, init in inits.items():
        if name.endswith("_quant"):
            stem = name[: -len("_quant")]
            s = spec[by_flat[stem]]
            assert s["transform"] == "transpose", (stem, s)
            w = transformed(s)  # [K, N] = W.T
            packed, scales, zp = quant4(w)
            set_init(init, packed)
            set_init(inits[stem + "_scales"], scales)
            set_init(inits[stem + "_zp"], zp)
            handled |= {name, stem + "_scales", stem + "_zp"}
        elif name in spec:
            set_init(init, transformed(spec[name], list(init.dims)))
            handled.add(name)
    big_unhandled = [n for n, i in inits.items() if n not in handled and int(np.prod(i.dims or [1])) >= 4096]
    print(f"decoder: replaced {len(handled)} initializers; large ones left as-is: {big_unhandled[:12]}", file=sys.stderr)

    # ---- embeddings (GatherBlockQuantized, blocks along each row)
    embed = onnx.load(str(BASE / "onnx/embed_tokens_q4f16.onnx"), load_external_data=True)
    einits = {i.name: i for i in embed.graph.initializer}
    (stem,) = [n[: -len("_quant")] for n in einits if n.endswith("_quant")]
    packed, scales, zp = quant4(params[MM_PREFIX + "embed_tokens.weight"].T)
    set_init(einits[stem + "_quant"], packed)
    set_init(einits[stem + "_scales"], scales)
    set_init(einits[stem + "_zp"], zp)
    print("embeddings re-quantized", file=sys.stderr)

    # ---- fuse (as fuse.py): embeddings + empty caches + pointer head
    g = model.graph
    nodes = []
    c = lambda name, array: g.initializer.append(numpy_helper.from_array(np.asarray(array), name))  # noqa: E731
    node = lambda op, ins, outs, **kw: nodes.append(helper.make_node(op, ins, outs, name=f"/fuse/{outs[0]}", **kw))  # noqa: E731
    for init in embed.graph.initializer:
        g.initializer.append(init)
    embed_nodes = list(embed.graph.node)

    c("fuse_zero", np.array([0], np.int64)); c("fuse_one", np.array([1], np.int64))
    c("fuse_zero_s", np.array(0, np.int64)); c("fuse_one_s", np.array(1, np.int64))
    node("Shape", ["input_ids"], ["ids_shape"])
    node("Gather", ["ids_shape", "fuse_zero"], ["batch"], axis=0)
    node("Gather", ["ids_shape", "fuse_one_s"], ["length_s"], axis=0)
    c("fuse_three_b", np.array([3], np.int64))
    node("Range", ["fuse_zero_s", "length_s", "fuse_one_s"], ["arange"])
    node("Unsqueeze", ["arange", "fuse_zero"], ["arange_1l"])
    node("Unsqueeze", ["arange_1l", "fuse_zero"], ["arange_11l"])
    node("Unsqueeze", ["length_s", "fuse_zero"], ["length"])
    node("Concat", ["fuse_three_b", "batch", "length"], ["pos_shape"], axis=0)
    node("Expand", ["arange_11l", "pos_shape"], ["position_ids"])
    c("num_logits_to_keep", np.array(0, np.int64))

    drop = []
    for inp in g.input:
        if not inp.name.startswith("past_"):
            continue
        dims = inp.type.tensor_type.shape.dim
        elem = inp.type.tensor_type.elem_type
        tail = [0 if d.dim_param else d.dim_value for d in dims[1:]]
        c(f"{inp.name}_tail", np.array(tail, np.int64))
        node("Concat", ["batch", f"{inp.name}_tail"], [f"{inp.name}_shape"], axis=0)
        zero = helper.make_tensor(f"{inp.name}_zero", elem, [1], [0])
        nodes.append(helper.make_node("ConstantOfShape", [f"{inp.name}_shape"], [inp.name], name=f"/fuse/{inp.name}", value=zero))
        drop.append(inp)

    prelude, nodes = nodes, []
    with safe_open(str(ASSETS / "head.safetensors"), "pt") as st:
        hw = {k: st.get_tensor(k).to(torch.float32).numpy() for k in st.keys()}
    assert set(hw) >= {"norm.weight", "norm.bias", "q.weight", "q.bias", "k.weight", "k.bias"}, sorted(hw)
    assert hw["q.weight"].shape == (D, H), (hw["q.weight"].shape, D, H)
    c("head_norm_w", hw["norm.weight"]); c("head_norm_b", hw["norm.bias"])
    c("head_q_wt", hw["q.weight"].T.copy()); c("head_q_b", hw["q.bias"])
    c("head_k_wt", hw["k.weight"].T.copy()); c("head_k_b", hw["k.bias"])
    c("head_scale", np.array(D ** -0.5, np.float32))
    c("fuse_last", np.array([-1], np.int64))
    node("Cast", ["last_hidden_state"], ["hidden32"], to=TensorProto.FLOAT)
    node("Unsqueeze", ["answer_pos", "fuse_last"], ["answer_idx"])
    node("GatherND", ["hidden32", "answer_idx"], ["answer_h"], batch_dims=1)
    node("Unsqueeze", ["option_pos", "fuse_last"], ["option_idx"])
    node("GatherND", ["hidden32", "option_idx"], ["option_h"], batch_dims=1)
    node("LayerNormalization", ["answer_h", "head_norm_w", "head_norm_b"], ["answer_n"], axis=-1, epsilon=1e-5)
    node("LayerNormalization", ["option_h", "head_norm_w", "head_norm_b"], ["option_n"], axis=-1, epsilon=1e-5)
    node("MatMul", ["answer_n", "head_q_wt"], ["q_mm"]); node("Add", ["q_mm", "head_q_b"], ["q"])
    node("MatMul", ["option_n", "head_k_wt"], ["k_mm"]); node("Add", ["k_mm", "head_k_b"], ["k"])
    node("Unsqueeze", ["q", "fuse_last"], ["q_col"])
    node("MatMul", ["k", "q_col"], ["dot"])
    node("Squeeze", ["dot", "fuse_last"], ["dot_bk"])
    node("Mul", ["dot_bk", "head_scale"], ["logits"])

    for inp in drop + [i for i in g.input if i.name in ("inputs_embeds", "position_ids", "num_logits_to_keep")]:
        g.input.remove(inp)
    g.input.insert(0, helper.make_tensor_value_info("input_ids", TensorProto.INT64, ["batch_size", "sequence_length"]))
    for inp in list(g.input):
        if inp.name == "attention_mask":
            g.input.remove(inp)
            g.input.insert(1, helper.make_tensor_value_info("attention_mask", TensorProto.INT64, ["batch_size", "sequence_length"]))
            break
    g.input.append(helper.make_tensor_value_info("answer_pos", TensorProto.INT64, ["batch_size"]))
    g.input.append(helper.make_tensor_value_info("option_pos", TensorProto.INT64, ["batch_size", "num_options"]))
    while len(g.output):
        g.output.pop()
    g.output.append(helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["batch_size", "num_options"]))
    all_nodes = embed_nodes + prelude + list(g.node) + nodes
    del g.node[:]
    g.node.extend(all_nodes)

    needed, keep = {"logits"}, []
    for n in reversed(list(g.node)):
        if any(o in needed for o in n.output):
            keep.append(n)
            needed.update(i for i in n.input if i)
    keep.reverse()
    del g.node[:]
    g.node.extend(keep)
    used = {i for n in g.node for i in n.input}
    for init in [i for i in g.initializer if i.name not in used]:
        g.initializer.remove(init)
    for vi in list(g.value_info):
        g.value_info.remove(vi)

    path = OUT / "onnx" / "model_q4f16.onnx"
    for stale in path.parent.glob("model_q4f16.onnx_data*"):
        stale.unlink()
    onnx.save(model, str(path), save_as_external_data=True, all_tensors_to_one_file=True,
              location="model_q4f16.onnx_data", size_threshold=1024)
    (OUT / "decider_head.json").write_text(json.dumps({"hidden_size": H, "pointer_dim": D, **head_cfg}, indent=2))
    print("wrote", path, len(g.node), "nodes", file=sys.stderr)


if __name__ == "__main__":
    main()
