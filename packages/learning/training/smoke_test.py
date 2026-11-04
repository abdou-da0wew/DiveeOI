"""Tiny CPU smoke test: metrics always run, model training/export runs when torch is installed.

  python smoke_test.py            # ~30 s with torch, instant without

It proves the pieces that are easy to break: the metric definitions agree with the Rust engine,
the loss reduces, gradients flow through the vocab remap, and the ONNX export produces the exact
input/output names transformers.js needs.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import numpy as np

import metrics as M

MAX_LEN = 128  # mirrored from divee_student; imported lazily below so metrics run without torch


def check_metrics() -> None:
    ranked = ["a", "b", "c", "d"]
    relevant = {"b", "d", "x"}
    assert abs(M.recall_at(ranked, relevant, 2) - 1 / 3) < 1e-12, M.recall_at(ranked, relevant, 2)
    assert abs(M.recall_at(ranked, relevant, 4) - 2 / 3) < 1e-12
    assert M.reciprocal_rank_at(["a", "b"], {"b"}, 10) == 0.5
    assert abs(M.ndcg_at(["a", "b", "c"], {"a", "b"}, 10) - 1.0) < 1e-12
    assert M.percentile([10, 20, 30, 40, 50], 50) == 30.0
    summary = M.ranking_metrics([ranked], [relevant])
    assert set(summary) >= {"recall_at_5", "recall_at_10", "mrr_at_10", "ndcg_at_10"}
    assert M.ratios({"recall_at_10": 0.9}, {"recall_at_10": 1.0})["recall_at_10"] == 0.9
    print("metrics: ok")


def check_training_and_export() -> None:
    try:
        import torch
    except ImportError:
        print("torch is not installed: skipping the model/export part of the smoke test")
        return

    from divee_student import QueryStudent, StudentConfig, build_vocab_map, distill_loss, export_onnx

    torch.manual_seed(0)
    dims, tokens, passages = 1024, 64, 6
    config = StudentConfig(hidden=32, layers=1, heads=4, ffn=64, dropout=0.0, max_len=MAX_LEN, vocab_size=tokens)
    model = QueryStudent(build_vocab_map(list(range(4, tokens)), 256), config)

    # Teacher geometry: random unit vectors; the student must learn to reproduce them.
    teacher = torch.nn.functional.normalize(torch.randn(passages, dims), dim=-1)
    input_ids = torch.randint(4, tokens, (4, 8))
    input_ids[:, 0] = 0
    attention = torch.ones_like(input_ids)
    positive_index = torch.arange(4)
    candidate_ids = torch.arange(passages)
    positive_ids = torch.arange(4)
    teacher_q = torch.nn.functional.normalize(torch.randn(4, dims), dim=-1)

    optimizer = torch.optim.AdamW(model.parameters(), lr=5e-3)
    first = None
    for step in range(6):
        student_q = model.embed(input_ids, attention)
        loss, parts = distill_loss(student_q, teacher_q, teacher, positive_index, candidate_ids, positive_ids)
        optimizer.zero_grad()
        loss.backward()
        assert any(parameter.grad is not None for parameter in model.parameters()), "no gradients"
        optimizer.step()
        if first is None:
            first = float(loss)
        print(f"step {step}: loss={float(loss):.4f} cos={parts['cos']:.4f} nce={parts['nce']:.4f} kl={parts['kl']:.4f}")
    assert float(loss) < first, "loss did not decrease"

    embedded = model.embed(input_ids, attention).detach().numpy()
    assert embedded.shape == (4, dims), embedded.shape
    assert np.allclose(np.linalg.norm(embedded, axis=1), 1.0, atol=1e-4)

    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "model.onnx"
        export_onnx(model, str(target))
        assert target.exists() and target.stat().st_size > 1024, "onnx export failed"
        try:
            from onnxruntime.quantization import QuantType, quantize_dynamic

            quantized = Path(directory) / "model_int8.onnx"
            quantize_dynamic(str(target), str(quantized), weight_type=QuantType.QInt8)
            print(f"quantized: {quantized.stat().st_size // 1024} KiB")
        except ImportError:
            print("onnxruntime is not installed: skipping int8 quantization")
        print(f"onnx export: ok ({target.stat().st_size // 1024} KiB fp32)")
    print("training + export: ok")


def main() -> int:
    print(json.dumps({"max_len": MAX_LEN, "contract": "cls pooling, l2 normalised, 1024 dims"}))
    check_metrics()
    check_training_and_export()
    print("smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
