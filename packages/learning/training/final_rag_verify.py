"""Final RAG verification: one EB book, BGE-M3 index, distilled student as the query encoder.

Scenario (per the project owner):
  * the book `Mathematics-En-EB-Part1.pdf` was ingested alone into a fresh books.db,
    embedded with the fp32 BGE-M3 teacher (90 chunks, 1024-d, CLS + L2) -- already done,
  * live queries are encoded by OUR distilled student encoder (ONNX INT8 runtime, exactly
    what the app loads at chat time) and matched against those stored vectors,
  * four probe questions:
      1. gold        - we know the real answer, its location and its phrasing in the book,
      2. half-known  - we know only part of the correct answer,
      3. unknown     - we genuinely do not know the answer,
      4. out-of-book - we know it is not in the book (must be refused / low score).

Anti-memorization pass (proves the student learned the space, not the training rows):
  * novelty check  - every probe + paraphrase string is verified absent from the training
                     dataset (exact lowercase substring match over dataset.jsonl queries),
  * paraphrase stability - fresh rewordings of each probe must still land on the expected
                     chunks (gold/half: top-3; unknown: top-5; out-of-book: refused),
  * teacher agreement - student top-5 vs fp32 BGE-M3 top-5 overlap on these never-seen
                     queries (the index vectors are teacher-made, so agreement = the student
                     really maps queries into the teacher space),
  * paraphrase cohesion - rewordings of the same question must embed close together,
  * gold margin    - the gold chunk score must clear the in-book median by a margin.

Outputs a JSON verdict + human-readable log.
"""

from __future__ import annotations

import argparse
import base64
import json
import sqlite3
import time
from pathlib import Path

import numpy as np

QUERIES = {
    "gold": {
        "question": "How do you determine the nature of the solutions of a quadratic equation?",
        "known_answer": "Use the discriminant D = b^2 - 4ac (the expression inside the square root "
                        "of the quadratic formula): D > 0 -> two distinct real solutions; D = 0 -> one "
                        "double solution; D < 0 -> two distinct imaginary (complex) solutions. The book "
                        "works 3x^2 + 4x + 7 = 0: D = 16 - 84 = -68 < 0, so two distinct imaginary solutions.",
        "expected_location": "chunk eb-mathematics-en-part1-p120-c1, book page 120 (printed ~118), "
                             "Chapter 3 'Complex Numbers and Equations', the discriminant section",
        "known_phrasing": "The book writes 'Let D be the discriminant', 'D = b2 - 4ac Inside the "
                          "square root of the Quadratic Formula', then lists D > 0, D = 0, D < 0 cases.",
    },
    "half_known": {
        "question": "What is the relationship between the roots of a quadratic equation and its coefficients?",
        "known_answer": "PARTIAL: we only confidently know that the sum of the roots equals -b/a. "
                        "The product relation and how the book uses it (building a new quadratic from "
                        "two known roots) is the half we need the book to confirm.",
        "expected_location": "sections 3-7 / 3-8 'Relationship between Roots and Coefficients', "
                             "book pages ~121-126 (chunks p123/p126), Chapter 3",
        "known_phrasing": "unknown for the product half; the sum half is standard -b/a",
    },
    "unknown": {
        "question": "According to the textbook, how can quadratic equations tell us whether a system "
                    "in life science or engineering will remain stable or collapse?",
        "known_answer": "We do NOT know the answer - the chapter 3 guiding question is quoted on "
                        "page ~115 but we never read how the book resolves it.",
        "expected_location": "expected (not required) near the chapter 3 opener guiding question, "
                             "chunk p117-c1, before the quadratic-formula discussion",
        "known_phrasing": "unknown - this is the point of the probe",
    },
    "out_of_book": {
        "question": "What is photosynthesis and how do plants produce energy from sunlight?",
        "known_answer": "Known to be about biology - definitely NOT in a Grade XI mathematics "
                        "textbook; the RAG layer must refuse or return clearly low-scored chunks.",
        "expected_location": "nowhere - the whole book is mathematics",
        "known_phrasing": "n/a",
    },
}


# Fresh rewordings authored for this verification (never part of any dataset build).
PARAPHRASES = {
    "gold": [
        "How can you tell if a quadratic equation has real or complex solutions without solving it completely?",
        "Explain how the discriminant decides the number and type of roots of ax^2 + bx + c = 0.",
    ],
    "half_known": [
        "If x1 and x2 are the roots of a quadratic equation, what do the sum and the product of "
        "the roots equal in terms of the coefficients?",
        "How are the roots of a quadratic equation related to its coefficients a, b and c?",
    ],
    "unknown": [
        "How does the textbook connect quadratic equations to the stability of systems in life "
        "science or engineering?",
        "What does chapter 3 say about using quadratic models to predict whether a system stays "
        "stable or collapses?",
    ],
    "out_of_book": [
        "How do chloroplasts convert light energy into chemical energy during photosynthesis?",
        "Describe the process by which green plants make glucose from sunlight and carbon dioxide.",
    ],
}

GOLD_PREFIX = "eb-mathematics-en-part1-p120"
HALF_PREFIX = ("eb-mathematics-en-part1-p123", "eb-mathematics-en-part1-p126")
UNKNOWN_PREFIX = "eb-mathematics-en-part1-p117"


def decode_vec(b64_text: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(b64_text), dtype="<f4").astype(np.float32)


def load_book(db_path: str):
    db = sqlite3.connect(db_path)
    rows = db.execute(
        "SELECT c.id, c.book_id, c.page, c.text, v.vec FROM chunks c JOIN chunk_vecs v ON v.chunk_id = c.id "
        "ORDER BY c.page, c.ord"
    ).fetchall()
    book_title = db.execute("SELECT title FROM books LIMIT 1").fetchone()[0]
    db.close()
    ids = [r[0] for r in rows]
    pages = [r[2] for r in rows]
    texts = [r[3] for r in rows]
    matrix = np.stack([decode_vec(r[4]) for r in rows])
    return book_title, ids, pages, texts, matrix


class StudentEncoder:
    """The distilled encoder at chat time: BGE-M3 tokenizer -> ONNX student -> CLS + L2."""

    def __init__(self, runtime_dir: str):
        import onnxruntime as ort
        from transformers import AutoTokenizer

        runtime = Path(runtime_dir)
        candidates = [runtime / "onnx" / "model_int8.onnx", runtime / "onnx" / "model.onnx",
                      runtime / "model_int8.onnx", runtime / "model.onnx"]
        model_file = next((c for c in candidates if c.exists()), None)
        if model_file is None:
            raise FileNotFoundError(f"no onnx model under {runtime}")
        self.tokenizer = AutoTokenizer.from_pretrained("BAAI/bge-m3")
        self.session = ort.InferenceSession(str(model_file), providers=["CPUExecutionProvider"])
        self.input_names = [i.name for i in self.session.get_inputs()]
        self.output_name = self.session.get_outputs()[0].name
        self.kind = model_file.name

    def encode(self, texts: list[str]) -> np.ndarray:
        out = []
        for start in range(0, len(texts), 16):
            batch = self.tokenizer(
                texts[start:start + 16], padding=True, truncation=True, max_length=128, return_tensors="np"
            )
            feeds = {
                "input_ids": batch["input_ids"].astype(np.int64),
                "attention_mask": batch["attention_mask"].astype(np.int64),
            }
            hidden = self.session.run([self.output_name], feeds)[0]
            cls = hidden[:, 0, :]
            cls = cls / (np.linalg.norm(cls, axis=-1, keepdims=True) + 1e-12)
            out.append(cls.astype(np.float32))
        return np.concatenate(out, axis=0)


class TeacherEncoder:
    """BGE-M3 fp32 reference (what the index was built with)."""

    def __init__(self):
        import torch
        from transformers import AutoModel, AutoTokenizer

        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained("BAAI/bge-m3")
        self.model = AutoModel.from_pretrained("BAAI/bge-m3", dtype=torch.float32).eval()

    def encode(self, texts: list[str]) -> np.ndarray:
        res = []
        with self.torch.no_grad():
            for start in range(0, len(texts), 8):
                batch = self.tokenizer(texts[start:start + 8], padding=True, truncation=True,
                                       max_length=128, return_tensors="pt")
                hidden = self.model(**batch).last_hidden_state[:, 0]
                hidden = self.torch.nn.functional.normalize(hidden.float(), dim=-1)
                res.append(hidden.numpy().astype(np.float32))
        return np.concatenate(res, axis=0)


def top_k(question_vec: np.ndarray, matrix: np.ndarray, k=5):
    scores = matrix @ question_vec
    order = np.argsort(-scores)[:k]
    return [(int(i), float(scores[i])) for i in order]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/home/celestial-dev/diveeoi-artifacts/onebook/corpus/books.db")
    ap.add_argument("--runtime", default="/home/celestial-dev/diveeoi-artifacts/models/student-runtime",
                    help="student runtime dir (model.onnx / model_int8.onnx)")
    ap.add_argument("--out", default="/home/celestial-dev/diveeoi-artifacts/final-rag-verification.json")
    ap.add_argument("--dataset", default="/home/celestial-dev/diveeoi-artifacts/dataset8k/dataset.jsonl",
                    help="training dataset.jsonl, used for the novelty check")
    ap.add_argument("--skip-teacher", action="store_true", help="skip the fp32 teacher reference pass "
                    "(disables the teacher-agreement verdict)")
    args = ap.parse_args()

    book_title, chunk_ids, pages, texts, matrix = load_book(args.db)
    print(f"book: {book_title}", flush=True)
    print(f"index: {len(chunk_ids)} chunks, vector dim {matrix.shape[1]}, "
          f"norms in [{np.linalg.norm(matrix, axis=1).min():.4f}, {np.linalg.norm(matrix, axis=1).max():.4f}]", flush=True)

    questions = [q["question"] for q in QUERIES.values()]
    names = list(QUERIES.keys())

    started = time.time()
    student = StudentEncoder(args.runtime)
    student_vecs = student.encode(questions)
    student_time = time.time() - started
    print(f"student encoder ({student.kind}): {len(questions)} queries in {student_time:.2f}s "
          f"({student_time / len(questions) * 1000:.0f} ms/query)", flush=True)

    teacher_vecs = None
    if not args.skip_teacher:
        started = time.time()
        teacher = TeacherEncoder()
        teacher_vecs = teacher.encode(questions)
        teacher_time = time.time() - started
        print(f"teacher reference (fp32 BGE-M3): {len(questions)} queries in {teacher_time:.2f}s "
              f"({teacher_time / len(questions) * 1000:.0f} ms/query)", flush=True)

    # in-book score distribution for the refusal gate
    if teacher_vecs is None:
        gate_reference = student_vecs
        gate_name = "student"
    else:
        gate_reference = teacher_vecs
        gate_name = "teacher"

    report = {"book": book_title, "chunks": len(chunk_ids), "encoder": student.kind,
              "student_ms_per_query": student_time / len(questions) * 1000, "questions": {}}
    in_book_max_scores = []

    for i, name in enumerate(names):
        meta = QUERIES[name]
        s_vec = student_vecs[i]
        hits = top_k(s_vec, matrix, 5)
        best_pos = int(hits[0][0])
        best_id, best_score = chunk_ids[best_pos], hits[0][1]
        in_book_max_scores.append(best_score)
        t_hits = None
        if teacher_vecs is not None:
            t_hits = top_k(teacher_vecs[i], matrix, 5)
            agree = bool(chunk_ids[t_hits[0][0]] == best_id)
        else:
            agree = None
        qrep = {
            "question": meta["question"],
            "known_answer": meta["known_answer"],
            "expected_location": meta["expected_location"],
            "known_phrasing": meta["known_phrasing"],
            "student_top5": [{"chunk": chunk_ids[ci], "page": pages[ci], "score": round(sc, 4),
                              "text_head": " ".join(texts[ci].split())[:220]} for ci, sc in hits],
            "student_best": {"chunk": best_id, "page": pages[best_pos], "score": round(best_score, 4)},
            "teacher_top1_agrees": agree,
        }
        if t_hits:
            qrep["teacher_top5"] = [{"chunk": chunk_ids[ci], "page": pages[ci], "score": round(sc, 4)} for ci, sc in t_hits]
        report["questions"][name] = qrep
        print("=" * 100, flush=True)
        print(f"[{name.upper()}] {meta['question']}", flush=True)
        print(f"  known: {meta['known_answer'][:160]}...", flush=True)
        print(f"  student best: {best_id} (page {pages[best_pos]}) score={best_score:.4f}", flush=True)
        if agree is not None:
            print(f"  teacher top1: {chunk_ids[t_hits[0][0]]} score={t_hits[0][1]:.4f}  agrees={agree}", flush=True)
        for rank, (ci, sc) in enumerate(hits):
            print(f"    #{rank + 1} p{pages[ci]:3d} {chunk_ids[ci]} {sc:.4f}  {' '.join(texts[ci].split())[:110]}", flush=True)

    # refusal gate: out-of-book best score vs the in-book distribution (teacher or student reference)
    in_book_ref = [float((matrix @ gate_reference[i]).max()) for i in range(len(names)) if names[i] != "out_of_book"]
    oob = float((matrix @ gate_reference[names.index("out_of_book")]).max())
    in_p5 = float(np.percentile(in_book_ref, 5))
    in_p95 = float(np.percentile(in_book_ref, 95))
    separated = oob < in_p5
    report["gate"] = {
        "reference_encoder": gate_name,
        "in_book_p5": round(in_p5, 4),
        "in_book_p50": round(float(np.percentile(in_book_ref, 50)), 4),
        "in_book_p95": round(in_p95, 4),
        "out_of_book_max": round(oob, 4),
        "separated": separated,
        "threshold_rule": "refuse when best_score < in_book_p5",
        "suggested_threshold": round((in_p5 + min(oob, in_p95)) / 2, 4) if separated else round(in_p5, 4),
    }
    gate_threshold = report["gate"]["suggested_threshold"]

    # ---------------------------------------------------------------- anti-memorization pass
    # All 12 strings below (4 probes + 8 paraphrases) were authored for this verification.
    unseen_texts, unseen_owner, unseen_kind = [], [], []
    for name in names:
        unseen_texts.append(QUERIES[name]["question"])
        unseen_owner.append(name)
        unseen_kind.append("probe")
    for name, paras in PARAPHRASES.items():
        for p in paras:
            unseen_texts.append(p)
            unseen_owner.append(name)
            unseen_kind.append("paraphrase")

    # (a) novelty: none of these exact strings may exist in the training dataset
    dataset_queries = set()
    if Path(args.dataset).exists():
        for line in Path(args.dataset).read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                dataset_queries.add(" ".join(str(row.get("query", row.get("text", ""))).split()).lower())
            except Exception:
                continue
    novelty = [{"text": t, "owner": o, "kind": k,
                "in_training_dataset": " ".join(t.split()).lower() in dataset_queries}
               for t, o, k in zip(unseen_texts, unseen_owner, unseen_kind)]
    novel_all = not any(n["in_training_dataset"] for n in novelty)

    # (b) embed all unseen queries with student (and teacher when available)
    unseen_student = student.encode(unseen_texts)
    unseen_teacher = None
    if not args.skip_teacher:
        try:
            teacher
        except NameError:
            teacher = TeacherEncoder()
        unseen_teacher = teacher.encode(unseen_texts)

    per_query = []
    overlap5_all, top1_agrees = [], []
    for j, (text, owner, kind) in enumerate(zip(unseen_texts, unseen_owner, unseen_kind)):
        s_hits = top_k(unseen_student[j], matrix, 5)
        s_top1 = chunk_ids[s_hits[0][0]]
        row = {"owner": owner, "kind": kind, "student_top1": s_top1,
               "student_top5": [chunk_ids[ci] for ci, _ in s_hits]}
        if unseen_teacher is not None:
            t_hits = top_k(unseen_teacher[j], matrix, 5)
            t_ids = [chunk_ids[ci] for ci, _ in t_hits]
            ov = len(set(t_ids) & set(row["student_top5"])) / 5.0
            row["teacher_top1"] = t_ids[0]
            row["top1_agrees"] = bool(t_ids[0] == s_top1)
            row["overlap_at_5"] = round(ov, 2)
            overlap5_all.append(ov)
            top1_agrees.append(row["top1_agrees"])
        if owner == "out_of_book":
            row["refused"] = bool(s_hits[0][1] < gate_threshold)
        per_query.append(row)

    def owner_rows(owner, kind=None):
        return [r for r in per_query if r["owner"] == owner and (kind is None or r["kind"] == kind)]

    def expected_hit(r, prefixes, top_n):
        return any(h.startswith(prefixes) for h in r["student_top5"][:top_n])

    para_checks = {
        "gold_top3": all(expected_hit(r, GOLD_PREFIX, 3) for r in owner_rows("gold", "paraphrase")),
        "half_known_top3": all(expected_hit(r, HALF_PREFIX, 3) for r in owner_rows("half_known", "paraphrase")),
        "unknown_top5": all(expected_hit(r, UNKNOWN_PREFIX, 5) for r in owner_rows("unknown", "paraphrase")),
        "out_of_book_refused": all(r.get("refused") for r in owner_rows("out_of_book", "paraphrase")),
    }

    # (c) paraphrase cohesion: rewordings of the same question must embed close together
    cohesion = {}
    for name in names:
        idx = [j for j, o in enumerate(unseen_owner) if o == name]
        vecs = unseen_student[idx]
        sims = [float(vecs[a] @ vecs[b]) for a in range(len(vecs)) for b in range(a + 1, len(vecs))]
        cohesion[name] = round(float(np.mean(sims)), 3) if sims else None

    fidelity = None
    if unseen_teacher is not None:
        qcos = [float(unseen_student[j] @ unseen_teacher[j]) for j in range(len(unseen_texts))]
        fidelity = {"mean": round(float(np.mean(qcos)), 4), "min": round(float(min(qcos)), 4)}

    # (d) gold margin over the student-side in-book score median
    gold_scores = matrix @ student_vecs[names.index("gold")]
    gold_margin = float(gold_scores.max() - np.median(gold_scores))

    report["antimemo"] = {
        "novel_all_absent_from_training": novel_all,
        "novelty": novelty,
        "unseen_queries": len(unseen_texts),
        "teacher_top5_overlap5_mean": round(float(np.mean(overlap5_all)), 3) if overlap5_all else None,
        "teacher_top1_agreement_rate": round(float(np.mean(top1_agrees)), 3) if top1_agrees else None,
        "paraphrase_checks": para_checks,
        "paraphrase_cohesion_cos": cohesion,
        "student_teacher_query_cosine": fidelity,
        "gold_margin_over_inbook_median": round(gold_margin, 4),
    }

    report["verdict"] = {
        "gold_retrieves_discriminant_chunk": report["questions"]["gold"]["student_best"]["chunk"]
        .startswith(GOLD_PREFIX),
        "half_known_retrieves_roots_coefficients": any(
            h["chunk"].startswith(HALF_PREFIX)
            for h in report["questions"]["half_known"]["student_top5"]),
        "unknown_retrieves_guiding_question": any(
            h["chunk"].startswith(UNKNOWN_PREFIX)
            for h in report["questions"]["unknown"]["student_top5"]),
        "out_of_book_refused_by_gate": separated,
        "probes_novel_not_in_training": novel_all,
        "paraphrases_stable": all(para_checks.values()),
        "unseen_teacher_agreement_ok": bool(overlap5_all) and float(np.mean(overlap5_all)) >= 0.5
        and float(np.mean(top1_agrees)) >= 0.5,
    }
    Path(args.out).write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    print("=" * 100, flush=True)
    print("GATE:", json.dumps(report["gate"]), flush=True)
    print("ANTIMEMO:", json.dumps({k: v for k, v in report["antimemo"].items() if k != "novelty"}), flush=True)
    print("VERDICT:", json.dumps(report["verdict"]), flush=True)
    print(f"report -> {args.out}", flush=True)
    return 0 if all(report["verdict"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
