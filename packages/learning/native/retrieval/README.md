# Divee Retrieval

A low-memory Rust retrieval prototype for Targeted Learning. It opens the existing SQLite database read-only and combines SQLite FTS5 BM25 with cosine similarity over the stored BGE-M3 vectors.

It does not load ONNX, Transformers.js, or an embedding model. A query vector is supplied by the caller, so the encoder remains a separate component.

## Build and test

```sh
cargo fmt --check
cargo test --offline
cargo clippy --offline -- -D warnings
cargo build --release --offline
```

The binary links against the system SQLite library and uses the FTS5 virtual table created by `packages/learning/src/store/schema.ts`.

## Usage

Lexical-only retrieval:

```sh
./target/release/divee-retrieval \
  --db /path/to/books.db \
  --query "heart chambers" \
  --book BOOK_ID \
  --limit 8
```

Hybrid BM25 + cosine retrieval:

```sh
./target/release/divee-retrieval \
  --db /path/to/books.db \
  --query "heart chambers" \
  --book BOOK_ID \
  --vector-base64 QUERY_VECTOR_BASE64 \
  --dense-limit 30 \
  --limit 8
```

Repeat `--book BOOK_ID` for multiple books. The query vector must be a base64-encoded little-endian Float32 array generated in the same embedding space as the stored document vectors. Current BGE-M3 vectors are 1024-dimensional, CLS-pooled, and L2-normalized.

The engine:
- Normalizes Arabic diacritics/tatweel and common Alef, Ya, and Ta Marbuta variants.
- Uses parameterized SQL for query text and book IDs.
- Opens the database read-only.
- Streams stored vectors from SQLite and retains only the best dense K hits, rather than loading the corpus into memory.
- Computes cosine similarity and rank-based Reciprocal Rank Fusion (RRF).
- Returns IDs, page, chunk text, BM25 score, cosine score, and fused score as JSON.

This is a retrieval engine, not an embedding model. A compatible query encoder is still required for semantic search. The executable is currently a tested prototype and is not yet connected to the production chat path.
