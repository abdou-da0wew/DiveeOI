"""Distil a compact Arabic+English query encoder from BGE-M3.

The loss is the important part (RETRIEVAL_V2_PLAN.md §6): imitating the teacher vector alone does
not optimise ranking, so each step combines

  1. cosine imitation of the teacher query vector,
  2. InfoNCE over teacher passage vectors (positives + mined hard negatives + in-batch positives),
  3. KL between the teacher's and the student's similarity distributions.

Validation reports retrieval metrics against the **stored** passage vectors — the same numbers
chat would see — for both the student and the teacher, plus their ratio (the promotion gates).

Example:
  python train.py --data data/ --out models/student/ --epochs 6 --hidden 512 --layers 6
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import numpy as np

import metrics as M
from divee_student import (
    MAX_LEN,
    QueryStudent,
    StudentConfig,
    build_vocab_map,
    distill_loss,
    parameter_counts,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--teacher", default="BAAI/bge-m3", help="tokenizer source (must match the index)")
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=0, help="0 = auto (128 on CUDA, 32 on CPU)")
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--warmup", type=float, default=0.05)
    parser.add_argument("--temperature", type=float, default=0.05)
    parser.add_argument("--w-cos", type=float, default=1.0)
    parser.add_argument("--w-nce", type=float, default=1.0)
    parser.add_argument("--w-kl", type=float, default=0.5)
    parser.add_argument("--hidden", type=int, default=512)
    parser.add_argument("--layers", type=int, default=6)
    parser.add_argument("--heads", type=int, default=8)
    parser.add_argument("--ffn", type=int, default=2048)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--val-fraction", type=float, default=0.1)
    parser.add_argument("--eval-candidates", type=int, default=20000)
    parser.add_argument("--device", default=None, help="auto|cuda|cpu (default: CUDA when available, e.g. inside Colab)")
    parser.add_argument("--precision", choices=["auto", "fp32", "fp16", "bf16"], default="auto", help="autocast dtype on CUDA; auto = bf16 on Ampere+, fp16 on T4, fp32 on CPU")
    parser.add_argument("--bf16", action="store_true", help="deprecated alias for --precision bf16")
    parser.add_argument("--num-threads", type=int, default=0, help="torch CPU threads (0 = default)")
    parser.add_argument("--seed", type=int, default=13)
    parser.add_argument("--limit-queries", type=int, default=0)
    parser.add_argument("--init", default=None, help="initialize weights from a best.pt checkpoint (resume distillation)")
    return parser.parse_args(argv)


def load_dataset(data_dir: Path) -> dict:
    import torch
    from transformers import AutoTokenizer

    passages = np.load(data_dir / "passages.npz", allow_pickle=False)
    queries = np.load(data_dir / "queries.npz", allow_pickle=False)
    vocab = json.loads((data_dir / "vocab.json").read_text(encoding="utf-8"))
    rows = [json.loads(line) for line in (data_dir / "dataset.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    return {
        "torch": torch,
        "AutoTokenizer": AutoTokenizer,
        "passage_ids": [str(cid) for cid in passages["ids"]],
        "passage_matrix": passages["vectors"].astype(np.float32),
        "query_vectors": queries["vectors"].astype(np.float32),
        "vocab": vocab,
        "rows": rows,
    }


def split_rows(rows: list[dict], passage_ids: list[str], val_fraction: float, rng: random.Random) -> tuple[list[int], list[int]]:
    held_out = set(rng.sample(passage_ids, max(1, int(len(passage_ids) * val_fraction)))) if val_fraction > 0 else set()
    train, val = [], []
    for row in rows:
        if held_out and all(cid in held_out for cid in row["positives"]):
            val.append(row["index"])
        else:
            train.append(row["index"])
    if not val:  # tiny libraries: fall back to a query split
        rng.shuffle(train)
        cut = max(1, int(len(train) * val_fraction)) if val_fraction > 0 else 0
        val, train = train[:cut], train[cut:]
    return train, val


def build_candidates(row_indexes: list[int], rows: list[dict], passage_index: dict[str, int]) -> tuple[list[str], np.ndarray, np.ndarray]:
    candidate_ids: list[str] = []
    seen: set[str] = set()
    for index in row_indexes:
        row = rows[index]
        for chunk_id in row["positives"] + row.get("negatives", []):
            if chunk_id in passage_index and chunk_id not in seen:
                seen.add(chunk_id)
                candidate_ids.append(chunk_id)
    positions = {chunk_id: position for position, chunk_id in enumerate(candidate_ids)}
    positive_index = np.array([positions[rows[index]["positives"][0]] for index in row_indexes], dtype=np.int64)
    return candidate_ids, np.array([passage_index[cid] for cid in candidate_ids], dtype=np.int64), positive_index


def encode_queries(model: QueryStudent, tokenizer, texts: list[str], device, batch_size: int = 64) -> np.ndarray:
    import torch

    out: list[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(texts), batch_size):
            batch = tokenizer(
                texts[start : start + batch_size],
                padding=True,
                truncation=True,
                max_length=MAX_LEN,
                return_tensors="pt",
            )
            batch = {key: value.to(device) for key, value in batch.items()}
            out.append(model.embed(batch["input_ids"], batch["attention_mask"]).float().cpu().numpy())
    return np.concatenate(out, axis=0) if out else np.zeros((0, 1024), dtype=np.float32)


def evaluate(
    model: QueryStudent,
    tokenizer,
    rows: list[dict],
    val_indexes: list[int],
    passage_ids: list[str],
    passage_matrix: np.ndarray,
    query_vectors: np.ndarray,
    device,
    eval_candidates: int,
    rng: np.random.Generator,
) -> dict:
    if not val_indexes:
        return {"overall": M.ranking_metrics([], []), "by_tag": {}, "teacher": {"overall": M.ranking_metrics([], [])}}

    needed: set[str] = set()
    for index in val_indexes:
        needed.update(rows[index]["positives"])
        needed.update(rows[index].get("negatives", []))
    sample = [cid for cid in passage_ids if cid not in needed]
    if eval_candidates and len(sample) > eval_candidates:
        sample = [sample[int(i)] for i in rng.choice(len(sample), size=eval_candidates, replace=False)]
    index_of = {cid: position for position, cid in enumerate(passage_ids)}
    candidate_ids = [cid for cid in sorted(needed) + sample if cid in index_of]
    if not candidate_ids:
        return {"overall": M.ranking_metrics([], []), "by_tag": {}, "teacher": {"overall": M.ranking_metrics([], [])}}
    matrix = passage_matrix[[index_of[cid] for cid in candidate_ids]]

    texts = [rows[index]["query"] for index in val_indexes]
    student_vectors = encode_queries(model, tokenizer, texts, device)
    teacher_vectors = query_vectors[val_indexes]

    def rank(vectors: np.ndarray) -> list[list[str]]:
        scores = vectors @ matrix.T
        return [M.rank_from_scores(row, candidate_ids, k=10) for row in scores]

    relevant = [set(rows[index]["positives"]) for index in val_indexes]
    tags = [rows[index]["tag"] for index in val_indexes]
    pairs = [rows[index].get("lang_pair", "") for index in val_indexes]

    student_ranked, teacher_ranked = rank(student_vectors), rank(teacher_vectors)
    by_tag: dict[str, dict] = {}
    for tag in sorted(set(tags) | set(pairs)):
        if not tag:
            continue
        selection = [position for position, value in enumerate(tags) if value == tag] or [
            position for position, value in enumerate(pairs) if value == tag
        ]
        if not selection:
            continue
        by_tag[tag] = M.ranking_metrics(
            [student_ranked[position] for position in selection], [relevant[position] for position in selection]
        )

    # Gate calibration inputs: best dense score for answerable vs unanswerable queries.
    student_scores = student_vectors @ matrix.T
    teacher_scores = teacher_vectors @ matrix.T
    in_book = [float(row.max()) for row in student_scores]
    teacher_in_book = [float(row.max()) for row in teacher_scores]

    return {
        "overall": M.ranking_metrics(student_ranked, relevant),
        "by_tag": by_tag,
        "teacher": {"overall": M.ranking_metrics(teacher_ranked, relevant)},
        "gate_scores": {
            "in_book_p5": M.percentile(in_book, 5),
            "in_book_p50": M.percentile(in_book, 50),
            "teacher_in_book_p5": M.percentile(teacher_in_book, 5),
            "teacher_in_book_p50": M.percentile(teacher_in_book, 50),
        },
    }


def detect_colab() -> str | None:
    """Return the assigned GPU name when running inside Google Colab, else None."""
    import os

    if not os.environ.get("COLAB_GPU") and not os.path.isdir("/content"):
        return None
    gpu = os.environ.get("COLAB_GPU") or ""
    if not gpu:
        try:
            import subprocess as _sp

            probe = _sp.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=10,
            )
            gpu = probe.stdout.strip().splitlines()[0] if probe.returncode == 0 and probe.stdout.strip() else "gpu"
        except Exception:
            gpu = "gpu"
    return gpu


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    import torch

    device_choice = (args.device or "auto").lower()
    if device_choice == "auto":
        device_choice = "cuda" if torch.cuda.is_available() else "cpu"
    if device_choice == "cuda" and not torch.cuda.is_available():
        print("--device cuda requested but CUDA is unavailable; falling back to cpu", flush=True)
        device_choice = "cpu"
    device = torch.device(device_choice)

    colab_gpu = detect_colab()
    if colab_gpu and device.type == "cuda":
        print(f"colab detected: training on {colab_gpu} (GPU-accelerated mode)", flush=True)
    elif colab_gpu:
        print(f"colab detected ({colab_gpu}) but CUDA is unavailable; running on CPU", flush=True)

    if device.type == "cpu":
        if args.num_threads > 0:
            torch.set_num_threads(args.num_threads)
    else:
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    rng_np = np.random.default_rng(args.seed)
    rng_py = random.Random(args.seed)

    # Resolve precision: auto picks bf16 on Ampere+ GPUs, fp16 on pre-Ampere (T4), fp32 on CPU.
    if args.bf16 and args.precision == "auto":
        precision = "bf16"
    elif args.precision != "auto":
        precision = args.precision
    elif device.type == "cuda":
        major, _minor = torch.cuda.get_device_capability(device)
        precision = "bf16" if major >= 8 else "fp16"
    else:
        precision = "fp32"

    # Resolve batch size: 0 = auto (128 on GPU, 32 on CPU — keeps CPU runs reproducible).
    if args.batch_size > 0:
        batch_size = args.batch_size
    else:
        batch_size = 128 if device.type == "cuda" else 32
        print(f"batch-size auto -> {batch_size} ({device.type})", flush=True)
    args.batch_size = batch_size

    if precision != "fp32" and device.type != "cuda":
        print(f"note: --precision {precision} needs CUDA; running in fp32 on {device.type}", flush=True)
        precision = "fp32"

    data = load_dataset(Path(args.data))
    tokenizer = data["AutoTokenizer"].from_pretrained(args.teacher)
    vocab = data["vocab"]
    passage_ids, passage_matrix, query_vectors, rows = (
        data["passage_ids"],
        data["passage_matrix"],
        data["query_vectors"],
        data["rows"],
    )
    if args.limit_queries:
        rows = rows[: args.limit_queries]

    config = StudentConfig(
        hidden=args.hidden,
        layers=args.layers,
        heads=args.heads,
        ffn=args.ffn,
        dropout=args.dropout,
        max_len=MAX_LEN,
        vocab_size=int(vocab["size"]),
    )
    vocab_map = build_vocab_map([int(token_id) for token_id in vocab["ids"]], int(vocab["original_vocab"]))
    model = QueryStudent(vocab_map, config).to(device)
    if args.init:
        _state = torch.load(args.init, map_location="cpu")
        model.load_state_dict(_state["state_dict"] if "state_dict" in _state else _state)
        print(f"initialized weights from {args.init}")
    counts = parameter_counts(model)
    print(f"student parameters: {counts['total'] / 1e6:.1f}M (embedding {counts['embedding'] / 1e6:.1f}M) vocab={config.vocab_size}")

    trainable = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=args.lr, weight_decay=args.weight_decay)
    train_indexes, val_indexes = split_rows(rows, passage_ids, args.val_fraction, rng_py)
    if not train_indexes:
        print("no training queries", flush=True)
        return 2
    steps_per_epoch = math.ceil(len(train_indexes) / batch_size)
    total_steps = max(1, steps_per_epoch * args.epochs)
    warmup_steps = int(total_steps * args.warmup)

    def lr_lambda(step: int) -> float:
        if step < warmup_steps:
            return (step + 1) / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return 0.5 * (1.0 + math.cos(math.pi * progress))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)
    passage_index = {cid: position for position, cid in enumerate(passage_ids)}
    amp_dtype = {"fp16": torch.float16, "bf16": torch.bfloat16}.get(precision)
    amp_enabled = bool(amp_dtype is not None and device.type == "cuda")
    scaler = torch.amp.GradScaler("cuda", enabled=bool(amp_enabled and precision == "fp16"))
    print(f"device: {device} precision: {precision if amp_enabled else 'fp32'} batch: {batch_size}", flush=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    best = {"score": -1.0, "report": None, "epoch": 0}
    history: list[dict] = []
    step = 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        rng_py.shuffle(train_indexes)
        started = time.time()
        running = {"loss": 0.0, "cos": 0.0, "nce": 0.0, "kl": 0.0, "batches": 0}
        for start in range(0, len(train_indexes), batch_size):
            batch_indexes = train_indexes[start : start + batch_size]
            if len(batch_indexes) < 2:
                continue
            candidate_ids, candidate_rows, positive_index = build_candidates(batch_indexes, rows, passage_index)
            if len(candidate_ids) < 2:
                continue
            encoded = tokenizer(
                [rows[index]["query"] for index in batch_indexes],
                padding=True,
                truncation=True,
                max_length=MAX_LEN,
                return_tensors="pt",
            )
            input_ids = encoded["input_ids"].to(device)
            attention = encoded["attention_mask"].to(device)
            teacher_q = torch.from_numpy(query_vectors[batch_indexes]).to(device)
            candidates = torch.from_numpy(passage_matrix[candidate_rows]).to(device)
            positive_ids = torch.tensor([passage_index[rows[index]["positives"][0]] for index in batch_indexes], dtype=torch.int64, device=device)
            candidate_codes = torch.tensor(candidate_rows, dtype=torch.int64, device=device)

            with torch.autocast(device_type=device.type, enabled=amp_enabled, dtype=amp_dtype or torch.float32):
                student_q = model.embed(input_ids, attention)
                loss, parts = distill_loss(
                    student_q,
                    teacher_q,
                    candidates,
                    torch.from_numpy(positive_index).to(device),
                    candidate_codes,
                    positive_ids,
                    temperature=args.temperature,
                    w_cos=args.w_cos,
                    w_nce=args.w_nce,
                    w_kl=args.w_kl,
                )
            optimizer.zero_grad(set_to_none=True)
            if scaler.is_enabled():
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(trainable, 1.0)
                scaler.step(optimizer)
                scaler.update()
            else:
                loss.backward()
                torch.nn.utils.clip_grad_norm_(trainable, 1.0)
                optimizer.step()
            scheduler.step()
            step += 1
            running["loss"] += float(loss)
            running["cos"] += parts["cos"]
            running["nce"] += parts["nce"]
            running["kl"] += parts["kl"]
            running["batches"] += 1

        train_summary = {key: (value / max(1, running["batches"])) for key, value in running.items() if key != "batches"}
        report = evaluate(
            model,
            tokenizer,
            rows,
            val_indexes,
            passage_ids,
            passage_matrix,
            query_vectors,
            device,
            args.eval_candidates,
            rng_np,
        )
        report_ratios = M.ratios(report["overall"], report["teacher"]["overall"])
        epoch_row = {
            "epoch": epoch,
            "seconds": round(time.time() - started, 1),
            "train": train_summary,
            "val": report["overall"],
            "teacher": report["teacher"]["overall"],
            "ratio": report_ratios,
        }
        history.append(epoch_row)
        print(json.dumps(epoch_row), flush=True)

        score = report["overall"]["ndcg_at_10"]
        if score > best["score"]:
            best = {"score": score, "report": report, "epoch": epoch}
            torch.save({"state_dict": model.state_dict(), "config": config.to_dict()}, out / "best.pt")
            (out / "config.json").write_text(json.dumps(config.to_dict(), indent=2), encoding="utf-8")
            (out / "eval-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    (out / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(json.dumps({"best_epoch": best["epoch"], "best_ndcg_at_10": best["score"], "checkpoint": str(out / "best.pt")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
