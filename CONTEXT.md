# CONTEXT — DiveeOI current engineering hand-off

- **Snapshot:** 2026-11-06
- **Repository:** `/home/celestial-dev/DiveeOI`
- **Branch:** `dev`
- **Source HEAD at audit start:** `2868dc79b1ab28216048dd2667885785cda65176`
- **Upstream:** `origin/dev` at the same commit
- **Runtime:** Bun `1.3.14`, Node `22.22.1` (observed during this documentation audit)

This file is the current hand-off. The previous November 3 release snapshot is historical; see `RELEASE_HANDOFF_2026-11-06.md` for the current repository/runtime distinction. `WORKLOG.md` remains chronological, `DECISIONS.md` records durable technical choices, and `docs/TARGETED_LEARNING_WORKLOG.md` records the learning subsystem's implementation history.

## Repository and deployment state

- At the start of this documentation refresh, the working tree was clean and `dev` matched `origin/dev`. The documentation changes made in this pass are intentional working-tree edits; do not reset or clean them.
- The latest source commits are from November 5–6. The most recent commit at audit start is `2868dc7` (SDK generated types expose the retrieval-engine, query-encoder, and teacher-unload settings).
- `diveeoi.service` is active. The observed main PID was `1906414`, started at `2026-11-05 18:54:11 UTC`, with its configured executable at `packages/server/dist/@diveeoi/server-linux-x64-baseline/bin/diveeoi` and listener on `0.0.0.0:6050`.
- The running executable and the on-disk executable had the same SHA-256 at inspection: `45582ceaae4ad55ef10020c9955d3c87687e7cf1473c76bee4f129e99c84eba7`. The file modification time was `2026-11-05 12:34:48 UTC`.
- The checkout contains source commits newer than that binary's modification time. The binary hash is verified, but its exact source commit was not embedded or independently proven. Do not state that the running service is built from `2868dc7`.
- A separate process was listening on `0.0.0.0:4097` during inspection. It was not changed or stopped as part of this documentation task.
- No service restart, deployment, database migration, commit, push, or cleanup was performed during this documentation refresh.

## Targeted Learning — current implementation

- The feature lives in `packages/learning`; the server mounts its API under `/targeted-learning`, and the SDK exposes the configuration contract.
- Book indexing uses the pinned BGE-M3 teacher to create passage vectors. The query-time contract remains 1024-dimensional, CLS-pooled, and L2-normalised so a distilled student can query existing indexes without re-embedding books.
- Query encoder policy is `auto | student | bge-m3`. `auto` selects a student only when an installed student manifest is marked promoted; otherwise it uses BGE-M3. `unloadTeacherAfterIndexing` defaults to `true`, while still respecting a chat configuration that explicitly needs the teacher.
- Retrieval engine policy is `auto | native | typescript`. `auto` uses the native Rust engine when its binary is installed and otherwise uses the TypeScript path. Both use the same retrieval contract. The Rust child is persistent NDJSON, not a per-query process; TypeScript retains policy decisions such as query rewriting, gate checks, and parent expansion.
- The native engine supports FTS5/BM25, dense cosine over stored vectors, reciprocal-rank fusion, pre-top-K score reporting, persistent `--serve`, evaluation, and additive vector BLOB compaction. BLOB storage remains compatible with the older base64-text vector column.
- The training toolkit builds query/teacher-target datasets, supports captured real queries, creates a larger Arabic/English/French synthetic query pool from passage text without inventing facts, trains and exports the student, evaluates held-out retrieval slices, and promotes only when the promotion gates pass.
- Evaluation now records per-tag and per-language-pair metrics, uses a cross-lingual sample floor, records skipped slices in the promotion manifest, and passes the selected book IDs into Rust-engine evaluation. ONNX export uses trace-safe manual attention. Egyptian Baccalaureate corpus OCR workers can run in parallel across pending books, and the Wikipedia corpus builder appends idempotently.
- The app settings UI exposes the retrieval engine, query encoder, and teacher-unload controls in the Targeted Learning settings flow. The generated SDK types were refreshed in `2868dc7`.
- A training toolkit or a promotion mechanism does not prove a promoted student is installed. Check the local `divee-student.json` manifest and evaluation report before making a deployment claim.

## Composer/provider incident

`COMPOSER_INCIDENT_HANDOFF.md` remains the detailed historical incident analysis for catalogue visibility, routing safety, provider credentials, quota cooldowns, settings parity, and the preferences composite-key fix. It is not the current release-status document. The isolated no-route browser QA and November 3 full verification evidence remain under `docs/qa/` and `WORKLOG.md`. Real upstream provider authentication/quota-cycle checks were not completed in that verification because authorized external credentials were unavailable.

## Verification boundaries

- The most recent recorded full monorepo typecheck, production build, and DB/server/app suite results are in the November 3 section of `WORKLOG.md`.
- Source changes landed after that verification, including November 4 settings/UI and ingestion work and November 5–6 training/evaluation/SDK changes. Those later commits must not inherit the November 3 test counts by implication.
- This documentation pass does not claim that the entire test matrix was rerun. Any new focused checks performed during this refresh are recorded in the November 6 worklog entry and release hand-off.
- Before a production rollout, rebuild from the exact source commit being deployed, run the relevant checks, verify database backups/migrations, and obtain explicit approval before privileged service operations.
