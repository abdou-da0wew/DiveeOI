# CONTEXT — Targeted Learning (RAGed-Session) state for agent hand-off

Last updated: 2026-10-29. Branch: `dev`. See also `WORKLOG.md` (what happened) and `DECISIONS.md` (why).
Older, longer notes: `docs/TARGETED_LEARNING_WORKLOG.md` (previous agent), plan doc "Targeted Learning (RAGed-Session) — Implementation Plan" (Claude Doc shared with the owner).

## What the feature is
A session type: the student mentions an indexed book with `@book:<slug>` and the agent then answers only from the attached books. Self-hosted, no Python, no cloud calls after the one-time model download.

## Architecture (all in the DiveeOI Bun monorepo)
- `packages/learning` (`@diveeoi/learning`) — everything that is not wiring:
  - `manifest/` pinned manifest (`pinned.ts`, `types.ts`): Xenova/bge-m3 @ `4de1325…`, sizes + sha256 for tokenizer.json and the int8/q4f16/fp16/fp32 ONNX files. Three tiny JSON files are pinned by commit only (size 0 / sha256 "").
  - `download/` resumable, hash-verified downloader (`downloadManifest`, `verifyManifestFiles`, `importFromLocalFolder`).
  - `setup/` state machine (`state-machine.ts`, persisted in `<dataDir>/setup.json`) and real steps (`steps.ts`: runtime check, semantic self-test, benchmark).
  - `embed/` Transformers.js pipeline (`pipeline.ts`), lazy bootstrap (`ensure.ts`), worker entry (`worker.entry.ts`).
  - `ingest/` `run.ts` (queue → parse → [OCR] → chunk → embed → books.db), `embed-pool.ts` (N Bun Workers).
  - `parsers/`, `chunk/` (parent/child, heading-aware), `lang/arabic.ts` (normalizer), `ocr/` (`index.ts` page-image extraction + tesseract.js, `pack.ts` pinned ara/eng tessdata).
  - `store/` books.db (FTS5 + vectors as base64 BLOB text), degraded-mode handling.
  - `retrieve/` hybrid BM25 + dense + RRF, gate (`gate.ts`).
  - `session/turn.ts` — `attachBookMentions`, `prepareTargetedTurn` (retrieval + gate + grounding + memory injection), `inspectRetrieval`.
  - `grounding/` prompt rules, `turn-state.ts` (passages shown this turn), `post.ts` (citation verifier note).
  - `memory/service.ts` — student memory (`<dataDir>/student.db`) and book notes (`book_notes` in books.db).
  - `settings/` schema → defaults, JSON schema, presets, `validate.ts`.
  - `runtime.ts` — process-wide handle (books store, model dir, user settings) set by the service layer.
- `packages/server`:
  - `src/server/routes/instance/httpapi/groups|handlers/targeted-learning.ts` — routes under `/targeted-learning` (health, probe, setup*, settings*, books (+upload/import/delete), memory*, search).
  - `src/session/prompt.ts` — 3 hooks: `@book:` → sticky `session.metadata.targetedLearning`; per-turn retrieval/gate (refusal answered without calling the LLM); post-answer citation verification.
  - `src/session/tools.ts` — tool allowlist for targeted sessions; `book_*` / `student_memory_*` tools hidden elsewhere.
  - `src/tool/learning/*` — `book_outline|search|read_section|find_term`, `memory-tools.ts` (`student_memory_*`, `book_note_*`).
- `packages/app/src/components/` — `settings-targeted-learning.tsx` (v1) and `settings-v2/targeted-learning.tsx` (v2) mount shared `targeted-learning-library|memory|settings-form.tsx`. The settings form is generated from `GET /targeted-learning/settings/schema`.
- `packages/db/src/v1/config/targeted-learning.ts` — config key `targetedLearning` (global config layer).

## Data on disk (`<dataDir>` = `DIVEEOI_TL_DATA_DIR` or the app data dir + `/targeted-learning`)
`models/Xenova/bge-m3/…` (model + tokenizer), `books.db`, `books/<hash>.<ext>` (source files), `student.db`, `ocr/*.traineddata`, `setup.json`.

## How to run / test
- Dev server: `cd packages/server && bun run --conditions=browser ./src/main.ts` (port 4097; `PORT` env). Project pins Bun 1.3.14.
- Learning tests: `cd packages/learning && bun test` (162 pass; 1 expected failure `embed pipeline (live)` needs HF access). OCR test: `TL_TEST_TESSDATA=<dir with ara/eng.traineddata> bun test test/ocr.test.ts`.
- Typecheck: learning `bun x tsc --noEmit -p .`; server/app with `node …/typescript/bin/tsc --noEmit -p .` (server shows one error: missing build-generated `diveeoi-web-ui.gen.ts`, not a code problem).
- **Real-model check + gate calibration (needs a host that reaches huggingface.co):** `BASE=http://127.0.0.1:4097 bun scripts/tl-live-check.ts [--dtype int8] [--apply] [--keep]`.

## Status
Done and tested with stand-in embedders / local server smoke tests: setup pipeline code, downloader (fault-injected), ingest + 2-worker pool, mentions → targeted mode, gate, grounding, memory + notes, verifier, OCR (EN+AR synthetic scan), settings (persist, per-section merge, server-side validation), library/memory/settings UI (typechecks only).

**Never run against the real model**: nothing in this repo has been executed with real bge-m3 weights (the agent sandbox cannot reach huggingface.co or the owner's VDS). First action for the next agent/owner: run `scripts/tl-live-check.ts` on the VDS.

## Remaining / known issues
1. Live run on real bge-m3 (all dtypes: int8 default; q4f16/fp16/fp32 manifest entries added but **load is unverified**, esp. fp32 external `model.onnx_data` via Transformers.js).
2. Gate threshold `gate.minDenseScore = 0.35` is uncalibrated — `tl-live-check.ts --apply` computes and applies one.
3. `bun run test:httpapi` (coverage mode) reports 49 routes without scenarios, incl. all `/targeted-learning` routes (pre-existing gap, not fixed).
4. Not built: pause/cancel/resume of indexing jobs; `grounding.verify = retry` (acts as `flag`); LLM summaries; multiple student profiles (`student_id` column exists, one `default` profile); formula/LaTeX OCR; rotated or vector-only scanned pages; `ocr.dpi` has no effect (embedded image is used as is).
5. UI components were typechecked but never opened in a browser.
6. Secrets: a GitHub PAT and a VDS password were pasted in chat by the owner; they must be rotated. Nothing secret is in the repo.
