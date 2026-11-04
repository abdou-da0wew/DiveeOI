"""Ingest the Egyptian Baccalaureate (EB) textbooks into the distillation corpus.

Downloads the official EB PDFs (Arabic / English / French subjects + assessments), extracts the
text layer with PyMuPDF, chunks it the way the app's ingest would, embeds every chunk with the
fp32 BGE-M3 teacher and appends the books to the *existing* `/content/corpus/books.db` built by
`colab_corpus.py` (Wikipedia stand-in). The two corpora are complementary: Wikipedia keeps the
language general, the EB books put the student exactly on-domain (Egyptian Baccalaureate).

It also appends EB "real queries" to `real-queries.jsonl`: natural student-style questions per
language plus cross-lingual pairs mined *by book alignment* (the EB books are official
translations of each other, so a relative-position match across the Ar/En/Fr editions gives an
honest ar->en / en->ar / fr->en target without any external data).

Stages (run on the Colab T4 runtime):
  python colab_eb_corpus.py --stage download   # network only, safe while training runs
  python colab_eb_corpus.py --stage extract    # CPU only
  python colab_eb_corpus.py --stage db         # needs the GPU (teacher embedding)
  python colab_eb_corpus.py --stage all        # the three above, in order

Output: books.db rows (status='ready'), real-queries.jsonl, /content/corpus/eb-summary.json.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sqlite3
import time
import unicodedata
import urllib.request
from pathlib import Path

BASE = "https://egyptianbaccalaureate.blob.core.windows.net/egyptianbaccalaureate"

# The full official list supplied by the project owner (subjects x languages x parts + assessments).
PDF_PATHS: list[str] = [
    "Programming-ArtificialIntelligence-Ar-EB-part1.pdf",
    "Programming-ArtificialIntelligence-En-EB-part1.pdf",
    "Programming-ArtificialIntelligence-Ar-EB-part2.pdf",
    "Programming-ArtificialIntelligence-En-EB-part2.pdf",
    "EB-Assessments/Programming-ArtificialIntelligence-Ar-EB-Assessments-1.pdf",
    "EB-Assessments/Programming-ArtificialIntelligence-En-EB-Assessments-1.pdf",
    "Chemistry-Ar-EB-part1.pdf",
    "Chemistry-En-EB-part1.pdf",
    "Chemistry-Fr-EB-part1.pdf",
    "Chemistry-Ar-EB-part2.pdf",
    "Chemistry-En-EB-part2.pdf",
    "EB-Assessments/Chemistry-Ar-EB-Assessments-1.pdf",
    "EB-Assessments/Chemistry-En-EB-Assessments-1.pdf",
    "EB-Assessments/Chemistry-Fr-EB-Assessments-1.pdf",
    "Mathematics-Ar-EB-Part1.pdf",
    "Mathematics-En-EB-Part1.pdf",
    "Mathematics-Fr-EB-Part2.pdf",
    "EB-Assessments/Mathematics-Ar-EB-Assessments-1.pdf",
    "EB-Assessments/Mathematics-En-EB-Assessments-1.pdf",
    "Physics-Ar-EB-part1.pdf",
    "Physics-En-EB-Part1.pdf",
    "Physics-Fr-EB-Part1.pdf",
    "Physics-Ar-EB-part2.pdf",
    "Physics-En-EB-Part2.pdf",
    "EB-Assessments/Physics-Ar-EB-Assessments-1.pdf",
    "EB-Assessments/Physics-En-EB-Assessments-1.pdf",
    "Eng-L1-EB-Part1.pdf",
    "Eng-L1-EB-Part2.pdf",
    "Eng-L2-EB-Part1.pdf",
    "EB-Assessments/Eng-L1-EB-Assessments-1.pdf",
    "French-L1-EB-part1.pdf",
    "French-L1-EB-part2.pdf",
    "Story-Fr-EB-L1.pdf",
    "EB-Assessments/Frensh-L1-EB-Assessments-1.pdf",
    "Story-En-EB-L1.pdf",
    "EgyptianHistory-Ar-EB-part1.pdf",
    "EgyptianHistory-Ar-EB-part2.pdf",
    "EB-Assessments/EgyptianHistory-Ar-EB-Assessments-1.pdf",
    "Story-Ar-EB.pdf",
    "EB-Assessments/Arabic-EB-Assessments-1.pdf",
]

SUBJECT_MAP = [
    ("programming-artificialintelligence", "programming-ai", "Programming & Artificial Intelligence"),
    ("egyptianhistory", "egyptian-history", "Egyptian History"),
    ("chemistry", "chemistry", "Chemistry"),
    ("mathematics", "mathematics", "Mathematics"),
    ("physics", "physics", "Physics"),
]

LANG_TOKENS = {"ar": "Arabic", "en": "English", "fr": "French"}

AR_RE = re.compile(r"[\u0600-\u06FF]")
FR_RE = re.compile(r"[àâçéèêëîïôùûüÿœæÀÂÇÉÈÊËÎÏÔÙÛÜŸŒÆ]")
EMBED_SIGNATURE = json.dumps(
    {"repo": "Xenova/bge-m3", "revision": "4de13258303883538bd53b696b452bf8099f0858", "dtype": "fp32", "maxLength": 512}
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=["download", "extract", "db", "all"], default="all")
    parser.add_argument("--pdf-dir", default="/content/eb-pdf")
    parser.add_argument("--corpus", default="/content/corpus")
    parser.add_argument("--max-chunks-per-book", type=int, default=90)
    parser.add_argument("--min-chars", type=int, default=240, help="minimum chunk characters")
    parser.add_argument("--max-chars", type=int, default=900)
    parser.add_argument("--queries-per-book", type=int, default=8)
    parser.add_argument("--cross-lingual-per-pair", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--device", default=None)
    parser.add_argument("--seed", type=int, default=13)
    return parser.parse_args()


def parse_book(path_in_list: str) -> dict:
    """`Chemistry-Fr-EB-part1.pdf` / `EB-Assessments/Arabic-EB-Assessments-1.pdf` -> metadata."""
    name = path_in_list.split("/")[-1].removesuffix(".pdf")
    lower = name.lower()
    lang = ""
    for code in ("ar", "en", "fr"):
        if re.search(rf"[-/]{code}(?=[-]|$)", lower) or f"-{code}-" in lower:
            lang = code
            break
    if not lang:
        if "frensh" in lower or lower.startswith("french"):
            lang = "fr"
        elif lower.startswith("eng-"):
            lang = "en"
        elif lower.startswith("arabic"):
            lang = "ar"
    if not lang:
        lang = "ar" if AR_RE.search(name) else "en"

    subject_key, title = "", ""
    for needle, key, human in SUBJECT_MAP:
        if needle in lower:
            subject_key, title = key, human
            break
    if not subject_key:
        if lower.startswith("eng-l"):
            subject_key, title = f"english-l{lower.split('-l')[1][0]}", "English"
        elif lower.startswith("french-l") or "frensh-l" in lower:
            subject_key, title = "french-l1", "French"
        elif lower.startswith("story"):
            subject_key = f"story-{lang}"
            title = "Story"  # language already shown in the display suffix
        elif lower.startswith("arabic"):
            subject_key, title = "arabic", "Arabic"
    if not subject_key:
        subject_key, title = lower.split("-")[0], name.split("-")[0]

    kind = "assessments" if "assessments" in lower else "textbook"
    part = ""
    match = re.search(r"part(\d)", lower)
    if match:
        part = f"part{match.group(1)}"
    elif "assessments" in lower:
        part = "assess1"
    elif re.search(r"-l(\d)", lower):
        part = f"level{re.search(r'-l(\d)', lower).group(1)}"
    slug = "eb-" + "-".join(x for x in (subject_key, lang, kind if kind == "assessments" else part) if x)
    display_part = {"textbook": part, "assessments": "Assessments"}.get(kind, part)
    display = f"{title} ({LANG_TOKENS.get(lang, lang)})"
    if display_part:
        display += f" - {display_part.replace('part', 'Part ').replace('level', 'Level ').strip()}"
    return {"path": path_in_list, "name": name, "subject": subject_key, "lang": lang, "kind": kind, "part": part, "slug": slug, "title": display}


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u0640", "")  # tatweel
    text = text.replace("\u2028", "\n").replace("\u2029", "\n")
    text = re.sub(r"[\u200b-\u200f\u202a-\u202e\ufeff\u2066-\u2069]", "", text)  # bidi/zero-width marks
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def repeated_lines(pages: list[list[str]], min_pages: int = 6, threshold: float = 0.3) -> set[str]:
    """Header/footer lines: short identical lines on >= threshold of pages."""
    counts: dict[str, int] = {}
    sample = pages[:: max(1, len(pages) // 80)]
    for lines in sample:
        for line in {ln.strip().lower() for ln in (lines[:2] + lines[-2:]) if ln.strip()}:
            if len(line) <= 70:
                counts[line] = counts.get(line, 0) + 1
    n = max(1, len(sample))
    return {line for line, count in counts.items() if count / n >= threshold and count >= 2 and n >= min_pages}


def sentence_split(paragraph: str) -> list[str]:
    parts = re.split(r"(?<=[.!?؟…])\s+", paragraph)
    return [p for p in parts if p.strip()]


def page_paragraphs(raw: str, min_chars: int, max_chars: int) -> list[str]:
    units: list[str] = []
    buf: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            if buf:
                units.append(" ".join(buf))
                buf = []
            continue
        buf.append(line)
    if buf:
        units.append(" ".join(buf))
    out: list[str] = []
    for unit in units:
        unit = re.sub(r"\s+", " ", unit).strip()
        if len(unit) < 40:
            continue
        if len(unit) > max_chars:
            current = ""
            for sentence in sentence_split(unit):
                if current and len(current) + len(sentence) + 1 > max_chars:
                    out.append(current.strip())
                    current = sentence
                else:
                    current = f"{current} {sentence}".strip()
            if current:
                out.append(current.strip())
        else:
            out.append(unit)
    merged: list[str] = []
    for piece in out:
        if merged and len(merged[-1]) < min_chars and len(merged[-1]) + len(piece) + 1 <= max_chars:
            merged[-1] = f"{merged[-1]} {piece}"
        else:
            merged.append(piece)
    return [p for p in merged if len(p) >= min_chars // 2]


def extract_book(pdf_path: Path, book: dict, args: argparse.Namespace) -> dict:
    try:  # PyMuPDF >= 1.24 prefers the `pymupdf` name; older wheels ship `fitz`
        import pymupdf as fitz
    except ImportError:  # pragma: no cover
        import fitz

    doc = fitz.open(pdf_path)
    page_texts: list[list[str]] = []
    for page in doc:
        page_texts.append([ln.strip() for ln in clean_text(page.get_text("text")).splitlines()])
    doc.close()
    if not page_texts:
        return {**book, "status": "error", "error": "no pages", "pages": 0, "chunks": []}

    drop = repeated_lines(page_texts)
    filtered: list[list[str]] = []
    for lines in page_texts:
        kept, seen_local = [], set()
        for line in lines:
            key = line.strip().lower()
            if key in drop or key in seen_local:
                continue
            seen_local.add(key)
            kept.append(line)
        filtered.append(kept)

    # per-page: heading guess (first short line) + paragraph chunks
    pages: list[dict] = []
    total_chars = 0
    for number, lines in enumerate(filtered, start=1):
        text = "\n".join(lines)
        total_chars += len(text.replace(" ", ""))
        heading = ""
        if lines and 3 <= len(lines[0]) <= 90 and not re.search(r"[.!?]$", lines[0]) and len(lines[0].split()) <= 12:
            heading = lines[0]
        paras = page_paragraphs(text, args.min_chars, args.max_chars)
        if paras:
            pages.append({"number": number, "heading": heading, "paras": paras})
    if total_chars < 1500:
        return {**book, "status": "error", "error": f"text layer too small ({total_chars} chars)", "pages": len(filtered), "chunks": []}

    chunks: list[dict] = []
    for page in pages:
        packed: list[str] = []
        for para in page["paras"]:
            if packed and len(packed[-1]) + len(para) + 1 <= args.max_chars:
                packed[-1] = f"{packed[-1]} {para}"
            else:
                packed.append(para)
        for position, text in enumerate(packed):
            heading = page["heading"] or book["title"]
            chunks.append(
                {
                    "chunk_id": f"{book['slug']}-p{page['number']}-c{position}",
                    "page": page["number"],
                    "heading": heading,
                    "text": text,
                }
            )
    if len(chunks) > args.max_chunks_per_book:
        step = len(chunks) / args.max_chunks_per_book
        chunks = [chunks[int(i * step)] for i in range(args.max_chunks_per_book)]
    return {**book, "status": "ok", "pages": len(filtered), "chars": total_chars, "chunks": chunks}


def download_stage(args: argparse.Namespace) -> None:
    out = Path(args.pdf_dir)
    out.mkdir(parents=True, exist_ok=True)
    for item in PDF_PATHS:
        book = parse_book(item)
        target = out / item.split("/")[-1]
        if target.exists() and target.stat().st_size > 100_000 and target.read_bytes()[:5] == b"%PDF-":
            print(f"skip (cached): {target.name}", flush=True)
            continue
        url = f"{BASE}/{item}"
        for attempt in (1, 2, 3):
            try:
                started = time.time()
                urllib.request.urlretrieve(url, target)  # noqa: S310 - fixed https host
                magic = target.read_bytes()[:5]
                size = target.stat().st_size
                if magic != b"%PDF-" or size < 100_000:
                    raise RuntimeError(f"bad payload magic={magic!r} size={size}")
                print(f"downloaded {target.name}: {size / 1e6:.1f} MB in {time.time() - started:.0f}s", flush=True)
                break
            except Exception as error:  # noqa: BLE001
                print(f"attempt {attempt} failed for {book['slug']}: {error}", flush=True)
                if attempt == 3:
                    raise
                time.sleep(3 * attempt)


def extract_stage(args: argparse.Namespace) -> list[dict]:
    results: list[dict] = []
    for item in PDF_PATHS:
        book = parse_book(item)
        pdf_path = Path(args.pdf_dir) / item.split("/")[-1]
        if not pdf_path.exists():
            print(f"MISSING pdf for {book['slug']}", flush=True)
            results.append({**book, "status": "error", "error": "pdf not downloaded", "chunks": []})
            continue
        result = extract_book(pdf_path, book, args)
        results.append(result)
        print(
            f"{book['slug']}: status={result['status']} pages={result.get('pages', 0)} chunks={len(result.get('chunks', []))}",
            flush=True,
        )
    Path(args.corpus).mkdir(parents=True, exist_ok=True)
    payload = [
        {k: v for k, v in result.items() if k != "chunks"} | {"chunk_count": len(result.get("chunks", []))}
        for result in results
    ]
    (Path(args.corpus) / "eb-extract.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    passages_path = Path(args.corpus) / "eb-passages.jsonl"
    with open(passages_path, "w", encoding="utf-8") as handle:
        for result in results:
            for chunk in result.get("chunks", []):
                handle.write(
                    json.dumps(
                        {
                            "chunk_id": chunk["chunk_id"],
                            "book_slug": result["slug"],
                            "book_title": result["title"],
                            "lang": result["lang"],
                            "subject": result["subject"],
                            "page": chunk["page"],
                            "heading": chunk["heading"],
                            "text": chunk["text"],
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
    total = sum(len(r.get("chunks", [])) for r in results)
    print(f"extracted passages: {total} -> {passages_path}", flush=True)
    return results


def db_stage(args: argparse.Namespace, results: list[dict]) -> None:
    import random

    from teacher import Teacher, encode_base64

    rng = random.Random(args.seed)
    corpus = Path(args.corpus)
    passages_path = corpus / "eb-passages.jsonl"
    rows = [json.loads(line) for line in passages_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows:
        print("no EB passages to index; nothing to do", flush=True)
        return

    db = sqlite3.connect(corpus / "books.db")
    db.row_factory = sqlite3.Row
    existing = {row[0] for row in db.execute("SELECT id FROM chunks WHERE id LIKE 'eb-%'")}
    fresh = [row for row in rows if row["chunk_id"] not in existing]
    if not fresh:
        print("all EB chunks already indexed", flush=True)
    print(f"passages total={len(rows)} fresh={len(fresh)}", flush=True)

    if fresh:
        print("== embedding EB chunks with BGE-M3 fp32 ==", flush=True)
        teacher = Teacher(device=args.device)
        started = time.time()
        vectors = teacher.embed([row["text"] for row in fresh], batch_size=args.batch_size, max_length=512)
        print(f"embedded {len(fresh)} chunks in {time.time() - started:.0f}s", flush=True)
        vector_by_id = {row["chunk_id"]: encode_base64(vector) for row, vector in zip(fresh, vectors)}

        now = int(time.time() * 1000)
        by_book: dict[str, list[dict]] = {}
        for row in fresh:
            by_book.setdefault(row["book_slug"], []).append(row)
        for slug, book_rows in by_book.items():
            meta = next(r for r in results if r["slug"] == slug)
            source_hash = hashlib.sha256(slug.encode()).hexdigest()
            db.execute(
                "INSERT OR REPLACE INTO books (id, slug, title, author, lang, source_hash, source_path, pages, status, "
                "error, parent_count, chunk_count, embed_signature, normalizer_version, created_at, indexed_at, summary_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', NULL, 0, ?, ?, 1, ?, ?, ?)",
                (
                    slug,
                    slug,
                    meta["title"],
                    "Egyptian Baccalaureate",
                    meta["lang"],
                    source_hash,
                    meta["path"],
                    meta.get("pages", 1),
                    len(book_rows),
                    EMBED_SIGNATURE,
                    now,
                    now,
                    json.dumps({"subject": meta["subject"], "kind": meta["kind"], "part": meta["part"]}, ensure_ascii=False),
                ),
            )
            pages_sorted = sorted({row["page"] for row in book_rows})
            for order, page_number in enumerate(pages_sorted):
                page_rows = sorted([r for r in book_rows if r["page"] == page_number], key=lambda r: r["chunk_id"])
                section_id = f"{slug}-p{page_number}"
                heading = page_rows[0]["heading"]
                db.execute(
                    "INSERT OR REPLACE INTO sections (id, book_id, parent_id, level, title, page_start, page_end, ord, text, heading_path) "
                    "VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?, ?)",
                    (section_id, slug, heading, page_number, page_number, order, "\n\n".join(r["text"] for r in page_rows), f"{meta['title']} > {heading}"),
                )
                for position, row in enumerate(sorted(page_rows, key=lambda r: int(r["chunk_id"].rsplit("-c", 1)[1]))):
                    db.execute(
                        "INSERT OR REPLACE INTO chunks (id, book_id, section_id, ord, page, text, text_norm, token_count) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (row["chunk_id"], slug, section_id, position, row["page"], row["text"], row["text"].lower(), max(1, len(row["text"]) // 4)),
                    )
                    db.execute("INSERT OR REPLACE INTO chunk_vecs (chunk_id, vec) VALUES (?, ?)", (row["chunk_id"], vector_by_id[row["chunk_id"]]))
        db.commit()

    # ---------------------------------------------------------------- queries
    print("== building EB queries ==", flush=True)
    all_rows = [json.loads(line) for line in passages_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    indexed = {row[0] for row in db.execute("SELECT id FROM chunks WHERE id LIKE 'eb-%'")}
    all_rows = [row for row in all_rows if row["chunk_id"] in indexed]
    templates = {
        "ar": ["ما هو {x}؟", "اشرح لي {x}", "لخّص ما ورد حول {x}", "حدّثني عن {x}", "أين أجد معلومات عن {x}؟"],
        "en": ["What is {x}?", "Explain {x} to me", "Tell me about {x}", "Summarize what is said about {x}", "Where can I read about {x}?"],
        "fr": ["Qu'est-ce que {x} ?", "Explique-moi {x}", "Parle-moi de {x}", "Résume ce qui est dit sur {x}", "Où trouver des informations sur {x} ?"],
    }
    by_book: dict[str, list[dict]] = {}
    for row in all_rows:
        by_book.setdefault(row["book_slug"], []).append(row)
    queries: list[dict] = []
    for slug, book_rows in by_book.items():
        lang = book_rows[0]["lang"]
        for row in rng.sample(book_rows, min(args.queries_per_book, len(book_rows))):
            heading = row["heading"]
            # A heading is a good query seed when it reads like one: right script, short, no sentence end.
            usable = 4 <= len(heading) <= 80 and not re.search(r"[.!?]", heading) and (
                bool(AR_RE.search(heading)) if lang == "ar" else not AR_RE.search(heading)
            )
            phrase = heading if usable else " ".join(row["text"].split()[:6])
            template = rng.choice(templates[lang])
            queries.append({"query": template.format(x=phrase), "relevant": [row["chunk_id"]], "tag": "real", "lang": lang})

    # cross-lingual pairs by aligned relative position across translated editions
    subjects: dict[str, dict[str, list[dict]]] = {}
    for slug, book_rows in by_book.items():
        subject = next(r for r in results if r["slug"] == slug)["subject"]
        lang = book_rows[0]["lang"]
        subjects.setdefault(subject, {}).setdefault(lang, []).extend(book_rows)
    pairs = 0
    for subject, by_lang in sorted(subjects.items()):
        langs = sorted(by_lang)
        for i, src in enumerate(langs):
            for dst in langs[i + 1 :]:
                for _ in range(args.cross_lingual_per_pair):
                    src_rows, dst_rows = by_lang[src], by_lang[dst]
                    src_row = rng.choice(src_rows)
                    rel = src_rows.index(src_row) / max(1, len(src_rows) - 1)
                    dst_row = dst_rows[min(len(dst_rows) - 1, round(rel * (len(dst_rows) - 1)))]
                    phrase = " ".join(src_row["text"].split()[:6])
                    template = rng.choice(templates[src])
                    queries.append(
                        {
                            "query": template.format(x=phrase),
                            "relevant": [dst_row["chunk_id"]],
                            "tag": "real",
                            "lang": src,
                            "lang_pair": f"{src}->{dst}",
                        }
                    )
                    pairs += 1
    with open(corpus / "real-queries.jsonl", "a", encoding="utf-8") as handle:
        for q in queries:
            handle.write(json.dumps(q, ensure_ascii=False) + "\n")
    summary = {
        "books": len(by_book),
        "passages": len(all_rows),
        "langs": {lang: sum(1 for r in all_rows if r["lang"] == lang) for lang in ("ar", "en", "fr")},
        "queries_added": len(queries),
        "cross_lingual_pairs": pairs,
        "books_by_subject": {subject: sorted(by_lang) for subject, by_lang in subjects.items()},
    }
    (corpus / "eb-summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False), flush=True)


def load_extract_results(args: argparse.Namespace) -> list[dict]:
    """Rebuild per-book metadata + chunk lists from the extract stage's outputs."""
    corpus = Path(args.corpus)
    by_slug: dict[str, dict] = {}
    extract_path = corpus / "eb-extract.json"
    if extract_path.exists():
        for meta in json.loads(extract_path.read_text(encoding="utf-8")):
            by_slug[meta["slug"]] = {**meta, "chunks": []}
    for line in (corpus / "eb-passages.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        book = by_slug.setdefault(
            row["book_slug"],
            {
                "slug": row["book_slug"],
                "title": row["book_title"],
                "lang": row["lang"],
                "subject": row["subject"],
                "path": row["book_slug"],
                "pages": 0,
                "status": "ok",
                "chunks": [],
            },
        )
        book["chunks"].append({"chunk_id": row["chunk_id"], "page": row["page"], "heading": row["heading"], "text": row["text"]})
    return list(by_slug.values())


def main() -> int:
    args = parse_args()
    started = time.time()
    results: list[dict] = []
    if args.stage in ("download", "all"):
        download_stage(args)
    if args.stage in ("extract", "all"):
        results = extract_stage(args)
    if args.stage == "db":
        results = load_extract_results(args)
    if args.stage in ("db", "all"):
        db_stage(args, results)
    print(f"done in {time.time() - started:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
