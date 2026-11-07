# Divee Retrieval V2 — architecture, execution status, and promotion plan

- **Reviewed:** 2026-11-06
- **Status:** Core runtime wiring and offline training/evaluation tooling are implemented. Student quality promotion remains data- and evaluation-dependent.
- **Scope:** `packages/learning`; this plan supersedes the original query-encoder rationale in [native/retrieval/QUERY_ENCODER_PLAN.md](native/retrieval/QUERY_ENCODER_PLAN.md).

## 1. Objective

Index passages once with the BGE-M3 teacher, then keep the teacher out of steady-state chat whenever a compatible student has passed evaluation and is installed. The chat query encoder must emit vectors in the exact space already stored for book passages; no book re-indexing is required to switch encoders.

- **Teacher:** pinned `Xenova/bge-m3`, a multilingual 1024-dimensional embedding model. It embeds book passages and supplies targets for student training/evaluation.
- **Student:** compact multilingual query encoder. Contract: BGE-M3 tokenizer, at most 128 query tokens, 1024 output dimensions, CLS pooling, and L2 normalisation.
- **Retrieval engine:** Rust FTS5/BM25 + dense cosine + RRF, with a TypeScript implementation as fallback.
- **Policy boundary:** TypeScript keeps query rewrite, relevance gating, parent expansion, session integration, and grounding logic. Rust owns the retrieval hot path, not model inference or product policy.

## 2. Current runtime contract

The runtime options are part of the Targeted Learning settings schema, defaults, UI, and generated SDK types.

| Setting | Values | Default | Meaning |
|---|---|---|---|
| `retrieval.engine` | `auto`, `native`, `typescript` | `auto` | Prefer the native Rust engine when installed; use TypeScript fallback otherwise |
| `retrieval.queryEncoder` | `auto`, `student`, `bge-m3` | `auto` | Use a promoted installed student in auto mode; otherwise use BGE-M3 |
| `retrieval.unloadTeacherAfterIndexing` | boolean | `true` | Release the teacher when indexing drains unless chat still needs it |

The selection rules are deliberate:

1. `auto` never selects a student solely because files exist. The installed runtime manifest must mark it promoted.
2. Explicit `student` selection requires an installed compatible student artifact; missing/incompatible artifacts must fail safely and surface diagnostics.
3. A student query vector must match the stored teacher vector space exactly.
4. `auto` engine selection prefers the Rust binary if it can be resolved and started. Native spawn, protocol, timeout, or query errors fall back to the TypeScript implementation with diagnostics.
5. Both engines must return equivalent hit fields and candidate scores. The gate consumes best dense/fused scores measured before the final top-K cut.
6. If query embedding is unavailable, retrieval must degrade explicitly (for example, BM25-only with a diagnostic); it must not silently present semantically empty results as successful dense retrieval.

## 3. Data and process flow

```text
INDEXING / TRAINING (offline or background)        CHAT (steady state)

BGE-M3 teacher                                     question
   │                                                  │
   ├── passage vectors ──► books.db                  QueryEncoder
   │                         │                      (promoted student
   └── query targets ──► student trainer              or BGE-M3 fallback)
                              │                        │
                       ONNX student + manifest         ▼
                                                query vector + text
                                                        │
                                                        ▼
                                                 Rust retrieval
                                                BM25 + cosine + RRF
                                                        │
                                             TypeScript fallback
                                                        │
                                                        ▼
                                        TypeScript gate / rewrite /
                                        parent context / grounding
```

The native engine opens the library database read-only for retrieval. Its `--serve` mode is persistent NDJSON over stdin/stdout and keeps one database handle open; the TypeScript client correlates request IDs and owns process lifecycle. Rust does not load ONNX or any embedding model.

Stored vectors can be read from the additive `chunk_vecs_blob` table or the legacy base64 TEXT column. `--compact` migrates vectors additively; dropping legacy text is a separate compatibility-sensitive operation.

## 4. Implementation status

| Deliverable | Location | Current status |
|---|---|---|
| Query encoder selection and teacher lifecycle | `src/embed/query-encoder.ts`, session/ingest integration | Implemented |
| Settings schema/defaults and client contract | `src/settings`, app settings, generated SDK types | Implemented; latest generated contract is in commit `2868dc7` |
| Rust BM25 + dense cosine + RRF | `native/retrieval/src` | Implemented |
| Persistent NDJSON serving and TS child client | `native/retrieval`, `src/retrieve/native-engine.ts` | Implemented |
| Native-to-TS fallback and common retrieval result shape | `src/retrieve` | Implemented |
| Additive vector BLOB reads and compaction | `native/retrieval`, learning store schema | Implemented |
| Engine-level benchmark mode | Rust `--eval`, Python evaluator | Implemented |
| Dataset builder, hard negatives, vocabulary pruning | `training/build_dataset.py` | Implemented |
| Student training and ONNX export/INT8 quantisation | `training/train.py`, `export.py`, `divee_student.py` | Implemented |
| Evaluation, gate slices, and promotion manifest | `training/eval.py`, `promote.py` | Implemented |
| Corpus builders | `training/colab_corpus.py`, `colab_eb_corpus.py` | Implemented |
| Real-corpus student evaluation and final promotion | Training outputs and installed runtime artifact | Must be established from the target corpus; not implied by code completion |

The November 4–6 source updates add richer passage-grounded synthetic query forms (Arabic, English, French), explicit cross-lingual sample floors, recorded skipped slices, book-scoped Rust evaluation, trace-safe manual attention for ONNX export, parallel resource-limited Egyptian Baccalaureate OCR workers, and idempotent Wikipedia-corpus appends.

## 5. Non-negotiable compatibility and safety rules

1. Do not change vector dimensions, tokenizer IDs, pooling, normalisation, or max query length without a compatibility plan and tests against existing indexes.
2. Keep teacher passage vectors immutable during student training. A student learns to query the same space; it does not define a new passage index.
3. Preserve the existing base64 TEXT read path while BLOB migration is additive. Only drop legacy text after every deployed app instance supports BLOB reads and a verified backup exists.
4. Keep Rust retrieval read-only for normal search/serve.
5. Keep retrieval policy in TypeScript so native and fallback paths cannot drift on gate or parent-context behaviour.
6. A native failure must produce a diagnostic and a safe fallback, not a false “no results” success.
7. Never mark a model promoted merely because training/export completed. Promotion is held-out evaluation plus manifest recording.
8. Keep real-query datasets and evaluation reports private to the corpus owner. Diagnostic content logging remains opt-in and sensitive.

## 6. Training data and evaluation

The offline trainer lives in `packages/learning/training`. It can read stored passage vectors, accept captured user queries, synthesize query candidates from the passage's own heading and sentence spans, mine hard negatives, train a compact student, export its runtime directory, evaluate held-out slices, and generate the promotion manifest.

Synthetic generation now uses a broader pool of approximately 8–10 candidate phrasings per passage/language: heading and sentence-span cuts, question/explain/how/why templates, and keyword cuts. It does not invent facts. These probes are useful for bootstrapping, but captured questions remain the strongest evidence that the query distribution resembles actual usage.

Evaluation records overall and per-tag/per-language-pair retrieval ratios. Cross-lingual slices have a minimum sample floor; slices below the floor are recorded as skipped in the promotion manifest and cannot be silently counted as successful coverage. Native evaluation passes explicit book IDs so the engine searches the intended corpus.

## 7. Promotion gates

The default thresholds are implemented by `training/promote.py` and must be evaluated on a held-out set not used for training:

| Metric | Student / teacher minimum |
|---|---:|
| Recall@10 | 0.95 |
| Recall@5 | 0.93 |
| MRR@10 | 0.93 |
| nDCG@10 | 0.93 |
| Cross-lingual Recall@10 | 0.90 |

Gate calibration must also ensure that in-book and off-topic score distributions are separable. The default maximum allowed false-refusal increase is bounded by 2 percentage points; off-topic false-accept behaviour must be reviewed as well. The report records per-slice results and skipped slices.

The earlier target of p95 query latency at or below 30 ms and steady-state chat RSS below 1 GiB remains a performance objective, not a verified guarantee for every host. Measure on the actual deployment hardware and corpus before publishing those numbers as achieved.

A failed gate leaves the student unpromoted, so `queryEncoder=auto` stays on BGE-M3. The explicit `--force` option bypasses a gate only when intentionally requested and records that fact; forced promotion is not evidence of quality.

## 8. Build and validation

From the repository root:

```sh
bun --cwd packages/learning test
bun --cwd packages/learning run typecheck
```

Native engine, from `packages/learning/native/retrieval`:

```sh
cargo fmt --check
cargo test --offline
cargo clippy --offline -- -D warnings
cargo build --release --offline
```

Python tooling, from `packages/learning/training`:

```sh
pip install -r requirements.txt
python -m py_compile build_dataset.py train.py eval.py export.py promote.py
python smoke_test.py
```

Then run the dataset/training/evaluation workflow in [training/README.md](training/README.md) using the real target `books.db`. Preserve the report and manifest alongside the installed model.

## 9. Verification history and current boundary

The older November 3 plan snapshot recorded 205 learning tests passing, clean TypeScript typecheck, Python syntax checks, a small no-embedding fixture dataset, and a smoke test. Rust validation was initially marked pending in that historical snapshot. Later implementation commits extended the runtime and training pipeline through November 6.

Those historical counts are not proof that the full current source HEAD has been re-tested. Before a release or student promotion, rerun the relevant package tests/typecheck, Rust test/clippy/build, Python checks, and held-out real-corpus evaluation. Check `WORKLOG.md` and `RELEASE_HANDOFF_2026-11-06.md` for the source/runtime provenance boundary.

## 10. Open work

- Complete representative, held-out evaluation against a finished real-book corpus with enough Arabic↔English/French cross-lingual judgements to satisfy each slice's sample floor.
- Compare student and teacher through the same complete retrieval path, including Rust BM25/dense/RRF and gate calibration.
- Measure p50/p95 latency and steady-state RSS on deployment hardware; keep hardware-specific targets labelled as measurements, not universal guarantees.
- Promote and install the student only after all gates and operational checks pass.
- Consider HNSW or other approximate search only if measured library-scale p95 justifies the added dependency and index complexity.
