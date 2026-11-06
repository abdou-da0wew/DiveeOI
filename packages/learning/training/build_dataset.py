"""Build the distillation dataset from a finished books.db.

Produces, under --out:

  passages.npz    ids (str), vectors (float32 [P, 1024])  — the exact vectors chat compares to
  queries.npz     vectors (float32 [Q, 1024])             — BGE-M3 targets for each query
  dataset.jsonl   {index, query, lang, lang_pair, tag, positives, negatives}
  vocab.json      the pruned vocabulary (original XLM-R ids, packed to a compact index)
  manifest.json   counts, teacher repo/revision, dims, seed, warnings

Query sources, in order of usefulness:

  --queries real.jsonl   {"query": str, "relevant": [chunk_id], "tag": optional}
                         Real student questions. Best possible input; use it when available.
  built-in synthesis     Section headings and short spans turned into questions, in the language
                         of the passage (Arabic and English). Weaker proxy for real questions.

Everything here is CPU-only except the teacher embedding step, which needs the BGE-M3 weights.
`--no-embed` skips that step (dataset structure only; training needs the vectors).
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sqlite3
import sys
from pathlib import Path

import numpy as np

from teacher import PASSAGE_MAX_LENGTH, QUERY_MAX_LENGTH, decode_base64, encode_base64

ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
FRENCH_ACCENTS_RE = re.compile(r"[àâçéèêëîïôùûüÿœæÀÂÇÉÈÊËÎÏÔÙÛÜŸŒÆ]")
FRENCH_MARKS = (" qu'", " d'", " l'", " c'est", " n'est", " avec ", " pour ", " dans ", " une ", " des ", " les ", " est ", " sont ")
NUMBERING_RE = re.compile(r"^\s*(?:[0-9]+(?:\.[0-9]+)*[.)]?|[-–•*])\s*")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", required=True, help="finished books.db (opened read-only)")
    parser.add_argument("--out", required=True, help="output directory")
    parser.add_argument("--queries", help="optional JSONL of real queries")
    parser.add_argument(
        "--queries-mode",
        choices=["replace", "augment"],
        default="replace",
        help="replace = only the given queries; augment = real queries + synthesized ones (recommended)",
    )
    parser.add_argument("--teacher", default="BAAI/bge-m3")
    parser.add_argument("--device", default=None, help="cuda / cpu (default: auto)")
    parser.add_argument("--max-passages", type=int, default=0, help="0 = all (sampled for vocab/negatives)")
    parser.add_argument("--queries-per-passage", type=int, default=3)
    parser.add_argument("--negatives", type=int, default=8, help="hard negatives per query")
    parser.add_argument("--negative-pool", type=int, default=4096, help="random passages scored per query")
    parser.add_argument("--vocab-size", type=int, default=60_000, help="kept tokens (excluding 4 specials)")
    parser.add_argument("--vocab-max-passages", type=int, default=20_000)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--seed", type=int, default=13)
    parser.add_argument("--no-embed", action="store_true", help="skip teacher embedding (structure only)")
    return parser.parse_args(argv)


def connect(path: str) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{Path(path).expanduser()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def table_exists(db: sqlite3.Connection, name: str) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def load_passages(db: sqlite3.Connection, limit: int, rng: random.Random) -> list[dict]:
    rows = db.execute(
        """
        SELECT c.id AS id, c.text AS text, c.book_id AS book_id,
               COALESCE(NULLIF(s.heading_path, ''), s.title, '') AS heading,
               COALESCE(b.lang, '') AS book_lang
        FROM chunks c
        JOIN sections s ON s.id = c.section_id
        JOIN books b ON b.id = c.book_id
        WHERE b.status = 'ready'
        ORDER BY c.book_id, c.ord
        """
    ).fetchall()
    passages = [
        {
            "id": row["id"],
            "text": row["text"] or "",
            "book_id": row["book_id"],
            "heading": last_heading(row["heading"]),
            "book_lang": row["book_lang"],
        }
        for row in rows
        if (row["text"] or "").strip()
    ]
    if limit and len(passages) > limit:
        passages = rng.sample(passages, limit)
    return passages


def load_vectors(db: sqlite3.Connection, ids: list[str]) -> dict[str, np.ndarray]:
    """Blob rows (written by `--compact`) are preferred; base64 TEXT rows are still accepted."""
    wanted = set(ids)
    vectors: dict[str, np.ndarray] = {}
    has_blob = table_exists(db, "chunk_vecs_blob")
    sql = "SELECT chunk_id, vec FROM chunk_vecs_blob" if has_blob else "SELECT chunk_id, vec FROM chunk_vecs"
    for row in db.execute(sql):
        if row["chunk_id"] not in wanted:
            continue
        raw = row["vec"]
        if isinstance(raw, (bytes, bytearray)):
            vectors[row["chunk_id"]] = np.frombuffer(bytes(raw), dtype="<f4").astype(np.float32)
        elif raw:
            vectors[row["chunk_id"]] = decode_base64(raw)
    missing = [cid for cid in ids if cid not in vectors]
    if missing and has_blob:
        # Rows that were never compacted live in the legacy column.
        for row in db.execute("SELECT chunk_id, vec FROM chunk_vecs WHERE vec <> ''"):
            if row["chunk_id"] in wanted and row["chunk_id"] not in vectors:
                vectors[row["chunk_id"]] = decode_base64(row["vec"])
        missing = [cid for cid in ids if cid not in vectors]
    return vectors


def last_heading(heading: str) -> str:
    if not heading:
        return ""
    part = re.split(r"\s*(?:>|/|›|»)\s*", heading.strip())[-1]
    return NUMBERING_RE.sub("", part).strip()


def language_of(text: str, fallback: str = "") -> str:
    if ARABIC_RE.search(text):
        return "ar"
    lowered = f" {text.lower()} "
    if FRENCH_ACCENTS_RE.search(text) or any(mark in lowered for mark in FRENCH_MARKS):
        return "fr"
    if fallback == "ar" and not re.search(r"[A-Za-z]", text):
        return "ar"
    if fallback in {"en", "fr"} and not ARABIC_RE.search(text):
        return fallback
    return "en"


def first_sentence(text: str, words: int = 16) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    sentence = re.split(r"(?<=[.!?؟])\s", cleaned)[0]
    return " ".join(sentence.split()[:words]).strip(" .،,;:-")


def synthesize(passage: dict, per_passage: int, rng: random.Random) -> list[dict]:
    """Cheap, honest proxy queries. Never invented facts: only headings and spans of the passage.

    The pool deliberately mixes many phrasings (raw heading, raw sentence spans, question /
    explain / how / why forms and a keyword cut, per language) so the student learns
    meaning-level matching instead of memorising a handful of fixed templates. A random subset
    of `per_passage` is kept per passage.
    """
    language = language_of(f"{passage['heading']} {passage['text']}", passage["book_lang"])
    heading, span = passage["heading"], first_sentence(passage["text"])
    # A heading in the other script (common in translated books, or a numbered stub) would create a
    # mixed-language query that no student would ever type; fall back to a span of the passage.
    heading_matches = 3 <= len(heading) <= 90 and language_of(heading) == language
    phrase = heading if heading_matches and len(heading) <= 80 else " ".join(span.split()[:6])
    words = passage["text"].split()
    second_span = " ".join(words[8:20]) if len(words) >= 22 else ""
    if second_span and (len(second_span) < 12 or language_of(second_span) != language):
        second_span = ""
    keywords = " ".join([w for w in re.findall(r"[\w\u0600-\u06FF]+", phrase) if len(w) > 3][:5])
    candidates: list[tuple[str, str]] = []

    if heading_matches:
        candidates.append((heading, "heading"))
    if len(span.split()) >= 4:
        candidates.append((span, "span"))
    if second_span:
        candidates.append((second_span, "span"))
    if phrase:
        if language == "ar":
            candidates += [
                (f"ما هو {phrase}؟", "question"),
                (f"اشرح {phrase}", "explain"),
                (f"كيف يعمل {phrase}؟", "question"),
                (f"ما أهمية {phrase}؟", "question"),
                (f"تحدث لي عن {phrase}", "explain"),
            ]
        elif language == "fr":
            candidates += [
                (f"Qu'est-ce que {phrase} ?", "question"),
                (f"Explique {phrase}", "explain"),
                (f"Comment fonctionne {phrase} ?", "question"),
                (f"Parle-moi de {phrase}", "explain"),
                (f"Pourquoi {phrase} est-il important ?", "question"),
            ]
        else:
            candidates += [
                (f"What is {phrase}?", "question"),
                (f"Explain {phrase}", "explain"),
                (f"How does {phrase} work?", "question"),
                (f"What should I know about {phrase}?", "question"),
                (f"Tell me about {phrase}", "explain"),
                (f"Why is {phrase} important?", "question"),
            ]
    if len(keywords) >= 8 and language_of(keywords) == language:
        candidates.append((keywords, "keywords"))

    seen: set[str] = set()
    unique: list[dict] = []
    for text, kind in candidates:
        key = re.sub(r"\s+", " ", text.strip().lower())
        if len(key) < 8 or key in seen:
            continue
        seen.add(key)
        unique.append({"query": text.strip(), "tag": kind, "lang": language})
    rng.shuffle(unique)
    return unique[: max(1, per_passage)]


def load_real_queries(path: str) -> list[dict]:
    rows: list[dict] = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if not row.get("query") or not row.get("relevant"):
                raise SystemExit(f"{path}: every line needs 'query' and a non-empty 'relevant' list")
            rows.append(
                {
                    "query": row["query"],
                    "tag": row.get("tag", "real"),
                    "lang": row.get("lang") or language_of(row["query"]),
                    "positives": list(row["relevant"]),
                }
            )
    return rows


def mine_negatives(
    query_vectors: np.ndarray,
    passage_ids: list[str],
    matrix: np.ndarray,
    positives: list[list[str]],
    count: int,
    pool_size: int,
    rng: np.random.Generator,
) -> list[list[str]]:
    if count <= 0 or matrix.size == 0:
        return [[] for _ in positives]
    index_of = {cid: index for index, cid in enumerate(passage_ids)}
    pool = min(pool_size, len(passage_ids))
    out: list[list[str]] = []
    for row, positive_ids in zip(query_vectors, positives):
        positive_set = set(positive_ids)
        sample = rng.choice(len(passage_ids), size=pool, replace=False)
        scores = matrix[sample] @ row
        order = np.argsort(-scores)
        picked: list[str] = []
        for position in order:
            candidate = passage_ids[int(sample[int(position)])]
            if candidate in positive_set or candidate not in index_of:
                continue
            picked.append(candidate)
            if len(picked) >= count:
                break
        out.append(picked)
    return out


def build_vocab(tokenizer, texts: list[str], size: int) -> dict:
    from collections import Counter

    counts: Counter[int] = Counter()
    for text in texts:
        counts.update(tokenizer(text, truncation=True, max_length=PASSAGE_MAX_LENGTH)["input_ids"])
    kept = [token_id for token_id, _ in counts.most_common(size) if token_id > 3]
    coverage = sum(counts[token_id] for token_id in kept) / max(1, sum(counts.values()))
    return {
        "original_vocab": int(len(tokenizer)),
        "ids": [int(token_id) for token_id in kept],
        "size": 4 + len(kept),
        "coverage": round(float(coverage), 6),
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    rng_py = random.Random(args.seed)
    rng_np = np.random.default_rng(args.seed)

    db = connect(args.db)
    passages = load_passages(db, args.max_passages, rng_py)
    if not passages:
        print("books.db has no ready chunks; index a book first", file=sys.stderr)
        return 2
    vectors = load_vectors(db, [passage["id"] for passage in passages])
    passages = [passage for passage in passages if passage["id"] in vectors]
    if not passages:
        print("no stored vectors found for the ready chunks", file=sys.stderr)
        return 2

    passage_ids = [passage["id"] for passage in passages]
    matrix = np.stack([vectors[cid] for cid in passage_ids]).astype(np.float32)
    dims = int(matrix.shape[1])
    if dims != 1024:
        print(f"stored vectors are {dims}-dimensional; the student contract is 1024", file=sys.stderr)
        return 2

    # ---------------------------------------------------------------- queries
    known = set(passage_ids)
    rows = []
    if args.queries:
        rows = load_real_queries(args.queries)
        rows = [row for row in rows if any(cid in known for cid in row["positives"])]
        dropped_real = 0
    if args.queries is None or args.queries_mode == "augment":
        for passage in passages:
            for item in synthesize(passage, args.queries_per_passage, rng_py):
                rows.append({**item, "positives": [passage["id"]]})
    if not rows:
        print("no queries could be built", file=sys.stderr)
        return 2

    book_lang = {passage["id"]: passage["book_lang"] for passage in passages}
    for row in rows:
        target = book_lang.get(row["positives"][0], "")
        if target in {"ar", "en", "fr"} and row["lang"] in {"ar", "en", "fr"}:
            row["lang_pair"] = f"{row['lang']}->{target}"

    # ---------------------------------------------------------------- teacher
    if args.no_embed:
        query_vectors = np.zeros((len(rows), dims), dtype=np.float32)
        print("warning: --no-embed leaves zero query vectors; training cannot use this dataset")
    else:
        from teacher import Teacher

        teacher = Teacher(args.teacher, device=args.device)
        if teacher.dims != dims:
            print(f"teacher dims {teacher.dims} != stored dims {dims}", file=sys.stderr)
            return 2
        query_vectors = teacher.embed(
            [row["query"] for row in rows], batch_size=args.batch_size, max_length=QUERY_MAX_LENGTH
        )
        negatives = mine_negatives(
            query_vectors, passage_ids, matrix, [row["positives"] for row in rows], args.negatives, args.negative_pool, rng_np
        )
        for row, hard in zip(rows, negatives):
            row["negatives"] = hard

        vocab_texts = [passage["text"] for passage in passages[: args.vocab_max_passages]]
        vocab = build_vocab(teacher.tokenizer, vocab_texts + [row["query"] for row in rows], args.vocab_size)
        (out / "vocab.json").write_text(json.dumps(vocab, indent=2), encoding="utf-8")

    # ---------------------------------------------------------------- write
    np.savez_compressed(out / "passages.npz", ids=np.array(passage_ids), vectors=matrix)
    np.savez_compressed(out / "queries.npz", vectors=query_vectors.astype(np.float32))
    with open(out / "dataset.jsonl", "w", encoding="utf-8") as handle:
        for index, row in enumerate(rows):
            handle.write(
                json.dumps(
                    {
                        "index": index,
                        "query": row["query"],
                        "lang": row["lang"],
                        "lang_pair": row.get("lang_pair", ""),
                        "tag": row["tag"],
                        "positives": row["positives"],
                        "negatives": row.get("negatives", []),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    manifest = {
        "dims": dims,
        "passages": len(passage_ids),
        "queries": len(rows),
        "teacher": args.teacher,
        "query_max_length": QUERY_MAX_LENGTH,
        "source": args.queries or "synthesized",
        "seed": args.seed,
        "negatives_per_query": args.negatives,
        "tags": sorted({row["tag"] for row in rows}),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
