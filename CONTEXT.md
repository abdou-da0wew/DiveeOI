# CONTEXT — DiveeOI current engineering hand-off

- **Snapshot:** 2026-11-20
- **Repository:** `/home/ababado/DiveeOI-ai-learning-update`
- **Branch:** `dev`
- **Source baseline:** `51e3c91` (the `dev` revision before this implementation and commit series)
- **Runtime used for this pass:** Bun `1.4.4`; Node.js runtime available in the workspace

This file is the current source and verification hand-off. `WORKLOG.md` remains chronological, `CHANGELOG.md` records release-facing changes, and `DECISIONS.md` records durable technical choices. Previous deployment observations are historical and remain in the dated release hand-offs; do not infer the current running service version from this checkout.

## Repository and deployment state

- The working tree contained several independent feature areas when this pass resumed. All edits were preserved and split into category-specific commits on `dev`; the commit breakdown and verification boundaries are recorded in `WORKLOG.md`.
- This source pass includes expanded Rich UI parsing/rendering (Learning and platformer components), exam validation, more conservative Targeted Learning resource/grounding policy, bounded workspace indexing, and both inbound and outbound SSH work. Outbound Remote Sessions provide server-owned OpenSSH discovery, encrypted shared profiles, strict `known_hosts` verification, host-aware per-session context, SFTP discovery/writes, agent-tool routing, and Settings/session attach UI. See `docs/remote-sessions.md`.
- Remote profiles and SSH key material belong to the DiveeOI server account. Profiles are server-wide for the instance, not isolated by browser account. Secrets are encrypted with AES-256-GCM and an owner-only key file; back up both files together.
- Host keys are verified against the server account's OpenSSH `known_hosts` file. Unknown or changed keys fail closed. Do not disable this check or treat unverified `ssh-keyscan` output as trusted.
- The tracked `.githooks/commit-msg` hook is enabled in this checkout with `core.hooksPath=.githooks`; it adds DiveeAgent's GitHub noreply co-author trailer exactly once. See `.githooks/README.md`.
- Verification: server and app typechecks passed; the focused remote suite passed 7 tests / 21 assertions; the live local-SSH smoke passed; Oxlint and Biome focused checks passed. A direct one-worker browser run passed both Remote Sessions specs earlier, but the final isolated-port package-script retry was not confirmed. The Vite production app build did not complete; the native single-target server build had passed in an earlier run before the last verification refinements. See `WORKLOG.md` for exact boundaries.
- The app's Vite/Playwright proxy defaults to backend port `4097` and uses `VITE_DIVEEOI_SERVER_HOST` / `VITE_DIVEEOI_SERVER_PORT`.
- The commit series is published on `origin/dev`. No production deployment, database migration, or service restart was performed; never infer deployment from local source or build output.

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
