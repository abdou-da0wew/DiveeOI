# Divee Retrieval

The retrieval engine for Targeted Learning: SQLite FTS5 BM25 + exact cosine over the stored BGE-M3
vectors + Reciprocal Rank Fusion, in Rust, with no embedding model and no ML runtime in the process.
It opens `books.db` read-only and is driven from `packages/learning/src/retrieve/native-engine.ts`.

It does not load ONNX or an embedding model. The query vector is supplied by the caller (the
TypeScript query encoder), which is why the engine stays tiny and fast.

## Build and test

```sh
cargo fmt --check
cargo test --offline
cargo clippy --offline -- -D warnings
cargo build --release --offline
```

It links the system SQLite (`libsqlite3.so.0`) and uses the FTS5 virtual table created by
`packages/learning/src/store/schema.ts`.

## Modes

### 1. One-shot search (CLI / debugging)

```sh
./target/release/divee-retrieval \
  --db /path/to/books.db \
  --query "heart chambers" \
  --book BOOK_ID \
  --vector-base64 QUERY_VECTOR_BASE64 \
  --bm25-limit 30 --dense-limit 30 --limit 8
```

Returns a JSON array of hits with `chunk_id`, `book_id`, `section_id`, `page`, `text`,
`bm25_score`, `dense_score`, `fused_score`.

### 2. `--serve` (how chat uses it)

One process, one open read-only handle, NDJSON over stdin/stdout. No per-query spawn, no schema
re-read, stable latency.

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

`id` is echoed so the TypeScript client can match concurrent requests. A bad line or a failed query
returns `{"id":...,"error":"..."}` and the process keeps serving. `best_dense_score` /
`best_fused_score` are measured *before* the final top-K cut, because the gate thresholds are
defined on the full candidate lists.

### 3. `--eval` (teacher vs student benchmark)

```sh
./target/release/divee-retrieval --db books.db --eval bench/bench-student.jsonl --book BOOK_ID
```

Each line is `{"query", "vector_base64", "relevant": [chunk_id], "tag"}`. The report gives
Recall@5/@10, MRR@10, nDCG@10, p50/p95 latency, overall and per tag. Run the same file with the
teacher vectors and the student vectors to compare encoders on the *real* BM25+cosine+RRF pipeline.

### 4. `--compact` (leaner vector storage)

```sh
./target/release/divee-retrieval --db books.db --compact                  # TEXT -> chunk_vecs_blob
./target/release/divee-retrieval --db books.db --compact --drop-text --vacuum   # one-way, reclaims disk
```

`chunk_vecs_blob` is additive: readers prefer the BLOB and fall back to the legacy base64 TEXT
column, so a half-compacted library works and an older app build keeps reading TEXT. `--drop-text`
empties the TEXT column *only* for rows that are already compacted; run it once every instance runs
this build. `--vacuum` then reclaims the space.

## Behaviour

- Normalises Arabic diacritics/tatweel and common Alef, Ya and Ta Marbuta variants before FTS.
- Wraps each query term in quotes, so punctuation cannot produce an FTS5 syntax error.
- Streams vectors from SQLite and keeps only the best dense K in memory.
- Parameterised SQL for query text and book IDs; database opened read-only (except `--compact`).
- Ignores malformed/short/absent vectors instead of failing a query.

## Tests

`cargo test` covers Arabic normalisation, FTS quoting, base64/blob decoding, cosine, and — against a
real temporary SQLite file — BM25+dense fusion, dense-only (paraphrase) retrieval, compaction
(additive and idempotent, including reading vectors after the TEXT column is emptied) and NDJSON
serve responses.
