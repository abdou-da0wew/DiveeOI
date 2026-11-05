"""Build a public-data stand-in books.db for the Divee query-student training (Colab).

Reads real Arabic + English Wikipedia articles (HF `wikimedia/wikipedia`, streamed),
chunks them the way the app's ingest would, embeds the chunks with the fp32 BGE-M3
teacher (BAAI/bge-m3) and writes a books.db that `build_dataset.py` accepts unchanged:

  books(id,slug,title,lang,status='ready',embed_signature,...)
  sections(id,book_id,level,ord,text,heading_path)
  chunks(id,book_id,section_id,ord,text,text_norm,token_count)
  chunk_vecs(chunk_id, vec TEXT base64 f32)

It also emits `real-queries.jsonl` for `build_dataset.py --queries`: natural-language
questions over sampled passages, including cross-lingual pairs mined from Wikipedia
langlinks (ar title -> en passage), so eval.py gets ar->en / en->ar slices.

Usage (Colab, T4):
  python colab_corpus.py --out /content/corpus --articles-per-lang 240
Output:
  /content/corpus/books.db  /content/corpus/real-queries.jsonl  /content/corpus/corpus.json
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import random
import re
import sqlite3
import time
from pathlib import Path

AR_RE = re.compile(r"[\u0600-\u06FF]")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="/content/corpus")
    parser.add_argument("--articles-per-lang", type=int, default=240)
    parser.add_argument("--max-chunks-per-article", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--passage-max-length", type=int, default=512)
    parser.add_argument("--real-queries", type=int, default=90)
    parser.add_argument("--cross-lingual", type=int, default=50)
    parser.add_argument("--seed", type=int, default=13)
    parser.add_argument("--device", default=None)
    return parser.parse_args()


def normalize_text(text: str) -> str:
    """Cheap normalisation (the app's Arabic normaliser is stricter; search quality is not
    what this stand-in is for — the dense path uses vectors)."""
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def paragraphs_of(article: str, min_chars: int = 320, max_chars: int = 900) -> list[str]:
    out: list[str] = []
    for para in article.split("\n"):
        para = normalize_text(para)
        if len(para) < min_chars:
            continue
        # Hard-split overly long paragraphs at sentence boundaries.
        while len(para) > max_chars:
            cut = para.rfind(". ", 0, max_chars)
            cut = cut if cut > min_chars // 2 else max_chars
            piece, para = para[: cut + 1].strip(), para[cut + 1 :].strip()
            if len(piece) >= min_chars // 2:
                out.append(piece)
            if len(out) > 200:  # safety
                return out
        if len(para) >= min_chars // 2:
            out.append(para)
    return out


def load_articles(lang: str, count: int, seed: int) -> list[dict]:
    """Stream `wikimedia/wikipedia` and take `count` substantial articles."""
    from datasets import load_dataset

    ds = load_dataset("wikimedia/wikipedia", f"20231101.{lang}", split="train", streaming=True)
    articles: list[dict] = []
    rng = random.Random(seed)
    for row in ds:
        text = row["text"] or ""
        title = (row["title"] or "").strip()
        if not title or len(text) < 4000:
            continue
        # Skip metadata-heavy leads (lists, disambiguation, indexes).
        if "may refer to" in text[:600] or "يمكن أن يشير" in text[:600]:
            continue
        articles.append({"title": title, "text": text})
        if len(articles) >= count * 3:
            break
    rng.shuffle(articles)
    return articles[:count]


SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, author TEXT, lang TEXT,
  source_hash TEXT NOT NULL, source_path TEXT NOT NULL, pages INTEGER, status TEXT NOT NULL,
  error TEXT, parent_count INTEGER NOT NULL DEFAULT 0, chunk_count INTEGER NOT NULL DEFAULT 0,
  embed_signature TEXT NOT NULL, normalizer_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL, indexed_at INTEGER, summary_json TEXT
);
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL, parent_id TEXT, level INTEGER NOT NULL,
  title TEXT, page_start INTEGER, page_end INTEGER, ord INTEGER NOT NULL,
  text TEXT NOT NULL, heading_path TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL, section_id TEXT NOT NULL, ord INTEGER NOT NULL,
  page INTEGER, text TEXT NOT NULL, text_norm TEXT NOT NULL, token_count INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chunk_vecs (
  chunk_id TEXT PRIMARY KEY, vec TEXT NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);
"""


def slugify(title: str, lang: str) -> str:
    slug = re.sub(r"[^a-z0-9\u0600-\u06FF]+", "-", title.lower()).strip("-")
    return f"{lang}-{slug[:48]}" or f"{lang}-page"


class Teacher:
    """fp32 BGE-M3, CLS pooled + L2 normalised — the exact teacher post-processing."""

    def __init__(self, device: str | None):
        import torch
        from transformers import AutoModel, AutoTokenizer

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = AutoTokenizer.from_pretrained("BAAI/bge-m3")
        self.model = AutoModel.from_pretrained("BAAI/bge-m3", torch_dtype=torch.float32).to(self.device).eval()

    def embed(self, texts: list[str], batch_size: int, max_length: int) -> list[str]:
        import torch

        vectors: list[str] = []
        started = time.time()
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            encoded = self.tokenizer(
                batch, padding=True, truncation=True, max_length=max_length, return_tensors="pt"
            ).to(self.device)
            with torch.no_grad():
                hidden = self.model(**encoded).last_hidden_state[:, 0]
                hidden = torch.nn.functional.normalize(hidden.float(), dim=-1)
            for row in hidden.cpu().numpy().astype("<f4"):
                vectors.append(base64.b64encode(row.tobytes()).decode("ascii"))
            done = start + len(batch)
            if done % (batch_size * 10) < batch_size or done == len(texts):
                rate = done / max(1e-9, time.time() - started)
                print(f"  embedded {done}/{len(texts)} ({rate:.1f}/s)", flush=True)
        return vectors


def langlink_titles(titles: list[str], source_lang: str, target_lang: str, limit: int) -> dict[str, str]:
    """Mine Wikipedia langlinks (source title -> target title) via the public API."""
    import urllib.parse
    import urllib.request

    out: dict[str, str] = {}
    endpoint = f"https://{source_lang}.wikipedia.org/w/api.php"
    for title in titles[: limit * 3]:
        if len(out) >= limit:
            break
        try:
            params = urllib.parse.urlencode(
                {
                    "action": "query",
                    "prop": "langlinks",
                    "titles": title,
                    "lllang": target_lang,
                    "format": "json",
                    "redirects": 1,
                }
            )
            request = urllib.request.Request(f"{endpoint}?{params}", headers={"User-Agent": "diveeoi-training/1.0"})
            with urllib.request.urlopen(request, timeout=15) as response:
                data = json.load(response)
            pages = data.get("query", {}).get("pages", {})
            for page in pages.values():
                for link in page.get("langlinks", []) or []:
                    if link.get("lang") == target_lang and page.get("title"):
                        out[page["title"]] = link["*"]
        except Exception as error:  # noqa: BLE001 - network best-effort
            print(f"  langlink lookup failed for {title!r}: {error}", flush=True)
            continue
    return out


def main() -> int:
    args = parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    started = time.time()

    print("== loading articles ==", flush=True)
    articles_by_lang: dict[str, list[dict]] = {}
    for lang in ("ar", "en"):
        articles = load_articles(lang, args.articles_per_lang, args.seed)
        print(f"{lang}: {len(articles)} articles", flush=True)
        articles_by_lang[lang] = articles

    print("== building db rows ==", flush=True)
    rows: list[dict] = []  # {chunk_id, book_slug, book_title, lang, heading, text}
    seen_slugs: set[str] = set()
    for lang in ("ar", "en"):
        for article in articles_by_lang[lang]:
            slug = slugify(article["title"], lang)
            if slug in seen_slugs:
                continue
            seen_slugs.add(slug)
            paras = paragraphs_of(article["text"])[: args.max_chunks_per_article]
            for position, para in enumerate(paras):
                rows.append(
                    {
                        "chunk_id": f"{slug}-s1-c{position}",
                        "book_slug": slug,
                        "book_title": article["title"],
                        "lang": lang,
                        "heading": article["title"],
                        "text": para,
                    }
                )
    rng.shuffle(rows)
    print(f"passages: {len(rows)}", flush=True)

    print("== embedding with BGE-M3 fp32 ==", flush=True)
    teacher = Teacher(args.device)
    vectors = teacher.embed([row["text"] for row in rows], args.batch_size, args.passage_max_length)
    vector_by_chunk = {row["chunk_id"]: vector for row, vector in zip(rows, vectors)}

    print("== writing books.db ==", flush=True)
    db_path = out / "books.db"
    # Idempotent append: the EB ingester (colab_eb_corpus.py) may have populated the db already,
    # and re-runs must not destroy it. Wikipedia slugs are seed-deterministic, so a re-run
    # replaces exactly its own rows and leaves every other book untouched.
    db = sqlite3.connect(db_path)
    db.executescript(SCHEMA)
    existing = {row[0] for row in db.execute("SELECT id FROM chunks")}
    fresh_rows = [row for row in rows if row["chunk_id"] not in existing]
    skipped = len(rows) - len(fresh_rows)
    if skipped:
        print(f"skipping {skipped} already-indexed wiki chunks", flush=True)
    rows = fresh_rows
    vector_by_chunk = {cid: vector_by_chunk[cid] for cid in {row["chunk_id"] for row in rows}}
    if not rows:
        print("wiki corpus already indexed; nothing to do", flush=True)
        db.close()
        return 0
    if not db.execute("SELECT 1 FROM meta WHERE key='schema_version'").fetchone():
        db.execute("INSERT INTO meta (key, value) VALUES ('schema_version', '1')")
    now = int(time.time() * 1000)
    embed_signature = json.dumps(
        {"repo": "Xenova/bge-m3", "revision": "4de13258303883538bd53b696b452bf8099f0858", "dtype": "fp32", "maxLength": 512}
    )
    by_book: dict[str, list[dict]] = {}
    for row in rows:
        by_book.setdefault(row["book_slug"], []).append(row)
    for slug, book_rows in by_book.items():
        db.execute(
            "INSERT OR REPLACE INTO books (id, slug, title, author, lang, source_hash, source_path, pages, status, "
            "parent_count, chunk_count, embed_signature, normalizer_version, created_at, indexed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', 0, ?, ?, 1, ?, ?)",
            (
                slug,
                slug,
                book_rows[0]["book_title"],
                "Wikipedia contributors",
                book_rows[0]["lang"],
                hashlib.sha256(slug.encode()).hexdigest(),
                f"{slug}.txt",
                1,
                len(book_rows),
                embed_signature,
                now,
                now,
            ),
        )
        # One parent section per article (the app's chunker maps chunks -> one section);
        # the parent text the LLM would see is the article's kept paragraphs joined.
        db.execute(
            "INSERT OR REPLACE INTO sections (id, book_id, parent_id, level, title, page_start, page_end, ord, text, heading_path) "
            "VALUES (?, ?, NULL, 1, ?, 1, 1, 0, ?, ?)",
            (
                f"{slug}-s1",
                slug,
                book_rows[0]["heading"],
                "\n\n".join(row["text"] for row in book_rows),
                book_rows[0]["heading"],
            ),
        )
        for position, row in enumerate(book_rows):
            db.execute(
                "INSERT OR REPLACE INTO chunks (id, book_id, section_id, ord, page, text, text_norm, token_count) "
                "VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
                (
                    row["chunk_id"],
                    slug,
                    f"{slug}-s1",
                    position,
                    row["text"],
                    normalize_text(row["text"]).lower(),
                    max(1, len(row["text"]) // 4),
                ),
            )
            db.execute("INSERT OR REPLACE INTO chunk_vecs (chunk_id, vec) VALUES (?, ?)", (row["chunk_id"], vector_by_chunk[row["chunk_id"]]))
    db.commit()

    # ------------------------------------------------------------- real queries
    print("== building real queries (incl. cross-lingual) ==", flush=True)
    sampled = rng.sample(rows, min(args.real_queries, len(rows)))
    templates = {
        "ar": ["ما هو {x}؟", "اشرح لي {x}", "لخّص ما ورد حول {x}"],
        "en": ["What is {x}?", "Explain {x} to me", "Summarize what is said about {x}"],
    }
    queries: list[dict] = []
    for row in sampled:
        template = rng.choice(templates[row["lang"]])
        head = row["heading"] if len(row["heading"]) <= 60 else " ".join(row["text"].split()[:7])
        queries.append({"query": template.format(x=head), "relevant": [row["chunk_id"]], "tag": "real"})
    # cross-lingual: ar question -> en passage and vice versa, via langlinks
    en_by_title = {a["title"]: a for a in articles_by_lang["en"]}
    ar_by_title = {a["title"]: a for a in articles_by_lang["ar"]}
    en_to_ar = langlink_titles(list(en_by_title), "en", "ar", args.cross_lingual)
    ar_to_en = langlink_titles(list(ar_by_title), "ar", "en", args.cross_lingual)
    pairs = 0
    for en_title, ar_title in list(en_to_ar.items())[: args.cross_lingual // 2]:
        article = en_by_title.get(en_title)
        paras = paragraphs_of(article["text"]) if article else []
        if not paras or ar_title not in ar_by_title:
            continue
        chunk_id = f"{slugify(en_title, 'en')}-s1-c0"
        queries.append({"query": f"ما هو {ar_title}؟", "relevant": [chunk_id], "tag": "real", "lang_pair": "ar->en"})
        pairs += 1
    for ar_title, en_title in list(ar_to_en.items())[: args.cross_lingual // 2]:
        article = ar_by_title.get(ar_title)
        paras = paragraphs_of(article["text"]) if article else []
        if not paras or en_title not in en_by_title:
            continue
        chunk_id = f"{slugify(ar_title, 'ar')}-s1-c0"
        queries.append({"query": f"What is {en_title}?", "relevant": [chunk_id], "tag": "real", "lang_pair": "en->ar"})
        pairs += 1
    # verify the referenced chunks really exist; drop the rest
    known = {row["chunk_id"] for row in rows}
    queries = [q for q in queries if all(cid in known for cid in q["relevant"])]
    with open(out / "real-queries.jsonl", "w", encoding="utf-8") as handle:
        for q in queries:
            handle.write(json.dumps(q, ensure_ascii=False) + "\n")

    summary = {
        "passages": len(rows),
        "books": len(by_book),
        "queries": len(queries),
        "cross_lingual_pairs": pairs,
        "langs": {"ar": sum(1 for r in rows if r["lang"] == "ar"), "en": sum(1 for r in rows if r["lang"] == "en")},
        "teacher": "BAAI/bge-m3",
        "seconds": round(time.time() - started, 1),
    }
    (out / "corpus.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
