# Learning Package (@diveeoi/learning)

Targeted Learning is the server-integrated book ingestion, retrieval, grounding, and student-memory subsystem. Read this file and [README.md](README.md) before changing the package.

## Core contracts

- BGE-M3 produces the indexed passage vectors. The chat query encoder must emit the same 1024-dimensional CLS-pooled, L2-normalised space.
- Do not change vector dimensionality, tokenizer semantics, pooling, normalisation, or query length without updating the student contract and proving compatibility with every existing book index.
- `retrieval.queryEncoder=auto` may select only an installed student whose manifest records successful promotion. Do not treat the presence of model files as successful promotion.
- `retrieval.engine=auto` prefers the Rust engine when available and otherwise falls back to the TypeScript implementation. Keep their hit/score contract aligned.
- The Rust process is a retrieval engine, not an embedding runtime. Query embedding, rewriting, gate policy, and parent expansion remain in TypeScript.
- Keep book-library storage (`books.db`) and student memory (`student.db`) separate from the core application DB.
- Treat generated evaluation reports, captured queries, and diagnostic content as user/course data. Do not silently upload them or enable content logging.

## Scope boundaries

- Runtime feature implementation lives in `src/`.
- Native retrieval lives in `native/retrieval/`; use its README for build and serve contracts.
- Offline training/corpus tooling lives in `training/`; it does not run in the normal app process.
- Feature HTTP routes are server-owned under `packages/server/src/server/routes/instance/httpapi/groups/targeted-learning.ts`.
- Settings are defined in `src/settings/schema.ts` and `src/settings/defaults.ts`; update both inferred/runtime behavior and generated SDK contracts when the schema changes.

## Validation

```bash
bun --cwd packages/learning test
bun --cwd packages/learning run typecheck
cd packages/learning/native/retrieval
cargo fmt --check
cargo test --offline
cargo clippy --offline -- -D warnings
```

For Python changes, use the local training requirements and run `python -m py_compile` on changed scripts plus the relevant CPU smoke/dataset checks. Do not claim the student is production-ready from toy smoke tests; promotion is driven by held-out retrieval evaluation and the generated manifest.
