"""Evaluate a trained student against BGE-M3 and produce the promotion report.

Two levels of comparison:

  * vector level (here, numpy): student vs teacher query vectors against the *stored* passage
    vectors, per tag slice, plus the gate score distributions the promotion step needs,
  * engine level (optional `--rust-bin`): the same judged queries are run through
    `divee-retrieval --eval` twice (teacher vectors, then student vectors), which measures the real
    BM25+cosine+RRF pipeline including Arabic normalisation.

Outputs `<report>` (JSON) and, with `--emit-bench DIR`, the two NDJSON benchmark files.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

import metrics as M
from divee_student import MAX_LEN, QueryStudent, StudentConfig, build_vocab_map
from teacher import encode_base64

# Deliberately unrelated to any textbook: used to calibrate "does the gate refuse?" thresholds.
OFF_TOPIC_PROBES = [
    "who won the 2018 football world cup",
    "best recipe for chocolate cake",
    "how much does a tesla model 3 cost",
    "من فاز بكأس العالم 2018",
    "ما هي أفضل وصفة للكشري",
    "كم سعر تذكرة القطار من القاهرة إلى أسوان",
]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", required=True)
    parser.add_argument("--model", required=True, help="training output directory (best.pt)")
    parser.add_argument("--report", required=True, help="where to write the JSON report")
    parser.add_argument("--teacher", default="BAAI/bge-m3", help="tokenizer source")
    parser.add_argument("--db", help="books.db (required for --rust-bin)")
    parser.add_argument("--rust-bin", help="native/retrieval/target/release/divee-retrieval")
    parser.add_argument("--emit-bench", help="directory for engine benchmark JSONL files")
    parser.add_argument("--eval-candidates", type=int, default=20000)
    parser.add_argument("--device", default=None)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args(argv)


def encode_queries(model: QueryStudent, tokenizer, texts: list[str], device, batch_size: int = 64) -> np.ndarray:
    import torch

    out: list[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(texts), batch_size):
            batch = tokenizer(texts[start : start + batch_size], padding=True, truncation=True, max_length=MAX_LEN, return_tensors="pt")
            batch = {key: value.to(device) for key, value in batch.items()}
            out.append(model.embed(batch["input_ids"], batch["attention_mask"]).float().cpu().numpy())
    return np.concatenate(out, axis=0) if out else np.zeros((0, 1024), dtype=np.float32)


def run_engine(binary: str, db: str, bench: Path) -> dict | None:
    try:
        completed = subprocess.run(
            [binary, "--db", db, "--eval", str(bench)],
            capture_output=True,
            text=True,
            check=True,
            timeout=1800,
        )
        return json.loads(completed.stdout)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        print(f"engine benchmark failed for {bench.name}: {error}", file=sys.stderr)
        return None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    import torch

    data_dir, model_dir = Path(args.data), Path(args.model)
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(args.teacher)
    config = StudentConfig(**json.loads((model_dir / "config.json").read_text(encoding="utf-8")))
    vocab = json.loads((data_dir / "vocab.json").read_text(encoding="utf-8"))
    config.vocab_size = int(vocab["size"])
    model = QueryStudent(build_vocab_map([int(token_id) for token_id in vocab["ids"]], int(vocab["original_vocab"])), config)
    model.load_state_dict(torch.load(model_dir / "best.pt", map_location="cpu", weights_only=True)["state_dict"])
    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))
    model.to(device).eval()

    passages = np.load(data_dir / "passages.npz", allow_pickle=False)
    queries = np.load(data_dir / "queries.npz", allow_pickle=False)
    rows = [json.loads(line) for line in (data_dir / "dataset.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    passage_ids = [str(cid) for cid in passages["ids"]]
    passage_matrix = passages["vectors"].astype(np.float32)
    index_of = {cid: position for position, cid in enumerate(passage_ids)}

    texts = [row["query"] for row in rows]
    student_vectors = encode_queries(model, tokenizer, texts, device)
    teacher_vectors = queries["vectors"].astype(np.float32)

    # ---- candidate set: judged chunks plus a random sample of the library
    judged: set[str] = set()
    for row in rows:
        judged.update(row["positives"])
        judged.update(row.get("negatives", []))
    rng = np.random.default_rng(args.seed)
    rest = [cid for cid in passage_ids if cid not in judged]
    if args.eval_candidates and len(rest) > args.eval_candidates:
        rest = [rest[int(i)] for i in rng.choice(len(rest), size=args.eval_candidates, replace=False)]
    candidate_ids = [cid for cid in sorted(judged) + rest if cid in index_of]
    matrix = passage_matrix[[index_of[cid] for cid in candidate_ids]]

    def rankings(vectors: np.ndarray) -> list[list[str]]:
        scores = vectors @ matrix.T
        return [M.rank_from_scores(row, candidate_ids, k=10) for row in scores]

    relevant = [set(row["positives"]) for row in rows]
    student_ranked, teacher_ranked = rankings(student_vectors), rankings(teacher_vectors)

    by_tag: dict[str, dict] = {}
    for tag in sorted({row["tag"] for row in rows}):
        selection = [index for index, row in enumerate(rows) if row["tag"] == tag]
        by_tag[tag] = M.ranking_metrics([student_ranked[i] for i in selection], [relevant[i] for i in selection])
    by_lang_pair: dict[str, dict] = {}
    for pair in sorted({row.get("lang_pair", "") for row in rows} - {""}):
        selection = [index for index, row in enumerate(rows) if row.get("lang_pair") == pair]
        by_lang_pair[pair] = M.ranking_metrics([student_ranked[i] for i in selection], [relevant[i] for i in selection])

    student_overall = M.ranking_metrics(student_ranked, relevant)
    teacher_overall = M.ranking_metrics(teacher_ranked, relevant)

    # ---- gate score distributions
    teacher_scores = teacher_vectors @ matrix.T
    student_scores = student_vectors @ matrix.T
    off_topic_student = encode_queries(model, tokenizer, OFF_TOPIC_PROBES, device) @ matrix.T

    report = {
        "teacher_repo": args.teacher,
        "queries": len(rows),
        "student": {"overall": student_overall, "by_tag": by_tag, "by_lang_pair": by_lang_pair},
        "teacher": {"overall": teacher_overall},
        "ratio": M.ratios(student_overall, teacher_overall),
        "ratio_by_tag": {tag: M.ratios(values, by_tag[tag]) for tag, values in by_tag.items()},
        "ratio_by_lang_pair": {pair: M.ratios(values, by_lang_pair[pair]) for pair, values in by_lang_pair.items()},
        "gate_scores": {
            "in_book_p5": M.percentile([float(row.max()) for row in student_scores], 5),
            "in_book_p50": M.percentile([float(row.max()) for row in student_scores], 50),
            "in_book_p95": M.percentile([float(row.max()) for row in student_scores], 95),
            "off_topic_p50": M.percentile([float(row.max()) for row in off_topic_student], 50),
            "off_topic_p95": M.percentile([float(row.max()) for row in off_topic_student], 95),
            "teacher_in_book_p5": M.percentile([float(row.max()) for row in teacher_scores], 5),
        },
        "off_topic_probes": OFF_TOPIC_PROBES,
        "config": config.to_dict(),
    }

    # ---- optional engine-level benchmark
    if args.emit_bench or args.rust_bin:
        bench_dir = Path(args.emit_bench or (model_dir / "bench"))
        bench_dir.mkdir(parents=True, exist_ok=True)
        for name, vectors in (("teacher", teacher_vectors), ("student", student_vectors)):
            path = bench_dir / f"bench-{name}.jsonl"
            with open(path, "w", encoding="utf-8") as handle:
                for row, vector in zip(rows, vectors):
                    handle.write(
                        json.dumps(
                            {
                                "query": row["query"],
                                "vector_base64": encode_base64(vector),
                                "relevant": row["positives"],
                                "tag": row["tag"],
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
            if args.rust_bin:
                if not args.db:
                    print("--rust-bin also needs --db", file=sys.stderr)
                    return 2
                report.setdefault("engine", {})[name] = run_engine(args.rust_bin, args.db, path)

    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"student": student_overall, "teacher": teacher_overall, "ratio": report["ratio"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
