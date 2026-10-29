# WORKLOG — Targeted Learning (newest last)

## 2026-10-26/27 — previous agent
Built `packages/learning` skeleton, settings schema, download/state-machine, store, parsers, chunker, retrieval, gate, tools, settings UI placeholders. Details: `docs/TARGETED_LEARNING_WORKLOG.md`.

## 2026-10-27 — review + first fixes (commit b788e8d, 5f79c1d, 59b8f19)
- Review found the feature not wired: `prompt.ts` untouched, mode never set, gate/verifier unused, no ingest orchestrator, setup reported Ready without the model, fake pinned revision.
- Fixed: real pinned manifest (rev 4de1325, hashes from HF pointer files); downloader (Range ignored → restart, streaming hash, unpinned small files); `int8` dtype → `model_int8.onnx`; real setup steps run in background; ingest orchestrator + upload/import/delete routes; `@book:` mention → sticky targeted mode; pre-retrieval + gate + grounding prompt, refusal without LLM; book tools only in targeted sessions; book-search gate no longer hardcoded open; Library UI.
- Tests: ingest→mention→gate e2e with a stand-in embedder; downloader fault injection (ignored Range, 503, bad hash, unpinned, missing).

## 2026-10-28 — five missing pieces (commits b3a9c94, b1d4e4a, 09f4282)
- Student memory (`student.db`) + book notes + 4 tools, injection per turn, guards (caps, dedupe, ≤3 writes/turn, citations validated, stale on hash change).
- Citation verifier after answers; tools record passages shown (`turn-state.ts`).
- Embedding worker pool (2 workers/book), length-bucketed batches, in-process fallback. Bug found: pool `close()` left in-flight jobs pending → hang; fixed.
- Bug found: chunks referenced a non-existent base section id for split sections (FK failure) → fixed in chunker.
- Settings: schema-driven form for all sections, memory manager UI, memory endpoints; settings PATCH made per-section merge.
- OCR: pinned tessdata (tessdata_fast @ 87416418…), tesseract.js; pdf.js render crashed Bun (1.3.14 and 1.4.4) → extract embedded page image instead; pdf.js no longer detaches caller's buffer. Verified EN+AR synthetic scan on both Bun versions.
- Commands used: `bun test`, `bun x tsc --noEmit -p .`, local server boot with `PORT=4197 DIVEEOI_TL_DATA_DIR=/tmp/dv-tl bun run --conditions=browser ./src/main.ts`.

## 2026-10-29 — hardening + hand-off (this commit)
- Server typecheck: 14 → 1 error (remaining one is the build-generated `diveeoi-web-ui.gen.ts`). Fixed `Effect.tryPromise({catch: () => fallback})` misuse (turned DB errors into failures carrying an array) across book tools, book-mentions and the books handler; error types on import-local; tool `metadata` typing.
- Manifest: added q4f16, fp16, fp32 (`model.onnx` + `model.onnx_data`) with real sizes/sha256 (HF pointer files). **Loading these dtypes is untested.**
- Added `POST /targeted-learning/search` (retrieval inspector: gate decision, best scores, thresholds, top passages) and exposed `bestDenseScore/bestFusedScore` from `retrieve()`.
- Local server smoke test (no HF access): health, settings GET/PATCH, schema, upload (fails with "model not downloaded, run Start Setup"), memory, search, setup start (download step running). Found and fixed: settings PATCH wrote to a project-local file and never took effect → now `updateGlobal` + `refresh`, merges per section; server now rejects out-of-range values (`settings/validate.ts`).
- `scripts/tl-live-check.ts`: setup → upload EN/AR books → real gate scores → threshold recommendation (`--apply`) → pass/fail table. Dry-run here fails cleanly (no model), as expected.
- Attempted to use the owner's VDS (5.83.153.107) for live testing: port 22 not reachable from the agent sandbox (egress limited to an allowlist, no ssh client). Not bypassed. Live test left to the owner via the script above.
- `bun run test:httpapi` coverage: 49 routes without scenarios (all TL routes + others, pre-existing) — not addressed.
- Tests: learning 162 pass / 1 expected fail (needs HF); server tsc 1 generated-file error; app tsc 0 errors.
