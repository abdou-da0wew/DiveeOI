# CONTEXT — DiveeOI implementation hand-off

Last updated: 2026-10-30. Branch: `arena/40d798db-diveeoi` (active; based on `dev` at `989d1287cff175f522a69f0aa895899364b97dcc`). Draft PR #6 is open against `dev`.

This file is the current hand-off snapshot. See `WORKLOG.md` for the chronological record, `DECISIONS.md` for design decisions, and `docs/TARGETED_LEARNING_WORKLOG.md` / `docs/WHATS_DONE.md` for the feature history and inventory. Older test counts in those historical documents are not verification of this branch.

## Verification status — read first

Bun 1.3.14 was used via `npx` for the current skill work. A temporary filtered install enabled focused DB/server tests and SDK generation; the full workspace install remains incomplete because GitHub certificate validation failed while resolving `ghostty-web`. The DB skill tests pass (8 tests / 42 expectations), the server skill/command/system tests pass (20 / 57), and the SDK generation/typecheck passes. DB package typecheck still reports 69 errors in existing files, with no diagnostics in the changed skill files; server typecheck was SIGKILLed without diagnostics. Licensing clearance for adapted content from the unlicensed `zcode-skills` repository is still pending; PR #6 remains draft and must not be merged/released before clearance. Earlier Targeted Learning diagnostics, source parsing, and `git diff --check` results are recorded below. Full package builds, browser runs, and model-backed checks remain unverified. The optional reference-vector `runSelfTest()` fixture is empty until `tl:selftest:freeze` is run with the pinned model installed; this is separate from Setup's `golden-self-test` step, which runs the live semantic sanity check and does not require fixture vectors.

## Authentication and security

- The default auth mode is `both`: Basic or JWT is accepted. `DIVEEOI_SERVER_USERNAME` defaults to `DIVEEOI`; the non-production, non-test Basic password defaults to `divee`. Production has no default Basic password; JWT account auth remains enabled unless auth is explicitly disabled.
- `DIVEEOI_*` settings take precedence. `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` remain legacy environment fallbacks only.
- The app has a DiveeOI-themed login/register surface. Basic credentials are entered there, tested against the selected server, and held in memory rather than embedded in the built JS or persisted by the login flow. They are attached only to requests for the matching configured server origin, including direct Targeted Learning fetches. If Basic auth is not accepted, login falls back to JWT account auth. No `WWW-Authenticate: Basic` challenge is emitted, preventing a browser-native credential popup.
- JWT access tokens are memory-only in the browser. Browser login/refresh uses a rotating, revocable, HttpOnly/SameSite cookie and persisted refresh-session rows; headerless non-browser clients retain the JSON refresh-token flow. Access/refresh token purpose is validated separately; account password/email changes revoke refresh sessions. The JWT signing secret is generated in the persistent data directory when not configured; use a stable 32+ character `DIVEEOI_JWT_SECRET` in production.
- The first admin account is claimed through a conditional database insert, preventing two concurrent first registrations from both becoming admin. Registration remains publicly exposed until that first account exists; bootstrap should happen before exposing an uninitialized instance.
- API Bearer injection is restricted to the app origin so account tokens are not forwarded to arbitrary configured remote servers. Basic credentials are origin-scoped separately. A `401` health response is treated as reachable so the themed login can render rather than trapping users on a connection-error screen. The Vite dev server proxies API routes to a configurable backend target.
- Previously shared external credentials should be rotated if they are still active. No credentials are intentionally stored in this repository.

See `docs/security-auth.md` for configuration and operational guidance.

## Embedded skills and metadata

- Current draft PR: [#6](https://github.com/abdou-da0wew/DiveeOI/pull/6) on `arena/40d798db-diveeoi`; the initial implementation is commit `30a2dbf` and the validated code/test/SDK follow-up is commit `858a1f0`.
- The DB plugin registers 19 curated embedded skills from `packages/db/src/plugin/skill/bundled/`, with 85 static text resource imports. `SkillV2` parses category/tags/version/author/license/compatibility, links and source provenance, triggers/requirements, allowed tools, argument hints, invocation flags, and unknown attributes. Embedded resources are path-validated and materialized in the global cache by the DB/server skill tools.
- The server V1 skill adapter uses the DB plugin's pure `SkillPlugin.embeddedSources()` catalog, avoiding a second PluginBoot instance while exposing the same metadata and resource files. Slash-command generation respects `slash` and `user-invocable`, and command responses include `argumentHint`.
- API/OpenAPI/SDK synchronization was run with `cd packages/sdk && bun ./script/build.ts`; generated client types include skill metadata/source and command argument hints. SDK TypeScript compilation passes. Codegen also synchronized previously stale Targeted Learning endpoints.
- **Licensing gate:** `abdou-da0wew/zcode-skills` has no root license and redistribution authorization for remaining adapted upstream content is unresolved. PR #6 is draft only. Do not merge or release until cleared. Source `charts`, `docx`, `pdf`, and `xlsx` trees with non-commercial-only terms were excluded and replaced by original DiveeOI guides; applicable Apache license copies are included.
- Focused validation: DB skill/plugin/tool/config tests pass (8 tests, 42 expectations); server skill/command/system tests pass (20 tests, 57 expectations). DB full typecheck has 69 diagnostics in existing files but none in the changed skill files. The full server typecheck was SIGKILLed, while the restricted check timed out after about five minutes without diagnostics; see the PR for details.

## Memory system status

- Server integration source is present: prompt assembly passes the latest user message and active worktree into memory recall, scopes text search and graph traversal to the project, ranks query-matched/session-linked memories by relevance and importance, and injects up to eight escaped durable records. New manual and extracted memories inherit project metadata and link to the session root. Extraction is detached at prompt/compaction exits; an initial/daily extraction scheduler and eight tools are registered. The normal session-create path does not eagerly call `initializeSessionMemory`.
- `packages/memory` tests pass (2 tests, 16 expectations), including query ranking, session-root linking, project-scoped recall, and escaped reference-only prompt injection. Memory typecheck reports errors in unchanged DB adaptive/database files and `packages/memory/src/index.ts`; the server typecheck process was SIGKILLed without diagnostics. Server boot/runtime behavior and full create→link→retrieve→update→delete coverage remain unverified; see `plans/MemoryPlan/MEMORY_SERVER_INTEGRATION_PLAN.md`.
- Daily scheduler work is extraction, not consolidation. The consolidation service and manual tool exist, but scheduled `runMaintenance()` is not wired.
- `packages/memory/src/consolidation.ts:194–265` has a potential merge atomicity/data-loss risk: duplicate nodes/links are modified or deleted before the primary update, without an enclosing transaction. This was not addressed in the memory/prompt implementation.

## Self-hosted CI runner — Go implementation in progress

- Standalone runner source: `tools/self-hosted-ci/`; operator/VPS guide: `tools/self-hosted-ci/README.md`; example systemd unit: `tools/self-hosted-ci/deploy/diveeoi-ci.service`.
- Current design is Linux + local Docker (rootless strongly recommended), generic Git remotes with polling, selected branch/tag patterns, repository YAML workflows, per-job environment, encrypted per-repository secrets with trusted-ref gating, stream log redaction, and explicit retained artifacts. This is an early MVP, not a GitHub Actions-compatible or hosted service.
- Added the DiveeOI monorepo pipeline at `.diveeoi/pipeline.yml`: frozen Bun install, Targeted Learning tests, app/server typechecks, `build:nobin`, and retention of `packages/app/dist`. Equivalent starter pipeline/config are under `tools/self-hosted-ci/examples/`.
- CLI includes `daemon`, `check`, `validate`, `status`, `logs`, `artifacts`, `run`, and `secret set/list/delete`. Work state and vault are stored in the configured private storage directory; Docker logs are bounded, declared artifacts have size/file-count limits and retention, and completed run workspaces are cleaned.
- **Verification is incomplete:** this sandbox has no Go toolchain (`go`, native `gofmt`, and `gccgo` are absent), so no Go compilation, `go test`, or `go vet` has run. All 29 `.go` files were formatted with a WASM build of gofmt and accepted by Tree-sitter; that checks formatting/syntax only, not Go type correctness. The systemd unit passed `systemd-analyze verify` with `/bin/true` substituted for the not-yet-built binary, but service startup was not exercised. Docker/Podman are also absent, so no container or VPS integration test has run. Install Go 1.22+ and Docker on a staging Linux host, then run `cd tools/self-hosted-ci && gofmt -w $(find cmd internal -type f -name '*.go') && go test ./... && go vet ./... && mkdir -p bin && go build -o ./bin/diveeoi-ci ./cmd/diveeoi-ci`; follow the README for `check`, pipeline validation, a manual run, logs, and artifact inspection. Treat the implementation as unverified until those checks pass.

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
- Current startup-fix follow-up: moved the shared `JwtAuth.defaultLayer` provider around the full merged HTTP route tree
  because several route-specific auth middleware layers depend on it. Bun 1.4.2 `build --no-bundle` transpilation and
  `git diff --check` pass; full server startup is not verified in this dependency-free workspace.
- Memory/prompt work: Bun 1.4.2 `packages/memory` tests pass (2 tests, 10 expectations); TypeScript syntax parsing passed for 13 changed `.ts` files. Memory typecheck reports existing errors in `packages/db/src/adaptive/detect.ts`, `packages/db/src/database/database.ts`, and `packages/memory/src/index.ts`. Server typecheck was SIGKILLed after about 9 minutes without diagnostics. A filtered server dependency install also failed while `tree-sitter-powershell` tried to download Node headers; full server typecheck/runtime checks remain pending.

## Remaining verification / caveats

1. Resolve dependency installation, then run the full tests, typechecks and builds for app, API, DB, learning, and server packages. The focused results above do not substitute for typechecking.
2. Optionally freeze and verify golden vectors on the pinned int8 model for reproducible `runSelfTest()` checks; this is not a Setup prerequisite. Model-backed behavior and the live retrieval gate have not been validated here.
3. Run browser checks for the login/register form, Basic and JWT flows, Vite proxy, adaptive-resource updates, setup cancel/repair, and ingest job controls.
4. Exercise job recovery after process restart and inspect the intended full-source replay behavior. Unit additions for the recovery-claim/cancel race, pause/resume, cancellation cleanup and unsafe source paths are still unrun.
5. Route-test coverage still needs a current run; the previous worklog recorded missing HTTP API scenarios for many routes, including Targeted Learning.
