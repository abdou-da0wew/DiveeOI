# Query encoder plan — historical rationale

**Status:** Superseded by [Retrieval V2 plan](../../RETRIEVAL_V2_PLAN.md), reviewed 2026-11-06.

This file is retained as the original design rationale for the query-encoder work. It is not the current implementation or execution checklist. The implementation has since added:

- `auto | student | bge-m3` query-encoder selection with promotion-manifest checks and teacher unloading.
- `auto | native | typescript` retrieval-engine selection.
- Persistent Rust NDJSON serving, a TypeScript process client, diagnostics, and fallback.
- Additive vector BLOB storage/compaction and engine-level evaluation.
- An offline training toolkit for dataset generation, student training, ONNX export, sliced/cross-lingual evaluation, and promotion.

Use [the current plan](../../RETRIEVAL_V2_PLAN.md) for the runtime contract, status table, promotion gates, validation commands, and open work. Use the [native engine README](README.md) for Rust-specific build/serve/compact details.
