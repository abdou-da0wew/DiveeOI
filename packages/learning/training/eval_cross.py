"""Cross-corpus evaluation of a Divee student runtime against the REAL book corpus.

The v3 students are trained on Colab over a public corpus (Wikipedia + Egyptian-Baccalaureate
textbooks). This script asks the deployment question: *on the user's real books.db corpus and its
held-out dataset rows, how close is the student to the teacher?* It therefore reuses the real
corpus dataset (dataset-v5 on the VDS: passages + teacher query vectors + the same
split_rows(seed, val_fraction) replayed exactly) and runs the student through its **runtime ONNX
graph** with onnxruntime — no torch, exactly what the app does at query time.

Output report mirrors eval.py's shape (student/teacher/ratio/gate_scores) so promote.py can
consume it unchanged.

Usage:
  python3 eval_cross.py --runtime <student-runtime-dir> --data <real-dataset-dir> \
      --report <out.json> [--split-seed 13] [--val-fraction 0.1] [--device-probe 1]
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np

import metrics as M

# Same off-topic probes as eval.py — the refusal-gate calibration set.
OFF_TOPIC_PROBES = [
    "who won the 2018 football world cup",
    "best recipe for chocolate cake",
    "how much does a tesla model 3 cost",
    "من فاز بكأس العالم 2018",
    "ما هي أفضل وصفة للكشري",
    "كم سعر تذكرة القطار من القاهرة إلى أسوان",
    "qui a gagné la coupe du monde 2018",
    "quelle est la meilleure recette de gâteau au chocolat",
]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runtime", required=True, help="runtime dir: onnx/model*.onnx + tokenizer.json")
    parser.add_argument("--data", required=True, help="real corpus dataset dir (passages.npz/queries.npz/dataset.jsonl)")
    parser.add_argument("--report", required=True)
    parser.add_argument("--split-seed", type=int, default=13, help="must match the train.py run that built the val split")
    parser.add_argument("--val-fraction", type=float, default=0.1)
    parser.add_argument("--eval-candidates", type=int, default=20000)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--use-int8", action="store_true", default=True, help="prefer model_int8.onnx (deployment graph)")
    return parser.parse_args(argv)


def split_rows(rows: list[dict], passage_ids: list[str], val_fraction: float, rng: random.Random) -> tuple[list[int], list[int]]:
    """Exact copy of train.py.split_rows so the held-out set matches training-time replay."""
    held_out = set(rng.sample(passage_ids, max(1, int(len(passage_ids) * val_fraction)))) if val_fraction > 0 else set()
    train, val = [], []
    for row in rows:
        if held_out and all(cid in held_out for cid in row["positives"]):
            val.append(row["index"])
        else:
            train.append(row["index"])
    if not val:
        rng.shuffle(train)
        cut = max(1, int(len(train) * val_fraction)) if val_fraction > 0 else 0
        val, train = train[:cut], train[cut:]
    return train, val


class OnnxStudent:
    """The runtime exactly as the Rust sidecar uses it: tokenizer.json -> original ids -> graph."""

    def __init__(self, runtime: Path, batch_size: int):
        import onnxruntime as ort
        from transformers import AutoTokenizer

        onnx_dir = runtime / "onnx"
        model_path = onnx_dir / ("model_int8.onnx" if (runtime / "onnx" / "model_int8.onnx").exists() else "model.onnx")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        self.session = ort.InferenceSession(str(model_path), options, providers=["CPUExecutionProvider"])
        self.tokenizer = AutoTokenizer.from_pretrained(str(runtime))
        self.batch_size = batch_size
        self.model_path = model_path

    def encode(self, texts: list[str], max_len: int = 128) -> np.ndarray:
        out: list[np.ndarray] = []
        started = time.time()
        for start in range(0, len(texts), self.batch_size):
            batch = self.tokenizer(
                texts[start : start + self.batch_size], padding=True, truncation=True,
                max_length=max_len, return_tensors="np",
            )
            vectors = self.session.run(None, {
                "input_ids": batch["input_ids"].astype(np.int64),
                "attention_mask": batch["attention_mask"].astype(np.int64),
            })[0][:, 0]
            norms = np.linalg.norm(vectors, axis=1, keepdims=True)
            out.append((vectors / np.maximum(norms, 1e-12)).astype(np.float32))
        print(f"encoded {len(texts)} queries in {time.time() - started:.1f}s ({self.model_path.name})", flush=True)
        return np.concatenate(out, axis=0)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    runtime, data_dir = Path(args.runtime), Path(args.data)

    passages = np.load(data_dir / "passages.npz", allow_pickle=False)
    queries = np.load(data_dir / "queries.npz", allow_pickle=False)
    rows = [json.loads(line) for line in (data_dir / "dataset.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    passage_ids = [str(cid) for cid in passages["ids"]]
    passage_matrix = passages["vectors"].astype(np.float32)
    all_teacher = queries["vectors"].astype(np.float32)

    _, val_rows = split_rows(rows, passage_ids, args.val_fraction, random.Random(args.split_seed))
    if not val_rows:
        print("held-out split is empty; aborting (check --split-seed/--val-fraction)")
        return 2
    selected = [rows[i] for i in val_rows]
    print(f"cross-eval on {len(selected)} held-out rows of {len(rows)} ({data_dir})", flush=True)

    student = OnnxStudent(runtime, args.batch_size)
    student_vectors = student.encode([row["query"] for row in selected])
    teacher_vectors = all_teacher[np.array(val_rows, dtype=np.int64)]

    judged: set[str] = set()
    for row in selected:
        judged.update(row["positives"])
        judged.update(row.get("negatives", []))
    rng = np.random.default_rng(7)
    rest = [cid for cid in passage_ids if cid not in judged]
    if args.eval_candidates and len(rest) > args.eval_candidates:
        rest = [rest[int(i)] for i in rng.choice(len(rest), size=args.eval_candidates, replace=False)]
    index_of = {cid: position for position, cid in enumerate(passage_ids)}
    candidate_ids = [cid for cid in sorted(judged) + rest if cid in index_of]
    matrix = passage_matrix[[index_of[cid] for cid in candidate_ids]]

    def rankings(vectors: np.ndarray) -> list[list[str]]:
        scores = vectors @ matrix.T
        return [M.rank_from_scores(row, candidate_ids, k=10) for row in scores]

    relevant = [set(row["positives"]) for row in selected]

    def slice_metrics(ranked: list[list[str]], key: str) -> dict[str, dict]:
        slices: dict[str, dict] = {}
        for value in sorted({row.get(key, "") for row in selected} - {""}):
            selection = [i for i, row in enumerate(selected) if row.get(key) == value]
            slices[value] = M.ranking_metrics([ranked[i] for i in selection], [relevant[i] for i in selection])
        return slices

    student_ranked = rankings(student_vectors)
    teacher_ranked = rankings(teacher_vectors)
    student_overall = M.ranking_metrics(student_ranked, relevant)
    teacher_overall = M.ranking_metrics(teacher_ranked, relevant)
    by_tag = slice_metrics(student_ranked, "tag")
    teacher_by_tag = slice_metrics(teacher_ranked, "tag")
    by_pair = slice_metrics(student_ranked, "lang_pair")
    teacher_by_pair = slice_metrics(teacher_ranked, "lang_pair")

    student_scores = student_vectors @ matrix.T
    teacher_scores = teacher_vectors @ matrix.T
    off_topic = student.encode(OFF_TOPIC_PROBES) @ matrix.T

    manifest = json.loads((runtime / "divee-student.json").read_text(encoding="utf-8"))
    report = {
        "teacher_repo": "BAAI/bge-m3",
        "queries": len(selected),
        "eval_split": f"cross-corpus val ({len(val_rows)} of {len(rows)} rows of {data_dir.name})",
        "runtime": {
            "dir": str(runtime),
            "graph": student.model_path.name,
            "architecture": manifest.get("architecture"),
            "parameters": manifest.get("parameters"),
        },
        "student": {"overall": student_overall, "by_tag": by_tag, "by_lang_pair": by_pair},
        "teacher": {"overall": teacher_overall, "by_tag": teacher_by_tag, "by_lang_pair": teacher_by_pair},
        "ratio": M.ratios(student_overall, teacher_overall),
        "ratio_by_tag": {tag: M.ratios(by_tag[tag], teacher_by_tag[tag]) for tag in by_tag},
        "ratio_by_lang_pair": {pair: M.ratios(by_pair[pair], teacher_by_pair[pair]) for pair in by_pair},
        "gate_scores": {
            "in_book_p5": M.percentile([float(row.max()) for row in student_scores], 5),
            "in_book_p50": M.percentile([float(row.max()) for row in student_scores], 50),
            "in_book_p95": M.percentile([float(row.max()) for row in student_scores], 95),
            "off_topic_p50": M.percentile([float(row.max()) for row in off_topic], 50),
            "off_topic_p95": M.percentile([float(row.max()) for row in off_topic], 95),
            "teacher_in_book_p5": M.percentile([float(row.max()) for row in teacher_scores], 5),
        },
        "off_topic_probes": OFF_TOPIC_PROBES,
    }
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"student": student_overall, "teacher": teacher_overall, "ratio": report["ratio"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
