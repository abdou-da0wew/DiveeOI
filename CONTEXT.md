# CONTEXT — DiveeOI implementation hand-off

Last updated: 2026-10-29. Branch: `arena/89b197e7-diveeoi` (active; based on `dev` at `6253759`).

This file is the current hand-off snapshot. See `WORKLOG.md` for the chronological record, `DECISIONS.md` for design decisions, and `docs/TARGETED_LEARNING_WORKLOG.md` / `docs/WHATS_DONE.md` for the feature history and inventory. Older test counts in those historical documents are not verification of this branch.

## Verification status — read first

Bun 1.3.14 was installed into `/tmp/diveeoi-tools` for the earlier auth/resource checks. On this branch, Bun 1.4.2
was used for Targeted Learning diagnostics tests and source transpilation. A full workspace install was attempted but could not
verify the GitHub `ghostty-web` tarball certificate; workspace dependencies remain incomplete. Focused diagnostics tests,
selected-module typechecks, source parsing, and `git diff --check` are recorded below. Full package typechecks/builds, browser
runs, and model-backed checks remain unverified. The optional reference-vector `runSelfTest()` fixture is empty until
`tl:selftest:freeze` is run with the pinned model installed; this is separate from Setup's `golden-self-test` step, which
runs the live semantic sanity check and does not require fixture vectors.

## Authentication and security

- The default auth mode is `both`: Basic or JWT is accepted. `DIVEEOI_SERVER_USERNAME` defaults to `DIVEEOI`; the non-production, non-test Basic password defaults to `divee`. Production has no default Basic password; JWT account auth remains enabled unless auth is explicitly disabled.
- `DIVEEOI_*` settings take precedence. `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` remain legacy environment fallbacks only.
- The app has a DiveeOI-themed login/register surface. Basic credentials are entered there, tested against the selected server, and held in memory rather than embedded in the built JS or persisted by the login flow. They are attached only to requests for the matching configured server origin, including direct Targeted Learning fetches. If Basic auth is not accepted, login falls back to JWT account auth. No `WWW-Authenticate: Basic` challenge is emitted, preventing a browser-native credential popup.
- JWT access tokens are memory-only in the browser. Browser login/refresh uses a rotating, revocable, HttpOnly/SameSite cookie and persisted refresh-session rows; headerless non-browser clients retain the JSON refresh-token flow. Access/refresh token purpose is validated separately; account password/email changes revoke refresh sessions. The JWT signing secret is generated in the persistent data directory when not configured; use a stable 32+ character `DIVEEOI_JWT_SECRET` in production.
- The first admin account is claimed through a conditional database insert, preventing two concurrent first registrations from both becoming admin. Registration remains publicly exposed until that first account exists; bootstrap should happen before exposing an uninitialized instance.
- API Bearer injection is restricted to the app origin so account tokens are not forwarded to arbitrary configured remote servers. Basic credentials are origin-scoped separately. A `401` health response is treated as reachable so the themed login can render rather than trapping users on a connection-error screen. The Vite dev server proxies API routes to a configurable backend target.
- Previously shared external credentials should be rotated if they are still active. No credentials are intentionally stored in this repository.

See `docs/security-auth.md` for configuration and operational guidance.

## Adaptive resource system

`packages/db/src/adaptive/` detects host/container resources and selects `comfortable`, `balanced`, `constrained`, or `critical` targets. Linux detection accounts for cgroup v1/v2 memory limits and CPU quotas at the current cgroup and all visible ancestors, plus `/proc/meminfo`; CPU capacity uses `availableParallelism`. Targets scale RSS/heap budgets to available memory, cap queues/caches/concurrency per profile, and recover with hysteresis. The adaptive service refreshes targets periodically; SQLite cache and mmap settings subscribe to updates.

The focused cgroup ancestor/parser tests pass; profile tests and platform-wide resource checks remain unrun.

## Targeted Learning feature

A user can attach an indexed source with `@book:<slug>`. A targeted session retrieves only from the attached books, applies a retrieval gate, and injects cited grounding context. It is self-hosted and runs the pinned embedding model locally after setup.

### Main code map

- `packages/learning` (`@diveeoi/learning`) contains settings, model manifest/downloader, setup state machine, embedding, parsers, OCR, chunking, ingest, SQLite store, retrieval/gating, grounding, student memory, and evaluation/self-test.
- `packages/server/src/server/routes/instance/httpapi/groups|handlers/targeted-learning.ts` wires setup, settings, books,
  ingest-job controls, search inspection, memory APIs, and authenticated `/targeted-learning/debug/status` under
  `/targeted-learning`.
- `packages/learning/src/diagnostics.ts` provides the opt-in redacting JSONL logger, rotating private files, operation
  spans, progress/stall detection, and a status snapshot. HTTP middleware lives in
  `packages/server/src/server/routes/instance/httpapi/middleware/targeted-learning-diagnostics.ts`.
- `packages/server/src/session/prompt.ts` connects `@book:` mentions to targeted-session metadata, retrieval/gating, answer verification, and one repair retry.
- `packages/app/src/components/targeted-learning-*` and the settings-targeted-learning components provide the library, job controls, memory and schema-driven settings surfaces.
- `packages/db/src/v1/config/targeted-learning.ts` provides the global config integration.

### Current implementation details

- Ingest persists job stage/progress/settings checkpoints. Jobs support pause, resume, cancel and retry. Recovery claims are guarded against duplicate in-process workers; cancellation signals an in-flight recovery claim before it can schedule, and pause/resume wait for the claim to settle. Queued/running jobs are recovered at boot by re-reading the stored source, checking its SHA-256 and containment under the library directory, then rebuilding the index from the beginning. Recovery does **not** continue at the exact checkpointed batch. Paused jobs remain paused across a restart.
- OCR progress callbacks may be asynchronous; the OCR loop awaits them so failed checkpoint/progress writes propagate and do not become unhandled promise rejections.
- Setup accepts an `AbortSignal` per step and exposes `cancelSetup`. Cancellation returns an interrupted step to pending, interrupts the setup Fiber (`Fiber.Fiber<unknown, unknown>`), and avoids starting repair/setup while cancellation is still settling. Test added; unrun.
- `grounding.verify = retry` is wired: a failed first citation/grounding verification removes the unverified draft and makes one repair-prompt retry; if that retry still fails, the final answer carries a warning. Retrieved passage IDs are explicitly cleared after final verification and bounded/expired in memory.
- Local-folder model import validates manifest paths and rejects traversal plus symlinks that resolve outside the selected source/destination roots.
- `packages/learning/scripts/freeze-selftest.ts` implements `bun run tl:selftest:freeze` for the pinned int8 model; `packages/learning/src/self-test/golden.json` currently has empty vectors for the optional reference-vector regression self-test. Setup's live semantic sanity check does not depend on those vectors.
- Opt-in runtime diagnostics cover HTTP requests, service/recovery, setup state, downloads, ingest, retrieval/gates, targeted
  chat/model stream, grounding, and settings updates. Flags: `DIVEEOI_TL_DEBUG`, `DIVEEOI_TL_DEBUG_LEVEL`,
  `DIVEEOI_TL_DEBUG_HANG_MS`, `DIVEEOI_TL_DEBUG_MAX_LOG_MB`, `DIVEEOI_TL_DEBUG_FILE`,
  `DIVEEOI_TL_DEBUG_CONTENT`, and `DIVEEOI_TL_DEBUG_CONSOLE`. Diagnostics are off by default; secret-like fields are
  redacted, free-form content/error messages are length-only, and message text is logged only with explicit
  `DIVEEOI_TL_DEBUG_CONTENT=1`. JSONL rotation, test steps, and authenticated status inspection are documented in
  `docs/targeted-learning-debugging.md`.
- Bun 1.4.2's production compiler failure from synchronous `require()` traversing the `@diveeoi/learning/node`
  top-level-await graph is addressed in `packages/server/src/app-services.ts` with static ESM imports. The failure and
  static-import fix passed minimal fixtures and changed-file transpilation; the full server build remains unverified
  without complete dependencies.

### Data on disk

`DIVEEOI_TL_DATA_DIR` (or the app data directory's `targeted-learning/`) holds `books.db`, `books/` source files, `models/`, OCR language data and `setup.json`. Student profile/memory data is stored separately in `student.db`. Keep the data directory on persistent storage; source files are needed for ingest recovery/re-indexing.

## How to verify (on a machine with Bun 1.3.14+ and dependencies)

```bash
# Start in the repository root.
cd packages/learning && bun test test/diagnostics.test.ts && bun test && bun run typecheck
cd ../server && bun run typecheck
cd ../app && bun run typecheck
# Optional pinned-model fixture generation for runSelfTest() (not required by Setup)
cd ../learning && bun run tl:selftest:freeze
```

Then rerun the learning suite and run `scripts/tl-live-check.ts` on a host where the pinned Hugging Face model can be installed. The previous branch documented a server typecheck issue caused by the build-generated `diveeoi-web-ui.gen.ts`; check whether the current build path generates that file before treating it as a source error.

## Latest verification

- `bun test`: 11 focused tests pass across app auth forwarding, browser-vs-non-browser refresh-token transport, and cgroup ancestor/resource parsing.
- Bun `--no-bundle` parsing succeeded for 20 modified TypeScript/TSX files. `git diff --check` and `bash -n scripts/divee.sh` pass.
- The atomic first-admin SQL was exercised with Node 22's built-in SQLite: the first conditional insert returned one admin row and the second returned none.
- Full package tests, typechecks, production builds, browser checks, and model-backed checks remain unverified because the workspace dependency install could not resolve the GitHub `ghostty-web` tarball certificate.
- On the current branch, Bun 1.4.2 ran `packages/learning/test/diagnostics.test.ts`: 7 passed, 0 failed, 36
  expectations. The test used a temporary Effect v4 install under `/tmp`, not a complete workspace install.
- TypeScript native-preview checked `diagnostics.ts`, `setup/state-machine.ts`, `download/index.ts`, the diagnostics test,
  and the HTTP diagnostics middleware with no errors. Bun 1.4.2 `build --no-bundle` transpiled 16 changed TypeScript files
  successfully. `git diff --check` passes.
- Bun 1.4.2's `require()`/top-level-await failure was reproduced in a minimal fixture; static ESM imports, ESM bundling, and changed-file transpilation passed. The full server build is still unverified.

## Remaining verification / caveats

1. Resolve dependency installation, then run the full tests, typechecks and builds for app, API, DB, learning, and server packages. The focused results above do not substitute for typechecking.
2. Optionally freeze and verify golden vectors on the pinned int8 model for reproducible `runSelfTest()` checks; this is not a Setup prerequisite. Model-backed behavior and the live retrieval gate have not been validated here.
3. Run browser checks for the login/register form, Basic and JWT flows, Vite proxy, adaptive-resource updates, setup cancel/repair, and ingest job controls.
4. Exercise job recovery after process restart and inspect the intended full-source replay behavior. Unit additions for the recovery-claim/cancel race, pause/resume, cancellation cleanup and unsafe source paths are still unrun.
5. Route-test coverage still needs a current run; the previous worklog recorded missing HTTP API scenarios for many routes, including Targeted Learning.
