# Divee Retrieval V2 — plan and execution record

Status: revised 2026-11-03 (second pass, after the encoder-selection groundwork landed).
Supersedes `native/retrieval/QUERY_ENCODER_PLAN.md` (kept as the original rationale).

## 1. Goal

Index once with the heavy teacher (BGE-M3), then **forget it**. Normal chat runs a small
Arabic+English query encoder plus the Rust retrieval engine. No ~570 MB BGE-M3 session in RAM
while a student is chatting.

- **Teacher** `Xenova/bge-m3` (BGE-M3 family, 1024-d, XLM-RoBERTa based, 100+ languages including
  Arabic — no separate "Arabic BGE-M3" exists or is needed). Used only for chunk embeddings,
  training-data generation, and evaluation.
- **Student** (query encoder): small multilingual Transformer that emits the **same 1024-d,
  CLS-pooled, L2-normalised space** as the teacher, so every already-indexed book stays valid.
  No re-embedding of any book.
- **Engine**: SQLite FTS5 BM25 + exact cosine + RRF in Rust (`native/retrieval`), plus the TS
  implementation as a fallback. Gate, query rewrite and parent expansion stay in TypeScript
  (policy), the engine keeps math + SQL (hot path).

## 2. Facts verified in this repo (do not re-discover)

| Fact | Where |
|---|---|
| Chat embeds every question with the BGE-M3 singleton | `src/session/turn.ts` → `prepareQueryEncoder` → `src/embed/pipeline.ts` |
| Encoder policy already exists: `auto / student / bge-m3`, promotion-gated, teacher freed after indexing | `src/embed/query-encoder.ts`, `src/settings/{schema,defaults}.ts` |
| Vectors are base64 Float32 **TEXT** in `chunk_vecs.vec`; ingest writes that format | `src/store/schema.ts`, `src/ingest/run.ts` |
| Rust prototype: FTS5 BM25, streaming cosine, RRF, Arabic normalisation, `--eval` metrics | `native/retrieval/src/{main,metrics}.rs` |
| The Rust binary was **not** reachable from TypeScript | `src/retrieve/hybrid.ts` (no reference) |
| `books.db` on the dev VDS has **0 books**; no torch/onnxruntime/BGE-M3 weights, no GPU | earlier probe |
| Cargo dependency set is fixed for offline builds (serde + serde_json only) | `native/retrieval/Cargo.toml` |

Consequence: **ONNX inference stays in TypeScript** (transformers.js is already a dependency) and
the Rust engine receives the finished query vector as base64. That is the lean split until a
vendored `ort` build is available — adding `ort` now cannot be built offline.

## 3. Hard rules

1. Do not change the on-disk vector format or the ingest write path while indexing is in progress.
   BLOB storage is **additive** (`chunk_vecs_blob`) and produced by an explicit offline `--compact`.
2. Student output contract is fixed: 1024 floats, CLS pooling, L2 normalised, BGE-M3 tokenizer,
   max 128 query tokens.
3. BGE-M3 stays the default chat encoder until the student passes the gates in §7. Promotion is a
   setting flip driven by the model manifest, never implicit.
4. If a query encoder is unavailable the turn must degrade to BM25-only and say so in diagnostics —
   it must never silently return semantically empty results.
5. Never load the teacher in a chat turn when the resolved encoder is `student`.
6. Every native-engine call is best-effort: any spawn/parse/timeout failure falls back to the
   TypeScript path for that turn, with a diagnostic event.

## 4. Architecture

```
OFFLINE (indexing / training only)                    CHAT (steady state)
BGE-M3 teacher ── chunk vectors (books.db)            question ─► QueryEncoder ─► 1024-d vector ─┐
BGE-M3 teacher ── query targets ─► distill student       student (int8 ONNX ~35-50 MB)           ├─► Rust engine
                                                          or bge-m3 (fallback)                   │   BM25 + cosine
                                                     TS rewrites / gate / parent expansion ◄─────┘   + RRF
```

Stored vectors are read either from `chunk_vecs_blob` (BLOB, preferred once compacted) or from the
legacy base64 TEXT column, by both implementations.

## 5. Work breakdown and status

| # | Deliverable | Where | Runs here? | Status |
|---|---|---|---|---|
| 0 | This plan | `RETRIEVAL_V2_PLAN.md` | yes | **done** |
| 1 | `QueryEncoder` abstraction (`auto/student/bge-m3`), promotion gate, teacher unload after indexing, tests | `src/embed/query-encoder.ts`, `session/turn.ts`, `ingest/run.ts`, `settings/*` | yes | **done** (prev. session) |
| 2 | Rust `--eval` (Recall@5/10, MRR@10, nDCG@10, latency p50/p95, per-tag slices) | `native/retrieval` | yes | **done** (prev. session) |
| 3 | Rust `--serve` persistent NDJSON mode (one process, one open DB per chat, no per-query spawn) | `native/retrieval` | syntax-checked only | **done** (build/test pending on a machine with cargo) |
| 4 | Rust BLOB vector reads + `--compact` (TEXT → `chunk_vecs_blob`, optional `--drop-text --vacuum`) | `native/retrieval` | syntax-checked only | **done** (build/test pending) |
| 5 | Rust integration tests against a real SQLite fixture (BM25, dense, BLOB preference, compact, serve) | `native/retrieval` | written, not run | **done** (run on the dev VDS) |
| 6 | TypeScript native-engine client + `retrieval.engine` setting + fallback + tests | `src/retrieve/native-engine.ts`, `src/retrieve/hybrid.ts` | yes | **done** (205 tests, typecheck clean) |
| 7 | Distillation toolkit: dataset builder, vocab pruning, trainer, ONNX int8 export, evaluator, promoter, CPU smoke test | `packages/learning/training/` | syntax + data-path only | **done** (training run needs GPU + teacher weights) |
| 8 | Run compaction, train, export, benchmark student vs teacher on the real library | GPU machine | **no** | blocked on finished index |
| 9 | Flip `queryEncoder` default to `student`; keep `bge-m3` selectable | settings | — | blocked on 8 |
| 10 | Optional HNSW | Rust | — | only if measured p95 fails at real library size |

## 6. Decisions taken in this pass (with reasons)

- **Serve mode instead of process-per-query.** A spawn + DB open per chat turn costs 5–20 ms and
  re-reads schema; a persistent child with one read-only handle is leaner and gives stable p95.
- **BLOB compaction is additive and reversible.** `chunk_vecs_blob` only; the TEXT column is
  dropped only with the explicit `--drop-text` flag (plus `--vacuum`), because older app builds
  still read TEXT.
- **Engine split: math in Rust, policy in TS.** Gate thresholds, query rewriting and parent
  expansion are product behaviour with tests; keeping them in one place avoids drift. The engine
  returns hits plus `best_dense_score` / `best_fused_score`, so the gate sees exactly the same
  numbers it sees today.
- **No `ort` in Rust yet.** Offline cargo cannot fetch it; the TS encoder already exists.
- **Student size default: hidden 512, 6 layers, pruned vocabulary.** Published BGE-M3 distillation
  (e.g. 8-layer/366 M) shows depth pruning preserves retrieval quality when hidden size is kept.
  Vocabulary pruning (250k → ~60–80k covering Arabic+English) is where the real RAM saving is:
  the embedding matrix dominates a small encoder. `--hidden 1024 --layers 8` is the first knob if
  the gates fail; `384/6` is the floor for a ~35 MB int8 model.
- **Loss = cosine imitation + InfoNCE on teacher passage vectors + KL on teacher score
  distribution.** Matching teacher vectors alone does not optimise ranking (already in §1; now
  implemented in `training/divee_student.py`).
- **`autoWeightByLanguage` stays dead in TS** and is not reimplemented in Rust (it never had an
  effect); the setting remains for compatibility.

## 7. Promotion gates (student replaces the teacher for chat)

Measured on a held-out set the student never saw, same index, same engine:
- Recall@10 ≥ 0.95 × teacher, Recall@5 ≥ 0.93 × teacher, MRR@10 ≥ 0.93 × teacher,
  nDCG@10 ≥ 0.93 × teacher.
- Cross-lingual (ar→en, en→ar) Recall@10 ≥ 0.90 × teacher.
- Gate false-refusal ≤ teacher + 2 pp; off-topic false-accept ≤ teacher + 2 pp (thresholds
  re-calibrated on student score distributions by `training/promote.py`).
- p95 query latency ≤ 30 ms on the VDS; steady-state chat RSS with no teacher below 1 GiB.

Fail any gate → keep `bge-m3` as the default, iterate on data/loss; the engine, serve mode and
BLOB storage still ship.

## 8. Execution plan (ordered, copy-paste)

On any machine (no GPU needed):

```sh
cd packages/learning/native/retrieval && cargo fmt --check && cargo test --offline \
  && cargo clippy --offline -- -D warnings && cargo build --release --offline
cd ../../ && SKIP_LIVE_EMBED=1 bun test && bun run typecheck
```

On the machine that holds the finished `books.db` (no GPU needed):

```sh
# 1. compact vectors, then measure the space saved
divee-retrieval --db ~/.local/share/diveeoi/targeted-learning/books.db --compact
# 2. (optional, only after every instance runs this build)
divee-retrieval --db .../books.db --compact --drop-text --vacuum
```

On a GPU machine (or a long CPU run):

```sh
cd packages/learning/training && pip install -r requirements.txt
python smoke_test.py                     # 30 s sanity: train 3 steps, export, quantize
python build_dataset.py --db books.db --out data/ --teacher BAAI/bge-m3
python train.py --data data/ --out models/student/ --epochs 6
python eval.py --data data/ --model models/student/ --report eval-report.json \
  --rust-bin ../native/retrieval/target/release/divee-retrieval
python promote.py --report eval-report.json --model models/student/   # writes divee-student.json
```

Then copy `models/student/` to `<dataDir>/models/divee-query-student/` and set
`retrieval.queryEncoder = auto` (a promoted student is used; otherwise BGE-M3 stays).

## 9. Verification performed in this pass

| Check | Result |
|---|---|
| `bun test` in `packages/learning` | 205 passed, 2 skipped, 0 failed |
| `tsgo --noEmit` (`bun run typecheck`) | clean |
| `python -m py_compile training/*.py` | clean |
| `python training/smoke_test.py` | metrics pass; model/export part skips without torch |
| `build_dataset.py --no-embed` against a fixture `books.db` | 4 passages, 12 queries (ar + en), 1024-d vectors read |
| Rust `cargo test` / `clippy` / `fmt` | **not run here** — this sandbox has no cargo, no crate cache and no `libsqlite3` dev files; `main.rs` was parsed with tree-sitter (0 syntax errors) and reviewed by hand |
| Native engine client behaviour | 12 tests: mapping, concurrency, error, malformed line, timeout, cooldown, restart, fallback |

## 10. Risks / open items

- **Student quality** is unproven until trained; the promotion manifest and gate calibration exist
  precisely so an unproven student can never silently serve chat.
- **Query distribution**: headings and templated questions are a weak proxy for real student
  questions. `build_dataset.py --queries real.jsonl` accepts captured real queries; that is the
  preferred input once available.
- **blob + TEXT divergence**: readers join `chunk_vecs`, so an orphan blob row is never read;
  `--compact` prunes orphans on every run.
- **Windows**: the serve client assumes a POSIX executable; the `DIVEEOI_RETRIEVAL_BIN` override
  and TS fallback cover platforms without the binary.
