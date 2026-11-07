# Divee Retrieval

**Reviewed 2026-11-06.** This is the native retrieval engine for Targeted Learning. It performs SQLite FTS5/BM25, exact cosine similarity over stored BGE-M3-space vectors, and Reciprocal Rank Fusion. It does not load ONNX, BGE-M3, or any embedding model.

The TypeScript caller encodes the query, supplies its vector, and owns rewriting, gating, parent expansion, session integration, and policy. The server setting `targetedLearning.retrieval.engine` selects `auto`, `native`, or `typescript`; `auto` uses this binary when installed and falls back to TypeScript if the native path is unavailable or fails.

## Build and test

From this directory:

```sh
cargo fmt --check
cargo test --offline
cargo clippy --offline -- -D warnings
cargo build --release --offline
```

The engine links the system SQLite library and uses the FTS5 virtual table created by `packages/learning/src/store/schema.ts`.

## Modes

### One-shot search

```sh
./target/release/divee-retrieval \
  --db /path/to/books.db \
  --query "heart chambers" \
  --book BOOK_ID \
  --vector-base64 QUERY_VECTOR_BASE64 \
  --bm25-limit 30 --dense-limit 30 --limit 8
```

Returns JSON hits with chunk/book/section identifiers, page, passage text, and BM25/dense/fused scores.

### Persistent chat process: `--serve`

The TypeScript client starts one long-lived child process per learning runtime, not one child per query. The process keeps one read-only database handle and accepts newline-delimited JSON requests on stdin, emitting one JSON response per line on stdout.

```sh
./target/release/divee-retrieval --db /path/to/books.db --serve
```

Request:

```json
{"id":1,"query":"heart chambers","books":["BOOK_ID"],"vector_base64":"...","limit":8,"bm25_limit":30,"dense_limit":30,"rrf_k":60,"bm25_weight":1,"dense_weight":1}
```

Response:

```json
{"id":1,"hits":[...],"best_dense_score":0.61,"best_fused_score":0.032,"elapsed_ms":0.31}
```

The request ID is echoed for concurrent correlation. Per-request errors are returned as JSON and do not terminate the process. Best dense/fused scores are computed before the final top-K cut so the TypeScript relevance gate sees the candidate-list scores.

### Evaluation: `--eval`

```sh
./target/release/divee-retrieval --db books.db --eval bench/bench-student.jsonl --book BOOK_ID
```

Evaluation JSONL rows contain a query, its vector, relevant chunk IDs, and a tag. Metrics include Recall@5/@10, MRR@10, nDCG@10, latency percentiles, and per-tag results. Pass explicit book IDs for the evaluated corpus; empty book scope yields no candidates.

### Vector compaction: `--compact`

```sh
./target/release/divee-retrieval --db books.db --compact
./target/release/divee-retrieval --db books.db --compact --drop-text --vacuum
```

Compaction writes vectors to the additive `chunk_vecs_blob` table. Readers prefer BLOB and fall back to legacy base64 TEXT, so partially compacted databases remain readable. `--drop-text` is a one-way compatibility step: use it only after all deployed application instances support BLOB reads. `--vacuum` reclaims the freed space.

## Behaviour and safety

- Arabic normalization removes diacritics/tatweel and normalizes common Alef, Ya, and Ta Marbuta variants before FTS.
- Query terms are quoted for safe FTS parsing; malformed requests return structured errors.
- The database is opened read-only for retrieval/serving.
- The Rust process receives vectors from TypeScript; there is no model download or inference in this binary.
- The TypeScript client owns lifecycle, request IDs, timeout/error handling, and fallback. A native failure should not turn into an empty semantic result without a diagnostic.

For the full encoder compatibility and promotion gates, see [Retrieval V2](../../RETRIEVAL_V2_PLAN.md).
