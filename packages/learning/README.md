# @diveeoi/learning

Targeted Learning is the book-grounded retrieval and student-memory subsystem used by the DiveeOI server. This package owns document ingestion, parsers and OCR, chunking, BGE-M3 embeddings, SQLite library storage, hybrid retrieval, relevance gating, grounding verification, diagnostics, and student memory.

It is not a separate server. The main application integrates it through the learning service/runtime and mounts its workspace-aware HTTP routes under `/targeted-learning`.

## Runtime architecture

- **Indexing:** the pinned BGE-M3 teacher embeds extracted book passages into a 1024-dimensional vector space.
- **Query encoding:** `targetedLearning.retrieval.queryEncoder` accepts `auto`, `student`, or `bge-m3`. In `auto`, the lightweight student is used only when its installed `divee-student.json` manifest marks it promoted. Otherwise BGE-M3 is retained.
- **Retrieval:** `targetedLearning.retrieval.engine` accepts `auto`, `native`, or `typescript`. The Rust engine performs FTS5/BM25, dense cosine, and RRF. TypeScript fallback preserves the same hit contract.
- **Policy:** query rewriting, relevance gating, parent-context expansion, session routing, and grounding checks remain in TypeScript.
- **Teacher lifecycle:** `unloadTeacherAfterIndexing` defaults to true and releases the indexing model once its queue drains, unless active chat still needs it.

The student contract is 1024 output dimensions, CLS pooling, L2 normalisation, the BGE-M3 tokenizer, and a maximum query length of 128 tokens. Existing book vectors are not re-embedded when a compatible student is installed.

## Data stores

The feature keeps its stores outside the main application database:

| Path | Owns |
|---|---|
| `books.db` | Books, sections, chunks, vectors, ingest state and book notes |
| `student.db` | Student profile and learning memories |
| `setup.json` | Setup step state |
| `books/` | Optional retained source documents for re-indexing |
| `models/` | BGE-M3 assets and installed student runtime |
| `logs/` | Opt-in Targeted Learning JSONL diagnostics |

The data directory can be selected with `DIVEEOI_TL_DATA_DIR`; otherwise the service resolves it under the application data directory. Back up this directory separately from the core DiveeOI application data.

## Package map

- `src/manifest`, `src/download`, `src/setup`: pinned model manifest, verified downloads, setup lifecycle.
- `src/parsers`, `src/ocr`, `src/chunk`: source extraction, PDF OCR, chunk construction.
- `src/embed`, `src/ingest`: teacher/student embedding selection and resumable ingest jobs.
- `src/store`: books database schema and persistence.
- `src/retrieve`: lexical/dense retrieval integration, native-engine client, fallback and policy.
- `src/grounding`, `src/session`: prompt constraints, per-turn evidence state and verification.
- `src/memory`: student memory and book notes.
- `src/settings`, `src/probe`, `src/diagnostics`: validated settings, resource probes, runtime diagnostics.
- `native/retrieval`: Rust retrieval executable and tests.
- `training`: offline dataset creation, distillation, evaluation and promotion scripts.

## Commands

From the repository root:

```bash
bun --cwd packages/learning test
bun --cwd packages/learning run typecheck
bun --cwd packages/learning run tl:manifest
bun --cwd packages/learning run tl:selftest:freeze
```

Native retrieval:

```bash
cd packages/learning/native/retrieval
cargo fmt --check
cargo test --offline
cargo clippy --offline -- -D warnings
cargo build --release --offline
```

Offline model training and corpus preparation are documented separately in [training/README.md](training/README.md). For runtime settings and operator workflows, see [the Targeted Learning guide](../../docs/targeted-learning.md).
