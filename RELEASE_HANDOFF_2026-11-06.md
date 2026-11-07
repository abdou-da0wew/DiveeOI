# DiveeOI Release and Documentation Hand-off

**Snapshot:** 2026-11-06 16:33 UTC  
**Repository:** `/home/celestial-dev/DiveeOI`  
**Branch:** `dev`  
**Source HEAD at audit start:** `2868dc79b1ab28216048dd2667885785cda65176`  
**Upstream:** `origin/dev` at the same commit  
**Working tree at audit start:** clean

## Executive status

The source checkout is current with `origin/dev` at the observed commit. The repository has newer Targeted Learning and training/evaluation changes than the November 3 release hand-off documents describe.

The systemd service `diveeoi.service` was active when inspected. Its main process was PID `1906414`, started at `2026-11-05 18:54:11 UTC`, listening on port `6050`. The running executable resolved to the configured baseline binary path. The running and on-disk executable hashes matched (`45582ceaae4ad55ef10020c9955d3c87687e7cf1473c76bee4f129e99c84eba7`); the file's modification time was `2026-11-05 12:34:48 UTC`.

The current source HEAD includes commits newer than that binary's modification time. The runtime executable's exact source commit was not independently identified. Treat source revision and running binary provenance as separate facts.

## What changed since the old hand-off

- The Targeted Learning settings flow now carries the retrieval engine (`auto/native/typescript`), query encoder (`auto/student/bge-m3`), and teacher-unload option through the schema/defaults and SDK contract.
- `auto` retrieval prefers the persistent Rust engine when its binary is installed and falls back to the TypeScript implementation when it is not.
- `auto` query encoding only chooses an installed, promoted student; otherwise BGE-M3 remains the encoder. The student contract preserves the existing 1024-dimensional book-vector space.
- The dataset builder now creates a broader set of Arabic, English, and French synthetic query forms grounded in passage headings/spans, while allowing captured real queries.
- Student evaluation and promotion now account for per-tag/per-language slices, cross-lingual sample floors, skipped-slice recording, and book-scoped Rust evaluation.
- ONNX export uses trace-safe manual attention. Egyptian Baccalaureate OCR workers can operate in parallel across pending books, and the Wikipedia corpus builder appends idempotently.
- Targeted Learning settings UI and generated SDK types were updated.

## Verification evidence and limits

The November 3 worklog records a full typecheck (14/14 Turbo tasks), production build, DB/server/app tests, Composer-focused tests, migration checks, and isolated browser QA. Those results predate the November 4–6 commits and are historical evidence, not proof for the current HEAD.

No full monorepo test/typecheck/build was run as part of this documentation refresh. Documentation checks passed: 333 internal Markdown links across 397 maintained Markdown files with zero missing targets; the PDF generators/entrypoints passed Node syntax checks; `git diff --check` passed; all nine user-facing PDF files were regenerated/synchronized, text-extracted, and checked for text outside page bounds. Rendered dark/light contact sheets were visually inspected. Test-fixture PDFs and historical QA/audit captures were preserved as historical inputs. Focused checks and exact file inventory are recorded in `WORKLOG.md`. Do not claim that external provider authentication or quota-cycle tests passed; the earlier verification did not have authorized live provider credentials.

## Operational boundaries

- No service restart, production deployment, DB migration, commit, push, reset, or cleanup was performed as part of this documentation update.
- Do not infer that the running service is built from source commit `2868dc7`; its executable hash and path are verified, but its exact commit provenance is not.
- The November 3 hand-off and Composer incident file are historical snapshots. `CONTEXT.md` is the current working hand-off.
- Before deployment, build from the exact commit intended for release, run the relevant test matrix, check migrations/backups, and obtain explicit user approval before privileged service operations.

## Documentation scope

This refresh updates the public README, project and operational references, Targeted Learning plans/worklogs, PDF source generators, and the generated project PDFs. Vendored upstream prompt/skill references, generated memory nodes, test-fixture PDFs, and explicitly historical engineering/audit records remain historical inputs rather than being rewritten as current implementation guidance.
