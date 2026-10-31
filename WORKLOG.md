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

## 2026-10-29 — auth/security, adaptive resources, and Targeted Learning hardening (current Arena branch)

- **Auth/security:** added Basic/JWT/both/disabled modes with `DIVEEOI_*` precedence and `OPENCODE_*` legacy fallbacks; the default server username is `DIVEEOI`, and `divee` is only the non-production/non-test Basic password fallback. Added persisted refresh-session rotation/revocation, JWT access-vs-refresh purpose/audience checks, safer signing-key creation/permissions and malformed-key archival. Removed the tracked runtime signing-key files and ignored generated JWT keys.
- **Browser auth:** built a themed login/register panel with credential inputs; Basic credentials are entered by the user and kept in memory, not embedded into the frontend bundle or stored by the login flow. The login attempts Basic health auth then JWT account login. Removed the `WWW-Authenticate: Basic` challenge. Basic credentials are attached only to matching configured server origins (including direct Targeted Learning calls); account Bearer injection is restricted to app-origin requests, and ambient cookies default to same-origin. A protected `401` health response is treated as reachable so the login route can render. Vite proxies API/WebSocket routes to a configurable backend.
- **Production operations:** Docker persists `DIVEEOI_DATA_DIR=/data` so a generated JWT key survives restarts. Its protected health endpoint may return `401` in production, so the image liveness check now considers a 401 healthy. Updated `.env.example` and security/deployment docs.
- **Adaptive resources:** Linux detection now accounts for cgroup v1/v2 memory limits and CPU quotas (including common `cpu,cpuacct` mount layout); CPU counts respect quotas. Revised profile budgets/targets and upgrade hysteresis; SQLite cache/mmap values subscribe to profile updates. Added profile tests (unrun).
- **Targeted Learning:** wired persisted ingest-job checkpoints with pause/resume/cancel/retry, startup recovery and path/hash validation; recovery intentionally replays the full stored source rather than resuming at the exact checkpointed batch. Added job API/UI controls and guarded deletion. Setup steps accept abort signals; `cancelSetup` returns interrupted steps to pending, and the server interrupts the setup Fiber using `Fiber.Fiber<unknown, unknown>` while preventing overlapping repair/start operations.
- **Grounding/security:** `grounding.verify = "retry"` now removes a failed unverified draft and retries once with a repair prompt; a second verification failure is flagged. Retrieved passage IDs are bounded/expired and cleared after verification. Local model import rejects traversal and symlinks escaping selected roots. Added targeted tests (all unrun).
- **Golden-vector regression test:** added `packages/learning/scripts/freeze-selftest.ts` and `bun run tl:selftest:freeze`. `packages/learning/src/self-test/golden.json` still has empty reference vectors; freezing requires the pinned int8 model on a host that can install it. This optional `runSelfTest()` fixture is distinct from the setup step (also named `golden-self-test`), which performs a live semantic sanity check and does not require frozen vectors.
- **Docs:** refreshed `CONTEXT.md`, this worklog, `docs/WHATS_DONE.md`, the Targeted Learning worklog/deployment guide, `docs/optimization.md`, README, API/configuration/architecture/development/deployment docs, and added `docs/security-auth.md`. Historical test counts and verification reports are explicitly labeled as historical.
- **Verification at this checkpoint:** Bun and workspace dependencies were not yet available, so tests, typechecks, builds, browser tests, and model-backed checks had not been run. Regression tests were added for auth, adaptive resources, setup, grounding, retrieval-state, imports, and ingest jobs. See the continuation entry below for later focused checks.

## 2026-10-29 — continuation hardening and focused PR checks

- Exposed `clearCredentials` from `ServerProvider` and invoke it when Basic health authentication fails, before falling back to JWT. This prevents a stale Basic `Authorization` header from shadowing Bearer auth. Removed stale `VITE_DIVEEOI_SERVER_PASSWORD` CLI/SSH references; the shell helper defaults to `DIVEEOI` and supports `DIVEEOI_SERVER_PASSWORD` with legacy `OPENCODE_SERVER_PASSWORD` fallback.
- Preserved refresh-token compatibility for headerless non-browser clients: login returns the token in JSON only without browser Origin/Fetch Metadata, and a body-token refresh returns the rotated token. Browser flows remain HttpOnly-cookie-only. Added focused transport tests.
- Made initial-admin assignment a conditional SQLite insert so concurrent first registrations cannot both get admin. Added a concurrent service regression test and validated the SQL against Node 22's SQLite.
- Cgroup detection now walks all visible cgroup ancestors, computes the tightest memory/CPU budget, and correctly parses the controller field in v1 `/proc/self/cgroup` entries. Added isolated cgroup parser/budget tests.
- OCR progress callbacks are awaited, preventing async checkpoint failures from becoming unhandled rejections. Recovery/retry claim setup now blocks duplicate in-process workers and coordinates with cancellation/pause/resume; added a recovery-claim/cancel regression test.
- Restricted Vite's allowed hosts to local development and Arena's `.e2b.app` previews rather than disabling the host-header check.
- **Focused verification:** 11 tests pass across app auth forwarding, refresh transport, and cgroup parsing; Bun parsed 20 modified TypeScript/TSX files; `git diff --check` and `bash -n scripts/divee.sh` pass. The atomic bootstrap SQL returned one admin row on first execution and none on the second.
- **Remaining verification:** Bun 1.3.14 was installed under `/tmp/diveeoi-tools`, but `bun install --filter ... --no-save --frozen-lockfile` failed on the GitHub `ghostty-web` tarball with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Package tests beyond the 11 focused tests, typechecks, full builds, browser checks, and model-backed tests therefore remain unverified; see `CONTEXT.md`.

## 2026-10-29 — Bun 1.4.2 build fix and Targeted Learning diagnostics (current branch)

- **Bun production-build blocker:** replaced synchronous `require()` selection of `@diveeoi/learning/node` in
  `packages/server/src/app-services.ts` with static ESM imports because the dependency graph reaches async top-level
  initialization in `@diveeoi/db/global`. Bun 1.4.2 reproduced the failure in a minimal fixture; the static-import fixture,
  ESM bundle check, and changed-file transpilation passed. The complete server build is still unverified.
- **Opt-in diagnostics:** added `packages/learning/src/diagnostics.ts` with category/level filtering, runtime environment
  configuration, JSONL output and rotation, restrictive file permissions, secret/content redaction, active operation spans,
  progress and pause/resume tracking, error snapshots, and configurable stall detection. Diagnostics are disabled by default.
- **Tracing integrations:** instrumented setup and persisted state, service initialization/recovery, download attempts/byte
  progress/hash verification, ingest queue/stages/pause/resume/cancel/recovery, hybrid retrieval/candidates/gate decisions,
  book attachment and targeted-turn decisions, model stream progress/duration/watchdog stalls, grounding/citation verification,
  settings updates (field names only), and Targeted Learning HTTP method/path/status.
- **Privacy and operations:** authorization/cookie/password/token/API-key-like values are redacted; free-form content and
  error-message strings are length-only by default; text details require `DIVEEOI_TL_DEBUG_CONTENT=1`. Added the authenticated
  `/targeted-learning/debug/status` endpoint and `docs/targeted-learning-debugging.md` with flags, inspection instructions,
  and a model-backed test procedure.
- **Focused checks:** Bun 1.4.2 diagnostics suite passes (7 tests, 36 expectations). TypeScript native-preview checks pass for
  diagnostics, setup state machine, downloader, diagnostics test, and HTTP diagnostics middleware. Bun `build --no-bundle`
  transpiles 16 modified TypeScript files; `git diff --check` passes (see `CONTEXT.md`).
- **Still unverified:** full package tests/typechecks, complete production server build, browser/UI checks, real setup/download
  with the pinned model, real retrieval calibration, generated-answer/citation/grounding-retry behavior, and restart recovery.
  Workspace installation remains blocked by the `ghostty-web` certificate failure; see
  `docs/targeted-learning-debugging.md` for the validation sequence.

## 2026-10-30 — share JWT auth service across HTTP route trees

- Reproduced the root cause from the VDS report by inspecting the route layers: `JwtAuth.defaultLayer` was provided only
  inside `serverRoutes` (`Api`), while root/event/PTY and raw-router auth middleware also require `JwtAuth.Service`.
- Moved the provider to the outer merged `createRoutes` layer so all route trees receive one shared JWT service; removed
  the branch-local provider to avoid creating a second instance.
- Bun 1.4.2 `build --no-bundle` transpiles the changed server route file and `git diff --check` passes. A live server start
  was not run here because workspace dependencies are absent; retry the VDS command after pulling this fix.

## 2026-10-30 — Go self-hosted CI runner (unverified implementation)

- Added a standalone Go 1.22+ runner under `tools/self-hosted-ci/` for Linux VPS use: polling selected refs on multiple Git
  remotes, config and pipeline validation, durable run state/locks, manual runs, bounded logs, CLI status/log inspection,
  and Docker-isolated shell steps with resource limits and restricted capabilities.
- Added ref globs, generic HTTPS/SSH remotes, host-side Git token injection through a temporary askpass file under `/dev/shm`,
  per-repository AES-GCM secrets, trusted-branch/tag checks, allowlisted secret names, and best-effort stream redaction.
  Documented that pipelines are executable trusted code, rootful Docker is host-root-equivalent, and no issue-free guarantee
  or perfect sandbox is claimed.
- Added explicit job artifact paths, symlink/special-file/path checks, a 1 GiB default per-run limit (configurable up to 20 GiB),
  a 10,000-file per-job limit, retention cleanup, and `artifacts` CLI inspection. Workspaces and old run data are cleaned
  separately; workspace/image-pull disk use remains dependent on host quotas.
- Added `tools/self-hosted-ci/README.md`, `deploy/diveeoi-ci.service`, Makefile, example config/pipeline, and the monorepo
  `.diveeoi/pipeline.yml` (learning tests, app/server typechecks, build, and retained app output). Added focused tests for
  refs/config/workflows/state/secrets/Docker args/locks/artifacts/workspace cleanup.
- **No Go toolchain is available in this sandbox:** `go`, native `gofmt`, and `gccgo` are missing, so compilation, `go test`,
  and `go vet` remain unrun. All 29 Go files were formatted with a WASM build of gofmt and accepted by Tree-sitter; this
  checks formatting/syntax only, not Go type correctness. The systemd unit passed `systemd-analyze verify` after substituting
  `/bin/true` for the not-yet-built runner binary; this does not exercise service startup. Docker/Podman are absent, so there is
  no container integration test. On a staging Linux host with Go 1.22+ and Docker, run
  `cd tools/self-hosted-ci && gofmt -w $(find cmd internal -type f -name '*.go') && go test ./... && go vet ./... && mkdir -p bin && go build -o ./bin/diveeoi-ci ./cmd/diveeoi-ci`,
  then follow `tools/self-hosted-ci/README.md` for Docker, pipeline, secret, manual-run, log, and artifact checks.

## 2026-10-30 — documentation cleanup and status refresh

- Removed historical auth/session plan docs, the auth task sheet that linked to them, the type-error campaign folder, the optimization findings audit, and the stale-path-only `TODOS.md`.
- Rewrote references in the brief, architecture, contributing, optimization, DB, and profiler docs; labelled old worklog/draft material historical and corrected stale branch metadata in `CONTEXT.md`.
- Refreshed the memory status docs: source implementation is separated from unrun tests/runtime checks; daily extraction is not described as scheduled consolidation. The potential non-atomic merge/data-loss risk in `packages/memory/src/consolidation.ts` remains open.
- **Branch:** the active Arena worktree remains `arena/ace5e304-diveeoi`; no branch switch was made. `dev` is its base/PR target, not the active session branch.
- **Validation:** `git diff --check` passes and searches found no remaining references to the removed docs. No tests or builds were run for these documentation-only changes.

## 2026-10-30 — query-aware memory context and agent guidance

- System prompt memory recall now uses the latest user message and active worktree, searches a bounded set of project-scoped candidates, and ranks records by query match across title/tags/content plus configured type importance, confidence, recency, graph links, and session relevance. Graph traversal rejects explicitly cross-project nodes. Prompt injection is capped at eight records, escapes XML delimiters, and marks memory content as reference data rather than instructions.
- New manually created and automatically extracted memories inherit project metadata and are attached to their session root so subsequent recall can find them without cross-project leakage. `memory_retrieve` without explicit graph seeds now routes through session/project/query-aware recall instead of treating the session ID as a memory-node ID.
- Agent guidance now asks for a relevant memory check at the start of substantive work and a save/update review at meaningful checkpoints and before wrapping substantial sessions. The extractor now accepts `[]` when no durable memory exists and its prompt rejects filler/duplicates/secrets. The guidance does not claim extraction is always offline.
- Tone guidance permits relaxed language and occasional emojis only for informal social chat; serious, important, factual, technical, coding, debugging, and operational work remains direct, professional, and emoji-free.
- Added memory tests for automatic session linking, query ranking, project scoping, and escaped reference-only prompt injection. Bun was absent initially, so Bun 1.4.2 was bootstrapped temporarily under `/tmp` without adding repository files. `packages/memory` tests pass (2 tests, 16 expectations).
- Typecheck status: `packages/memory` `bun run typecheck` still fails on errors in unchanged files `packages/db/src/adaptive/detect.ts`, `packages/db/src/database/database.ts`, and `packages/memory/src/index.ts`; it reported no diagnostics in the edited memory implementation files. The server typecheck process was SIGKILLed after about 9 minutes without diagnostics. Dependency setup for the server also hit a `tree-sitter-powershell` native build failure while fetching Node headers, so server typechecking and runtime integration remain unverified.
- TypeScript syntax parsing passed for all 13 changed `.ts` files. `git diff --check` passes.

## 2026-10-30 — curated embedded skills and metadata (draft PR #6)

- Added 19 curated built-in skills with 85 statically embedded text resources under `packages/db/src/plugin/skill/bundled/`. Adapted the guidance to DiveeOI tools, portable file paths, and the available skill/resource behavior; UI/UX data/scripts remain local resources. Four non-commercial-only source trees (`charts`, `docx`, `pdf`, `xlsx`) were not copied; original DiveeOI guides replace them. Apache-2.0 license copies are included for applicable bundles.
- Expanded DB skill frontmatter/metadata parsing, preserving unknown extension keys and provenance; added source origin, model/slash-invocation flags, argument hints, allowed tools and requirements. Embedded resources are path-validated, materialized under the global cache, and surfaced to both DB and server skill tools. The server adapter reads the same pure embedded catalog without booting a second PluginBoot layer.
- Added metadata to server skill/command schemas, filtering for `disable-model-invocation`, `slash: false`, and `user-invocable: false`, and XML-safe metadata in the skill prompt listing. API descriptions and generated SDK output now include skill metadata/source and command argument hints.
- **Focused tests:** DB skill/plugin/tool/config tests pass (8 tests, 42 expectations); server skill/command/system tests pass (20 tests, 57 expectations). `packages/sdk` codegen (`bun ./script/build.ts`) and TypeScript compilation pass. The generator also synchronized previously stale Targeted Learning API routes.
- **Typecheck caveats:** DB package typecheck still reports 69 diagnostics in existing files, with no diagnostics in changed skill files. The full server typecheck was SIGKILLed; a restricted typecheck timed out after about five minutes without diagnostics. Full workspace install remains incomplete; tests used a temporary filtered install.
- **Licensing gate:** the upstream `abdou-da0wew/zcode-skills` repository has no root license. Authorization to redistribute the remaining adapted content is unresolved, so [PR #6](https://github.com/abdou-da0wew/DiveeOI/pull/6) is draft only and must not be merged or released before clearance.

## 2026-10-30 — sync + review of new code (local commits ef595e5, 0846c25, not yet pushed)
- Remote `dev` history was rewritten (no common ancestor with earlier local history; content incl. all TL work preserved). Synced local `dev` to `origin/dev` (614bfcc); old local state kept as branch `local-before-sync`.
- Typecheck (server/app/db) on the new code: fixed Effect v3-only calls in `db/src/database/database.ts` (`zipRight`→`andThen`, `tapErrorCause`→`tapCause`), cgroup fallback type, `authorization.ts` middleware return type, two app fetch wrappers (`preconnect`).
- Adaptive resources: every `Effect.provide(defaultLayer)` built a new service with its own 90 s updater fiber (VDS log showed duplicate "Adaptive targets updated"). Added `db/src/adaptive/shared.ts` (`sharedAdaptive`, process singleton unless a caller provides one); `useAdaptiveTargets`/`withAdaptiveConfig`/`makeAdaptiveLayer` no longer leak `AdaptiveResourceService` into R (fixed ~20 type errors); main/monitor/runner use the shared instance.
- VDS crash log (Bun 1.4.2, `NAPI FATAL ERROR: napi_define_properties`, RSS 5.9 GB) happened while 2 embedding Workers loaded onnxruntime-node and a PDF was parsed. Real-model Bun Workers were never tested. Default `indexing.workersPerBook` is now 1 (in-process embedding; ORT already uses all cores); the pool stays opt-in/experimental.
- ONNX `pthread_setaffinity_np failed` warnings: `embedding.intraOpThreads/interOpThreads` were never passed to ONNX Runtime; now passed as explicit `session_options`.
- Tests: learning 178 pass / 1 expected (live model). Typecheck: learning 0, app 0, server 2 (build-generated `diveeoi-web-ui.gen.ts`; test `httpapi-ui.test.ts`).
- Push to GitHub not done this session (no credentials available); changes delivered as a patch.

## 2026-10-30 (later) — shared-session concurrency
- Pushed to dev. `workersPerBook` now means concurrent batches on one shared embedder (no model duplication); Worker threads opt-in only. New test `shared-session.test.ts` (3 in flight, each passage embedded once). learning 179 pass / 1 expected (live model); learning tsc clean. Not run against real ORT.
