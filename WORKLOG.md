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

## 2026-11-01 — VDS verification (real bge-m3) + fixes (commits 8f7bb73, d2fb262, 3de4231)
- Server binds from env: `HOST` (default 0.0.0.0) and `PORT` (default 4097); if the port is taken it scans upward (`listenWithFallback`). The VDS shell env has `PORT=3333 HOST=127.0.0.1` (the production `diveeoi.service` runs behind cloudflared on loopback), which is why a server started from that shell bound 127.0.0.1:3334. With `PORT=4097 HOST=0.0.0.0` it binds `0.0.0.0:4097` and answers on the public IP (401 without credentials, 200 with Basic auth).
- **Critical bug fixed:** `PRAGMA quick_check` returns column `quick_check`, code read `integrity_check` → every start treated a healthy `books.db` as corrupt and moved it aside (45 `.corrupt-*` copies on the VDS; library emptied on every restart). Test `store-reopen.test.ts` (fails on old code). Now only the 3 newest quarantined copies are kept.
- Inspector `/targeted-learning/search` failed to encode (undefined fields) → plain JSON.
- **Real-model run on VDS** (`scripts/tl-live-check.ts --skip-setup`): setup was already Ready; EN+AR test books indexed; in-book dense scores 0.525–0.76, off-topic 0.29–0.49, small talk 0.39–0.41. Old default 0.35 let 5 off-topic questions pass; default `gate.minDenseScore` is now 0.50 → 31/31 checks pass. Calibrated on two tiny books; re-run on real books. Benchmark: 15.2 chunks/s (8 cores, int8, batch 16). Server RSS: ~1.1 GB idle, ~2.3 GB after model load/indexing (peak ~3.0 GB).
- Resource tuning added: ORT arena/mem-pattern off, SQLite cache 16 MB / temp in memory / WAL ≤ 64 MB, multi-row inserts per batch. Effect on peak RSS not demonstrated (peak ≈ same as before); disk writes reduced by construction, not measured.
- Incident: `pkill -f "src/main.ts"` on the VDS also killed `bun apps/bot-gateway/src/main.ts`; pm2 restarted it within seconds. Do not use broad pkill patterns on that host; use PID files.

## 2026-11-02 — prompt worker service context diagnosis

- Traced the blank `prompt_async` curl response. The endpoint intentionally returns `204 No Content`; generated assistant output is delivered on the session event stream. The submitted user message was persisted, but no assistant output was produced.
- The actual prompt worker failure in `~/.local/share/diveeoi/log/opencode.log` was `Service not found: @opencode/Global`. The lazy `skill` tool reads `Global.Service` during tool-registry resolution, but the global service was only available through nested node dependencies and was missing from the worker's runtime context. Added `Global.node` explicitly to both `AppServices.serviceNodes` and `ToolRegistry.node`.
- The same log also records the Composer-selected `opencode/nemotron-3.5-super-vl-free` model returning `Free usage limit reached`. This is a separate upstream free-tier quota failure, not a local timeout. The Composer router does resolve a concrete model; the selected OpenCode free tier currently refuses the request.
- Validation: focused provider and HTTP authorization tests pass (21 tests, 51 assertions); production baseline build succeeds; `git diff --check` passes. Server typecheck remains blocked by the generated `src/server/shared/diveeoi-web-ui.gen.ts` declaration not being present in the source tree.
- Deployment caveat: the new binary was built but the system service was not restarted because the available shell requires interactive sudo authentication. Do not treat the fix as live until the service restarts and a real prompt completes.

## 2026-11-02 - DiveeComposer router expansion

- Composer now considers every configured provider by default, with a Models-tab toggle to restrict it to OpenCode. It strictly filters for free pricing (including cache, tier and high-context prices), tool support, active context-window metadata, and the configured quality threshold.
- Added Artificial Analysis Free API benchmark and performance ingestion, normalized model matching, a six-hour cache, and attribution in Settings. Provider metadata remains the source for context limits and provider reachability because the Free endpoint does not include those fields.
- Added a server-side AES-256-GCM credential store with separate private data/config locations. The browser receives only a configured flag. The config stores an environment-variable name, not a credential.
- Prompt model resolution now passes the session latest assistant input-token count to Composer. Smaller context windows are rejected; 20 percent headroom is preferred by default. No paid or weak fallback is used when no suitable free model exists.
- Successful model history and provider-wide quota cooldowns are persisted. OpenCode free-quota exhaustion now cools down the whole provider for one hour.
- Focused Composer/Free-tier/Artificial Analysis tests: 38 passed. App and SDK typechecks pass. Server typecheck has only the existing missing generated web UI declaration. Broader provider suite still hits unrelated SQLite Prefs fixture and provider-catalog test failures.
- Production build must be rerun after final edits. API credential has not yet been provisioned on the VDS, and the system service has not been restarted; the new binary is not live until an administrator restarts it and a real prompt succeeds.
- Final hardening: model candidates now require an explicit known zero-price record; missing models.dev pricing is not treated as free. The provider state tracks known-free model IDs and providers with available credentials/local endpoints. Artificial Analysis cache is persisted across restarts, rate-limit retry windows are persisted, and the scorer includes the six capability indices plus median throughput/latency fields where present.
- Final validation after hardening: 41 focused tests pass; app and SDK typechecks pass; server typecheck reports only the pre-existing generated UI declaration gap; production baseline build succeeds. API key is still not provisioned on the server and service restart has not been performed.

## 2026-11-02 — Composer regression, provider auth failures, and Claude handoff

- The `2f5b2c3` deployment introduced a user-visible regression: when no AA measurement matched and `allow_unmeasured_ranking` was false, `Composer.select()` had no candidates; `Composer.build()` returned `undefined`; and `Composer.withProvider()` removed the synthetic `divee` provider. This coupled model-catalogue visibility to route eligibility and made DiveeComposer disappear.
- The user also reported that the new Models settings were missing from Settings V2. V1 (`settings-models.tsx`) had the consent/key/all-provider controls; V2 (`settings-v2/models.tsx`) did not.
- Runtime logs showed two separate provider failures: OpenCode free gateway quota errors (`Free usage limit reached`) and OpenRouter requests failing with `Missing Authentication header`. Do not conflate quota exhaustion with authentication or model quality.
- Last deployment observed: commit `2f5b2c3`, service `diveeoi.service` active, PID `914318`, start time `2026-11-02 20:15:10 UTC`, listener `0.0.0.0:6050`. That binary predates the recovery edits below.
- Uncommitted recovery edits now exist in `packages/server/src/provider/composer.ts` (display-only Composer representative while keeping actual requests route-tagged), `packages/server/src/provider/provider.ts` (credential availability and environment placeholder handling), `packages/server/src/provider/artificial-analysis.ts` (load persisted AA data without a key), `packages/app/src/components/settings-v2/models.tsx` (V2 settings parity), and `packages/server/test/provider/composer.test.ts` (provider visibility regression test). Preserve and review these edits; they are not deployed.
- App typecheck passed after the V2 settings and recovery changes. Focused Composer/quality/AA/free-tier suites passed: 51 tests, 124 expectations. Server typecheck and a fresh production build have not been run against this final working diff. A previous server typecheck was blocked only by the known generated `diveeoi-web-ui.gen.ts` declaration gap. The Composer-bans persistence test still hits the known SQLite fixture error: `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`.
- Created `COMPOSER_INCIDENT_HANDOFF.md` with exact causes, files, production/working-tree distinction, verification state, and a recommended repair order for Claude. Updated `CONTEXT.md`, `PROJECT_GUIDE.md`, root agent rules, all tracked `AGENTS.md` files, `.cursorrules`, and `.zcoderules` to point agents at that handoff.
- **Not committed, not pushed, not built, and not deployed:** all recovery edits and the documentation changes in this handoff session. Re-run tests, app/server typechecks, production build, browser V1/V2 checks, authenticated provider requests, and quota-cooldown tests before deployment.


## 2026-11-02 — Composer/provider recovery continuation and verification

- Reviewed the full current working diff and the root/package agent instructions before editing. Preserved all existing uncommitted changes; no reset/clean operation was performed.
- Confirmed that `Composer.targetOf(input.model)` is identity-safe in the current prompt path: the model returned by `provider.getModel()` is passed unchanged into `processor.create()` and then into the LLM stream. Processor failures therefore learn against the concrete Composer route, not the synthetic `divee/composer` model.
- Kept Composer display visibility independent from route eligibility. A known-free display representative remains visible when no provider is authenticated, but `Composer.model()` still returns no model without a route tag. The unavailable reason now identifies missing authentication separately from an empty catalogue.
- Fixed a shared-catalogue mutation bug: custom provider loaders and plugin model discovery could mutate the `catalogFor()` model objects shared across per-directory instances. Provider instances now receive shallow, private provider/model maps, and the loader-filtered OpenCode models are applied only to that instance. The provider regression suite verifies that a no-key instance cannot remove paid models from a later keyed instance.
- Tightened provider availability checks so model-level `options` that do not reach the SDK auth path cannot falsely prove authentication. Explicit provider headers are considered, nested provider option credentials are resolved against environment placeholders, public `baseURL` alone is not accepted, and keyless local/private endpoints remain supported.
- Made provider-wide missing-auth handling a temporary five-minute circuit breaker rather than a permanent model/provider ban. OpenCode's gateway-specific key refusals remain model-level; quota exhaustion remains provider-wide, one hour, and persisted through ComposerBans.
- Completed AA key lifecycle invalidation: set/remove clears the Artificial Analysis cache, disposes the provider instance, and both Models settings screens await global/per-directory provider query refreshes.
- Fixed the root cause of Composer-bans persistence failures. The Drizzle preference table now declares the `(scope, name)` composite primary key; generated schema/registry/migration files were regenerated. The migration safely collapses any duplicate legacy rows by keeping the latest `time_updated` row before rebuilding the table. Added migration coverage proving the latest value survives and the `ON CONFLICT (scope, name)` upsert succeeds.
- Verification on the current tree: focused server provider/Composer/AA/quality/free-tier/bans suite **154 passed, 0 failed (386 assertions)**; DB migration suite **16 passed, 0 failed (43 assertions)**; migration generator `--check` clean; `git diff --check` clean. LSP reports no errors in the changed provider, settings, key handler, sync, and migration files; two unrelated warnings remain in existing `prompt.ts` and `public-opencode` test code.
- Full DB package suite still fails in `packages/db/test/public-opencode.test.ts` with `InterruptError: All fibers interrupted without error` inside `FileSystem.up()`; reproduced when the test file is run alone and with concurrency 1. This appears independent of the preferences migration but remains unresolved.
- Full app/SDK/DB/server typechecks and a fresh production build remain unrun because the repository requires `divee_typecheck_build` on Colab and that helper is not available in the VDS session. Browser verification and live authenticated OpenRouter/AgentRouter requests also remain outstanding.
- No commit, push, build, restart, or deploy was performed. The recovery changes remain local and are not live in production.


## 2026-11-02 — manual browser QA and repository commit hook

- Ran the VDS `agent-browser` core and dogfood workflow against the current working-tree app/server. Used a named session and an isolated local backend (`127.0.0.1:4097`) plus Vite (`127.0.0.1:4173`), with fresh XDG data/config/state directories under `/tmp/diveeoi-browser-qa`. No production config, database, or provider credentials were used.
- Manually tested the Basic-auth login flow and both Settings Models experiences. V1 and V2 both rendered the Composer provider toggle, heuristic-consent switch, AA key field/status, fallback environment-variable field, and synthetic DiveeComposer model.
- Exercised Composer settings persistence in the isolated config: changed `use_all_providers`, `allow_unmeasured_ranking`, and the AA fallback env-var name; verified the resulting `diveeoi.jsonc` file on disk. Restored settings to `use_all_providers: true`, `allow_unmeasured_ranking: false`, and `ARTIFICIAL_ANALYSIS_API_KEY` after QA.
- Exercised AA key save/status/remove in both V1 and V2 with disposable fake values. The UI moved from Save to Replace/Remove, the encrypted `.runtime/.catalog` appeared with mode `0600`, and removing the key restored the unconfigured UI state and deleted the encrypted file. Fake invalid test data caused one expected AA HTTP 401 during provider refresh; the key was removed after the test.
- Authenticated event-stream requests returned 200 after the pre-auth 401s. After login, `agent-browser errors` was empty and the cleared browser console remained empty during the final V2 check. The isolated server also logged an SSH startup warning because SSH was intentionally not configured.
- Screenshots: `docs/qa/screenshots/01-login.png`, `docs/qa/screenshots/02-settings-models-v1.png`, `docs/qa/screenshots/03-settings-models-v2.png`. Structured report: `docs/qa/COMPOSER_BROWSER_QA.md`. No UI defect was found in the tested scope. No model-generation request or real OpenRouter/AgentRouter call was made.
- Added `.githooks/commit-msg`; set local `core.hooksPath=.githooks`. The hook adds the DiveeAgent co-author trailer once, using `git interpret-trailers --parse` to avoid false matches from body text. Verified append, idempotency, coexistence with another trailer, an actual temporary-repo commit, and `--amend`.
- Documented hook setup and mandatory manual VDS browser QA in `PROJECT_GUIDE.md`, root/app `AGENTS.md`, `CONTEXT.md`, and this handoff. Updated stale references to the original five-file recovery inventory.
- No project commit, push, production build, service restart, or deployment was performed. Full package typechecks and fresh build remain outstanding; the VDS Colab build helper is not available in this session.


## 2026-11-03 — follow-up browser validation and commit-msg hook verification

- Re-read the installed `agent-browser` `core` and `dogfood` workflows and used named VDS browser sessions. The comprehensive isolated QA report in `docs/qa/COMPOSER_BROWSER_QA.md` covers both Settings versions, including disposable fake AA-key save/status/remove and the isolated authenticated event stream.
- Additional follow-up: loaded the current V2 frontend source through Vite at `127.0.0.1:3003` and opened V1 from the existing service at `127.0.0.1:6050`. Both Models tabs rendered the Composer section and model list. In each version, toggled `use_all_providers` and `allow_unmeasured_ranking` off and back on; each PATCH and subsequent config GET returned HTTP 200. Applied the unchanged `ARTIFICIAL_ANALYSIS_API_KEY` fallback value in both versions and confirmed the final config still contained `use_all_providers: true`, `allow_unmeasured_ranking: true`, and the same fallback env name.
- No AA key was entered or changed during this follow-up. The 6050 service is the pre-recovery deployed server binary, so these checks validate UI wiring/config persistence only, not the uncommitted server-source handlers/provider routing. The isolated AA-key lifecycle results remain in the earlier QA report.
- Captured `docs/qa/composer-settings-v1-manual-test.png` and `docs/qa/composer-settings-v2-manual-test.png`. Stopped the temporary Vite process, closed the two browser sessions, cleared their cookies, and confirmed no QA listener remained on 3003/4173/4097. The existing service on 6050 was not restarted.
- The supplemental 6050 test used reversible settings updates against the active service rather than the isolated XDG database. The values were restored and checked afterward; no credential/key was changed. Future browser QA should continue using the isolated XDG setup from the main QA report.
- Verified `.githooks/commit-msg` with a real temporary Git repository: both a normal commit and a subsequent `--amend` contained exactly one `Co-authored-by: DiveeAgent <270451464+DiveeAgent@users.noreply.github.com>` trailer. The current checkout is configured with local `core.hooksPath=.githooks`; no commit was made in the DiveeOI repository.
- Added direct provider-auth predicate tests: public `baseURL` and unresolved `${ENV}` are rejected; resolved API key templates and nested Authorization headers are accepted; recursive traversal is cycle-safe; and local/private keyless endpoints remain eligible. The combined server provider/Composer/AA/quality/free-tier/bans suite now passes **158 tests / 406 assertions**. LSP diagnostics for `provider.ts` and `provider.test.ts` are empty.
- A fresh isolated backend smoke on 4097 with clean XDG dirs exposed a Vite proxy bug: `/file?directory=...` missed the regex boundary and returned app HTML. Updated `packages/app/vite.config.ts` to match `?` as an API-path boundary; verified the proxied request now returns backend JSON. A subsequent recursive absolute-path folder search drove the temporary server RSS sharply upward before a project/session could be opened; stopped the temporary server/Vite processes, closed the browser and cleared its cookies, removed the temp XDG tree, and did not restart or touch the active service. A Composer prompt/no-route browser test remains outstanding.
- Full app/SDK/DB/server typechecks and a fresh production build remain outstanding because `divee_typecheck_build` on Colab is required by repository rules and is unavailable in this VDS session. The isolated DB `public-opencode.test.ts` filesystem interruption and live OpenRouter/AgentRouter authentication tests also remain outstanding.

## 2026-11-03 — isolated Composer no-route browser verification

- Completed the missing manual no-route test with the current working-tree backend and Vite frontend, using a named `agent-browser` session and the installed `core` / `dogfood` workflows.
- Built a no-route fixture with a zero-cost catalogue model at the public `https://api.example.invalid/v1` endpoint, no provider credential environment variables, and a synthetic Composer model that remained visible. The fixture avoided the keyless local/private endpoint exception.
- Pinned the backend to a dedicated temporary SQLite database with a clean `env -i` launch and explicit `OPENCODE_DB`. Verified its open DB files were under `/tmp/diveeoi-composer-noroute-final-20261103`; the live 6050 service DB was checked read-only and contained no QA user or session.
- Submitted two browser prompts with DiveeComposer selected. The server rejected both before provider invocation with the safe no-route explanation. The browser surfaced the `Session error` toast; the UI showed no stack trace, no assistant answer was generated, and no external model request appeared in either HAR.
- Captured before/after screenshots and HARs in `docs/qa/`; details are in `docs/qa/COMPOSER_BROWSER_QA.md`.
- The full DB package suite passes in this tree: 1,047 tests, 2,815 assertions, 133 files, zero failures. Targeted `public-opencode.test.ts` also passes (5 tests, 14 assertions).
- Full required Colab typecheck/build remains to be located/run; do not substitute an unapproved heavy local build. No commit, push, production restart, or deployment was performed.

## 2026-11-03 — VDS typecheck, production build, and final regression verification

- Used the user's confirmed 32 GiB VDS for local checks instead of the stale Colab-only workflow. Temporary Composer QA listeners had been stopped first; the existing production service on port 6050 remained running and was not restarted.
- Fixed the migration generator's emitted registry type so optional `bootstrap` metadata remains available on `DatabaseMigration.Migration[]`; regenerated `migration.gen.ts`. `bun script/migration.ts --check` reports no schema drift.
- Fixed two `JwtAuth.Service` test mocks to provide a deterministic test-only `readSecret`, added an ambient declaration for the Bun-generated embedded UI module so source typechecks work, and corrected the instance-route Basic-auth test fixture from the obsolete `opencode` username to the current `DIVEEOI` default. The previously failing auth route tests pass 2/2.
- Full monorepo typecheck: 14/14 tasks passed. Final typecheck after lint cleanups also passed. Vercel remote-cache write permission warning is non-blocking.
- SDK + app production build: 2/2 Turbo tasks passed. Server production build completed with Linux x64 and x64-baseline smoke tests passed; the baseline executable path used by the service is executable on disk.
- Full DB suite: 1,047 passed, 0 failed, 2,815 assertions, 133 files. Full server suite: 2,770 passed, 14 skipped, 1 todo, 0 failed, 7,292 assertions, 21 snapshots, 212 files. App suite: 429 unit tests across 73 files plus 2 virtualizer tests; 0 failures.
- Final focused provider/Composer/free-tier/Artificial Analysis/session-prompt suite after the last source cleanup: 214 passed, 1 skipped, 0 failed, 622 assertions, 7 files.
- Cleaned touched source warnings (unused test imports/catch bindings, local IPv4 prefix checks, safe object-spread fallback) and documented two intentional lint exceptions. Oxlint over 48 changed/untracked source files now reports zero diagnostics. The broad repo scan still reports warnings in untouched legacy source, brand assets, and docs examples; no lint errors were reported. `git diff --check` passes.
- The Composer no-route browser QA remains isolated and successful (see `docs/qa/COMPOSER_BROWSER_QA.md`). No real provider credentials were available, so live OpenRouter/AgentRouter auth and upstream OpenCode quota-cycle requests remain untested.
- No commit, push, production service restart, or deployment. `diveeoi.service` PID 914318 remains the old in-memory server process; the new baseline binary is only built on disk.

## 2026-11-04 — Final release handoff refresh

- Updated RELEASE_HANDOFF_2026-11-03.md with the latest production PID/binary-inode check, current build hash, working-tree count, migration-check result, and the disposition of the still-running HTTP API effect-mode process.
- Reconfirmed that production was not restarted and that the service still runs the old, deleted executable inode. New binary is built and available on disk; privileged deployment remains blocked pending the user's explicit approval.
- Stopped the stale effect-mode exercise process after it remained active for about 16 minutes while logging the missing effect/process/ChildProcessSpawner service error. No passing effect-mode result is claimed.
- Corrected the Composer browser QA document: full typecheck and production build were subsequently run successfully on the VDS; the earlier Colab-only statement was stale.
- git diff --check and the DB migration check completed successfully. No commit, push, cleanup, database restore, or production migration was performed.

## 2026-11-04 — Settings UI polish (V1/V2)

- Replaced the generic Targeted Learning book navigation glyph with a dedicated graduation-cap icon in both settings dialogs.
- Scoped the V2 Models compact typography styles to provider model rows so they no longer crush DiveeComposer descriptions. Improved the Composer row copy line-height, font size, control spacing, and field sizing. Grouped the V1 Composer controls into a single settings card and aligned its typography and padding with the other settings sections.
- Wrapped V2 Targeted Learning in the standard tab header/body/section layout used by Features and LLM. Brought shared Targeted Learning headings, help text, status rows, and form labels up to the common settings typography scale in V1/V2.
- Verified the V1 and V2 Models/Targeted Learning tabs in an isolated Vite + backend browser session; checked V2 at 543×580 with no horizontal overflow and confirmed 12px/17.4px Composer description typography. Added screenshots and a detailed QA record at `docs/qa/SETTINGS_UI_2026-11-04.md`.
- Verification: app/UI typecheck 2/2 packages; app tests 429 pass; UI tests 68 pass; app Vite build pass; lint error-only scan pass; `git diff --check` pass.
- Used only a temporary backend with fresh XDG directories and disposable Basic auth. No production data, credentials, API keys, or service restart were used. No commit or push.
