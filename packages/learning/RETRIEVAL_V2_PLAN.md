# Divee Retrieval V2 — plan and execution plan

Status: written 2026-11-03, before implementation. Update the status column as work lands.
Supersedes the "next steps" in `native/retrieval/QUERY_ENCODER_PLAN.md` (that file stays as the original rationale).

## 1. Goal

Index once with the heavy teacher (BGE-M3), then **forget it**. Normal chat runs a tiny
Arabic+English query encoder plus a Rust retrieval engine. No ~570 MB BGE-M3 in RAM while chatting.

- Teacher: `Xenova/bge-m3` (BGE-M3 is natively multilingual and covers Arabic; no other teacher is needed).
  Used only for chunk embeddings, training-data generation and evaluation.
- Student (query encoder): small multilingual Transformer that emits the **same 1024-d, CLS-pooled,
  L2-normalised space** as the teacher, so every already-indexed book stays valid. No re-embedding.
- Engine: SQLite FTS5 BM25 + exact cosine + RRF + gate, in Rust (`native/retrieval`), HNSW only if measured necessary.

## 2. Facts found (do not re-discover)

- Chat path today: `session/turn.ts` calls `ensureEmbedder()` and `embed(query)` (BGE-M3 singleton in
  `embed/pipeline.ts`) for every non-empty turn. `unload()` exists but is only an idle timer concern.
- Vectors are stored as base64 Float32 **TEXT** in `chunk_vecs.vec`. Ingest (`ingest/run.ts`) writes that format.
- A Rust prototype exists (`native/retrieval`): FTS5 BM25, streaming cosine, RRF, Arabic normalisation, JSON out,
  caller-supplied query vector. Not wired into TypeScript.
- A passage vector cannot embed a future question; a query encoder in the same space is mandatory for semantic search.
- This VDS (8 CPU, 32 GB, no GPU) has **no torch/onnxruntime/transformers, no BGE-M3 weights, and an empty
  production `books.db`** (0 books). Full indexing is therefore happening elsewhere and has not finished here.
  Training and the final benchmark need (a) the finished index/corpus and (b) a GPU or long CPU run. They are
  prepared and smoke-tested here, but not executed here.
- Production service runs an older binary; nothing here is deployed or pushed by this plan.

## 3. Hard rules

1. Do not change the on-disk vector format or the ingest path while indexing is in progress (TEXT stays the
   write format). Binary BLOB storage is a **post-indexing offline compaction** step, additive and reversible.
2. Student output contract is fixed: 1024 floats, CLS pooling, L2 normalised, BGE-M3 tokenizer, max 128 query tokens.
3. BGE-M3 stays the default query encoder until the student passes the gates in section 6. Promotion is a setting flip,
   never an implicit change.
4. Chat must never silently return semantically-empty results: if no query encoder is usable, fall back to
   BM25-only and say so in diagnostics.
5. Never load the teacher in a chat turn when `queryEncoder` resolves to `student` or `bm25`.

## 4. Architecture

```
OFFLINE (indexing/training only)               CHAT (steady state)
BGE-M3 teacher ──► chunk vectors (books.db)    question ─► QueryEncoder ─► 1024-d vector ─┐
BGE-M3 teacher ──► query targets ─► distill      student (int8 ONNX, ~35 MB) or bge-m3   ├─► Rust engine
                                    student                                  or none       │   BM25 + cosine
                                                                                 (BM25 only)│   RRF + gate
```

`QueryEncoder` (TypeScript, `src/embed/query-encoder.ts`): `resolve(settings)` → one of
`student | bge-m3 | bm25`, with `embed(text)`, `dispose()`, and `describe()` for diagnostics.
Policy (`retrieval.queryEncoder`): `auto` (default) = student if its model dir is present and manifest-valid,
else bge-m3, else bm25; `student`, `bge-m3`, `bm25` force a choice. After indexing finishes the teacher is
unloaded when `retrieval.unloadTeacherAfterIndexing` is true (default).

### Student model
- Tokenizer: BGE-M3 (XLM-R SentencePiece). Vocabulary pruned to tokens observed in the Arabic+English corpus
  plus specials (about 60k of 250k); this is the main RAM saving (250k×H embedding matrix dominates).
- 6 layers, hidden 384, 6 heads, FFN 1536, then Linear 384→1024 and L2 norm. About 35M parameters, ~35 MB int8.
- Init: token embeddings from PCA(1024→384) of the teacher's token embeddings; layers random/truncated-teacher.
- Loss: `L = a·(1−cos(s,t)) + b·InfoNCE(s, teacher passage vectors, hard negatives) + c·KL(teacher vs student
  similarity distributions over in-batch + mined candidates)`. Vector matching alone does not guarantee ranking.
- Export: ONNX, dynamic axes, int8 dynamic quantisation, loaded by the existing `@huggingface/transformers`
  pipeline from a local model dir (no new runtime dependency).

## 5. Work breakdown and status

| # | Deliverable | Where | Runs here? | Status |
|---|---|---|---|---|
| 0 | This plan | `packages/learning/RETRIEVAL_V2_PLAN.md` | yes | done |
| 1 | `QueryEncoder` abstraction, `auto/student/bge-m3/bm25` policy, teacher unload after indexing, settings, tests | `src/embed/query-encoder.ts`, `session/turn.ts`, `settings/*` | yes | todo |
| 2 | Rust: `eval` subcommand (Recall@k, MRR@10, nDCG@10, latency) + tests | `native/retrieval` | yes | todo |
| 3 | Rust: read binary BLOB vectors when present; `compact` subcommand (TEXT→BLOB, additive) + tests | `native/retrieval` | yes (tiny fixture) | todo |
| 4 | Training pipeline: dataset builder, distillation trainer, ONNX int8 export, student eval | `packages/learning/training/` | smoke only | todo |
| 5 | Eval set builder (ar/en/cross-lingual/synonym/typo/off-topic) + gate false-refusal measurement | `training/`, `src/eval` | smoke only | todo |
| 6 | Run indexing-complete steps: compact, train, export, benchmark vs teacher | user machine / GPU | **no** | blocked on finished index + GPU |
| 7 | Flip `queryEncoder` default to student; keep bge-m3 as selectable fallback | settings | — | blocked on 6 |
| 8 | Optional HNSW | Rust | — | only if exact scan latency fails at real library size |

## 6. Promotion gates (student replaces teacher for chat)

Measured on a held-out set the student never saw, teacher-vs-student, same index:
- Recall@10 ≥ 0.95 × teacher, Recall@5 ≥ 0.93 × teacher, MRR@10 ≥ 0.93 × teacher, nDCG@10 ≥ 0.93 × teacher.
- Cross-lingual (ar→en, en→ar) Recall@10 ≥ 0.90 × teacher.
- Gate false-refusal ≤ teacher + 2 pp; off-topic false-accept ≤ teacher + 2 pp (gate threshold re-calibrated on student scores).
- p95 query latency ≤ 30 ms on this VDS; steady-state chat RSS with no teacher below 1 GiB.
Fail any gate → keep bge-m3 default, iterate on data/loss; the engine and bm25 fallback still ship.

## 7. Execution notes
- Verify with: `bun test` in `packages/learning` (SKIP_LIVE_EMBED=1), `cargo test --offline` and `cargo clippy --offline -- -D warnings`
  in `native/retrieval`, `tsgo --noEmit`. Heavy builds per `.zcode-quality.md`.
- Training runs on a GPU machine: `training/README.md` has the exact commands and the input contract
  (a copy of the finished `books.db`, read-only).
