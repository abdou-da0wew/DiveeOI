"""Export a trained checkpoint to the runtime layout the TypeScript app loads.

Target layout (under `<dataDir>/models/`):

  divee-query-student/
    divee-student.json          <- manifest read by src/embed/query-encoder.ts
    config.json                 <- teacher config (transformers.js dispatches on model_type)
    tokenizer.json, tokenizer_config.json, special_tokens_map.json
    onnx/model_int8.onnx        <- INT8 weights, outputs last_hidden_state

`promoted` is written as false: only `promote.py` (after the evaluation gates) may set it true, so
an unproven student can never silently replace BGE-M3 at chat time.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from divee_student import MAX_LEN, QueryStudent, StudentConfig, build_vocab_map, export_onnx, parameter_counts, quantize_int8

TEACHER_REPO = "Xenova/bge-m3"
TEACHER_REVISION = "4de13258303883538bd53b696b452bf8099f0858"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True, help="training output directory (best.pt + config.json)")
    parser.add_argument("--data", required=True, help="dataset directory (vocab.json)")
    parser.add_argument("--out", required=True, help="runtime directory to create")
    parser.add_argument("--teacher-hub", default="BAAI/bge-m3", help="tokenizer/config source")
    parser.add_argument("--teacher-repo", default=TEACHER_REPO, help="indexed model repo (must match the app manifest)")
    parser.add_argument("--teacher-revision", default=TEACHER_REVISION)
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--skip-quantization", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    import torch
    from transformers import AutoConfig, AutoTokenizer

    model_dir, data_dir, out = Path(args.model), Path(args.data), Path(args.out)
    config = StudentConfig(**json.loads((model_dir / "config.json").read_text(encoding="utf-8")))
    vocab = json.loads((data_dir / "vocab.json").read_text(encoding="utf-8"))
    config.vocab_size = int(vocab["size"])

    checkpoint = torch.load(model_dir / "best.pt", map_location="cpu", weights_only=True)
    model = QueryStudent(
        build_vocab_map([int(token_id) for token_id in vocab["ids"]], int(vocab["original_vocab"])),
        config,
    )
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()

    onnx_dir = out / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    fp32_path = onnx_dir / "model.onnx"
    export_onnx(model, str(fp32_path), opset=args.opset)
    runtime_path = fp32_path
    if not args.skip_quantization:
        runtime_path = onnx_dir / "model_int8.onnx"
        quantize_int8(str(fp32_path), str(runtime_path))

    # The runtime keeps the teacher tokenizer (same ids in, pruned ids inside the graph).
    tokenizer = AutoTokenizer.from_pretrained(args.teacher_hub)
    tokenizer.save_pretrained(out)
    AutoConfig.from_pretrained(args.teacher_hub).save_pretrained(out)

    counts = parameter_counts(model)
    manifest = {
        "format": 1,
        "name": "divee-query-student",
        "dims": 1024,
        "teacherRepo": args.teacher_repo,
        "teacherRevision": args.teacher_revision,
        "dtype": "int8" if not args.skip_quantization else "fp32",
        "maxLength": MAX_LEN,
        "promoted": False,
        "architecture": {
            "hidden": config.hidden,
            "layers": config.layers,
            "heads": config.heads,
            "ffn": config.ffn,
            "vocab": config.vocab_size,
            "original_vocab": int(vocab["original_vocab"]),
            "vocab_coverage": vocab.get("coverage"),
        },
        "parameters": counts,
        "onnx_bytes": runtime_path.stat().st_size,
    }
    (out / "divee-student.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    print(f"\ncopy {out} to <dataDir>/models/divee-query-student/ and keep retrieval.queryEncoder=auto")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
