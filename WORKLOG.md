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

## 2026-11-03 — Retrieval V2: native engine wiring + distillation toolkit

- Plan first, then code: `packages/learning/RETRIEVAL_V2_PLAN.md` rewritten with the researched decisions and a status table. Verified against BGE-M3's documentation that it is already multilingual (100+ languages including Arabic), so no second teacher is needed; the pinned `Xenova/bge-m3` (rev `4de1325`) stays the teacher and only embeds passages.
- **Rust engine** (`packages/learning/native/retrieval`): added `--serve` (persistent NDJSON request/response, one open read-only handle, `id` echo, per-request errors, `best_dense_score`/`best_fused_score` before the top-K cut), BLOB vector reads from an additive `chunk_vecs_blob` table, `--compact` (TEXT→BLOB, idempotent, orphan pruning, opt-in `--drop-text` + `--vacuum`), an explicit `--bm25-limit` (the old code reused `--limit` as the BM25 candidate count), and integration tests that build a real SQLite fixture (BM25+dense fusion, dense-only paraphrase, compaction incl. reading after TEXT is emptied, serve NDJSON, malformed input).
- **TypeScript**: new `src/retrieve/native-engine.ts` (binary discovery via `DIVEEOI_RETRIEVAL_BIN` → repo paths, one long-lived child, id-correlated concurrency, 4 s timeout, 30 s failure cooldown, concurrent-safe teardown, stderr drain) and `retrieve()` now prefers it, falling back to the existing BM25/dense/RRF path on any failure. New setting `retrieval.engine` (`auto`/`native`/`typescript`). Gate, rewrite and parent expansion stay in TypeScript; the engine returns the same scores the gate already used.
- **Distillation toolkit** (`packages/learning/training/`, Python): `build_dataset.py` (reads passages and the stored vectors from `books.db`, accepts real judged queries via `--queries`, otherwise synthesizes Arabic/English probes from headings/spans, mines hard negatives, prunes the vocabulary, writes npz/jsonl), `train.py` (cosine + InfoNCE + KL distillation, hard negatives, val metrics against the stored vectors with teacher ratios), `eval.py` (per-tag/per-language-pair slices, off-topic probes for gate calibration, optional `--rust-bin` engine benchmark), `export.py` (ONNX `last_hidden_state`, INT8, teacher tokenizer/config, `divee-student.json` with `promoted:false`), `promote.py` (gates; calibrated gate thresholds only when in-book p5 > off-topic p95), `smoke_test.py`, `requirements.txt`, `README.md`.
- Verification here: `bun test` in `packages/learning` 205 pass / 2 skip / 0 fail; `tsgo --noEmit` clean; `python -m py_compile` clean; `smoke_test.py` metrics pass (model part skips without torch); `build_dataset.py --no-embed` against a fixture `books.db` produced 12 Arabic+English queries for 4 passages. **Not run here:** Rust `cargo test`/`clippy`/`fmt` (this sandbox has no Rust toolchain, no crate cache and no `libsqlite3` dev package) — `main.rs` was parsed with tree-sitter (0 syntax errors) and hand-reviewed; the binary must be built on the VDS. Training itself still needs a GPU and the BGE-M3 weights.
- No book was re-embedded, no on-disk vector format was changed by default, and no deployment was performed.

## 2026-11-04 — Settings UI polish (V1/V2)

- Replaced the generic Targeted Learning book navigation glyph with a dedicated graduation-cap icon in both settings dialogs.
- Scoped the V2 Models compact typography styles to provider model rows so they no longer crush DiveeComposer descriptions. Improved the Composer row copy line-height, font size, control spacing, and field sizing. Grouped the V1 Composer controls into a single settings card and aligned its typography and padding with the other settings sections.
- Wrapped V2 Targeted Learning in the standard tab header/body/section layout used by Features and LLM. Brought shared Targeted Learning headings, help text, status rows, and form labels up to the common settings typography scale in V1/V2.
- Verified the V1 and V2 Models/Targeted Learning tabs in an isolated Vite + backend browser session; checked V2 at 543×580 with no horizontal overflow and confirmed 12px/17.4px Composer description typography. Added screenshots and a detailed QA record at `docs/qa/SETTINGS_UI_2026-11-04.md`.
- Verification: app/UI typecheck 2/2 packages; app tests 429 pass; UI tests 68 pass; app Vite build pass; lint error-only scan pass; `git diff --check` pass.
- Used only a temporary backend with fresh XDG directories and disposable Basic auth. No production data, credentials, API keys, or service restart were used. No commit or push.

## 2026-11-06 — Documentation and PDF refresh

- Audited the clean `dev` checkout at `2868dc79b1ab28216048dd2667885785cda65176` (matching `origin/dev`) and indexed the workspace before broad content review.
- Refreshed the root README, current `CONTEXT.md`, current release hand-off, documentation index, architecture/configuration/API/deployment/development/getting-started guides, and Targeted Learning operator guides. Added a first-class `packages/learning/README.md` and contributor rules.
- Reconciled the November 4–6 Targeted Learning implementation: native Rust engine selection and TS fallback, query-encoder settings/promotion contract, teacher lifecycle, expanded multilingual query synthesis, evaluation slice floors/skips, book-scoped Rust evaluation, trace-safe export, parallel EB OCR, and idempotent corpus generation.
- Preserved dated audits, QA captures, and prior release/incident narratives as historical records; added current-state pointers rather than rewriting their chronology.
- Read the running service state without changing it: `diveeoi.service` active, PID `1906414`, started 2026-11-05 18:54:11 UTC, listening on `0.0.0.0:6050`. Running and disk executable hashes matched (`45582ceaae4ad55ef10020c9955d3c87687e7cf1473c76bee4f129e99c84eba7`); exact build commit provenance was not proven because the current source HEAD is newer than the binary mtime.
- Generated all six canonical user-facing PDFs (overview, technical overview, architecture dark/light, field notes dark/light), refreshed the videos-folder overview/technical copies, and kept the existing `videos/DiveeOI copy.pdf` in sync. Rendered contact sheets for dark/light variants and visually inspected the pagination and hierarchy.
- PDF validation: all 9 deliverable files have extractable text, no text spans outside page bounds, and no stale single-database/shared-password claims. The root/video overview and technical copies are SHA-256 identical. The two PDFs under `packages/learning/test/fixtures/` were intentionally preserved as test inputs.
- Documentation QA: 333 internal Markdown links checked across 397 maintained Markdown files with 0 missing targets (vendored resources and test/fixture skill content excluded); all five PDF generator/entrypoint modules pass `node --check`; `git diff --check` passes. The full current-HEAD monorepo build/typecheck/test matrix was not rerun because this was a documentation-only change.
- Documentation refresh only: no service restart, production deployment, DB migration, commit, push, or cleanup.

## 2026-11-19 — SSH Remote Sessions completion

- Completed the outbound SSH Remote Sessions flow across server and app: OpenSSH host discovery (including bounded Include traversal), profile CRUD, Ed25519 key generation, encrypted password/passphrase storage, saved-profile probing, per-session attach/disconnect, and remote working-directory selection. The raw management routes are registered behind server authorization middleware.
- Added strict SSH host-key verification against the server account's OpenSSH `known_hosts`. Verification supports hashed host entries, non-default ports, wildcard matching/exclusions, and revoked entries; unknown or changed keys fail closed. The connector also uses POSIX shell argument quoting for remote working directories and environment values.
- Completed the SFTP discovery and common write paths: recursive glob, `findUp`, `up`, `groupUp`, `globUp`, recursive parent creation, recursive copy destination creation, chmod, and file/directory removal. Remaining lower-level SFTP operations (`open`, `stream`, hard links, and scoped temp directories) fail explicitly and are documented rather than silently returning empty data. ProxyJump metadata can be discovered but jump-host tunnelling is not implemented.
- Added a reusable `packages/server/script/remote-ssh-smoke.ts`. Against the local OpenSSH daemon with the public host key explicitly added to a temporary known_hosts file, it passed agent authentication, shell execution, shell-metacharacter-safe working-directory handling, recursive SFTP write/read/edit/rename, glob/upward discovery, and independent remote working directories.
- Added focused server tests: `bun run test:remote` covers SFTP discovery, parent creation, copy, directory removal, and host-key verification. Latest result: **7 tests passed, 0 failed, 21 assertions**.
- Added two Playwright regressions: `bun run test:e2e:remote` verifies Settings discovery/profile save/test and a separate session-attachment flow. Latest browser result: **2 passed** using system Google Chrome (`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome`, `PLAYWRIGHT_CHROMIUM_ARGS=--no-sandbox`).
- Targeted Oxlint passed on 17 changed remote-related TS/TSX files with **0 warnings and 0 errors**. Targeted Biome lint passed on the same 17 files with no diagnostics. Prettier formatted the touched TS/TSX/CSS. Added Oxlint and Biome as root development dependencies.
- Server typecheck passed after the SSH2 callback typings and SFTP mode-bit handling were corrected. App typecheck passed after the Settings UI type imports and form field labels were corrected.
- The app production build and native single-target server build are being rechecked against this final source state; do not use earlier build results as evidence for later edits. No deployment, service restart, commit, or push was performed.
- Updated `README.md`, package READMEs, `docs/remote-sessions.md`, docs indexes/config/security pages, root and package AGENTS guides, `CONTEXT.md`, `DECISIONS.md`, and this worklog. Added the root `CHANGELOG.md` Unreleased entry.

## 2026-11-20 — Categorized commit series, hook, and publication

- Read `NOTE_GPT_PLEASE_READ.txt` and acknowledged it by renaming it to `NOTE_GPT_PLEASE_READ.READ.txt`; the note contents were preserved.
- Confirmed the repository already carried a trailer-aware `.githooks/commit-msg` implementation. Kept that implementation, documented activation in `.githooks/README.md`, configured this checkout with `core.hooksPath=.githooks`, and tested the hook twice against one message: exactly one `Co-authored-by: DiveeAgent <270451464+DiveeAgent@users.noreply.github.com>` trailer remained.
- Split the previously uncommitted code into independent commits: `ca8aa6b` (hook/read-note acknowledgement), `d9ce5bc` (adaptive learning and grounding), `68a88ba` (bounded filesystem indexing), `6d0427c` (Rich UI Learning/platformer and exam validation), `879a665` (inbound SSH REPL), `5fc92de` (outbound SSH profiles/trust/SFTP), `322e748` (remote agent-tool execution), `1502180` (remote Settings and session UI), `cac604a` (embedded Web UI packaging), `794be55` (remote QA/lint tooling), and `61cf356` (memory-pressure cleanup threshold). This documentation closeout is recorded in its own final commit.
- Verification retained from the implementation pass: server typecheck passed; app typecheck passed; focused remote tests passed **7/7 with 21 assertions**; the live local OpenSSH/SFTP smoke passed; focused Oxlint reported **0 warnings / 0 errors** on 23 files; focused Biome lint checked 22 files with no diagnostics.
- Browser verification boundary: a direct one-worker Playwright invocation of both Remote Sessions specs passed **2/2** earlier. The later package-script retry using the isolated port `3044` did not return a verifiable completion result, so the package-script path is not claimed as confirmed.
- Build verification boundary: the native Linux x64 single-target server build had passed in an earlier run, before the final verification refinements. The app production Vite build did not complete; it remained in transformation and was terminated. No final app production build pass is claimed.
- All source and documentation changes were committed on `dev` and published to `origin/dev`. No production deployment, DB migration, or service restart was performed.

## 2026-11-20 — motion-graphics sources and coenx-video skill adaptation

- Cloned `git@github.com:Barty-Bart/motion-graphics.git` into `third_party/motion-graphics/` and registered it as a git submodule. Pinned upstream `main` commit: `3d83d987d658601d8a1269eb691622bdcd427335` (2026-10-13). The original clone remains clean and preserves all six upstream skills, scripts, examples, demo GIFs, fonts and sound assets.
- Verified the upstream repository's MIT license. Preserved its separate Geist OFL, Lucide ISC and sound/music license/credit files. The clone is not flattened into copied files; future updates can be reviewed as submodule revisions.
- Downloaded the Awesome Claude motion-graphics page HTML, its CSS/JS page bundles, downloadable generic `SKILL.md`, and a local site snapshot. Extracted all 17 complete prompts and original style metadata from the page's compiled style data, then created JSON/Markdown archives and a coenx capability/adaptation mapping. Source page update date: 2026-10-21.
- Added eight project-discoverable `.agents/skills/` skills: coenx-video entry point, 17-style library, default/engaging/high-energy explainers, transcript-led B-roll, optional object separation and sound design. Six Barty-derived skills carry the immutable upstream revision in frontmatter; the style library retains Awesome Claude attribution and update date.
- Adaptations explicitly account for the current engine API and resource limits. They do not claim source-video compositing, transparent ProRes, arbitrary HTML/GSAP capture, path morphs, custom shaders, motion blur, watercolor brushes, PBR materials or SAM2 integration inside the renderer. Segmentation remains opt-in and local.
- Updated `AGENTS.md`, `PROJECT_GUIDE.md`, `README.md`, `docs/README.md`, `docs/skills.md`, `packages/coenx-video/README.md`, `docs/coenx-video.md`, `CONTEXT.md`, `DECISIONS.md` and `CHANGELOG.md`.
- Validation: 8 unique project skill frontmatters verified; archived JSON parses with 17 full style prompts; local page resource snapshot and source submodule inventory checked. No full TypeScript/package build, actual MP4 render, interactive browser E2E, service restart, production deployment, commit or push was performed in this pass.

## 2026-11-20: Coenx video language, fonts and bundled agent skills

- Added the CML source tree parser, safe CSS subset, and declarative CoenxScript parser/compiler under packages/coenx-video/src/format/.
- Added a local 16-family typography catalogue with 28 WOFF2 assets, Arabic/Latin subsets, SIL OFL notices, an embedded resource registry, browser font-face embedding and temporary Fontconfig font staging for MP4.
- Extended the shared node model so the same font-family/size/weight values reach SVG/Canvas and accessible controls.
- Registered 19 Coenx guidance skills in DiveeOI's built-in skill resource catalogue, including the adapted motion-graphics skill set, 17 style prompts, interactive Canvas, SVG motion, typography, accessibility, Targeted Learning, physics, storyboard and validation references.
- Added CML/stylesheet/script and font catalogue tests; package tests, package typecheck and DB typecheck passed. Bun builds passed for the package and built-in skill bundle. A short H.264 MP4 render and an interactive export were smoke-tested. Browser interaction E2E and full-size production render remain unverified.

## 2026-11-21: Native Coenx renderer and SVG interactive stage

- Added a Rust/Cairo raster backend with Pango/PangoCairo text layout for proper complex-script shaping and local Fontconfig font discovery.
- Added the native render_frame JSON-line operation alongside the existing Rust physics simulation operation.
- Added a persistent TypeScript native process client and a native MP4 path that evaluates keyframes, streams PNG frames to FFmpeg, mixes the existing audio timeline and verifies H.264/AAC output with FFprobe.
- Exposed renderer: native through renderStandardVideo and the CLI --renderer native flag. Kept the SVG/ImageMagick renderer as the default and fallback for unsupported native node kinds.
- Added an SVG interactive stage renderer option alongside Canvas. It builds SVG elements with DOM APIs and textContent, retains the real HTML control overlay, and uses the same composition/timeline/interaction engine.
- Added Rust frame raster tests, native MP4 tests and interactive engine state/branch/timer tests. Native path smoke tests produced verified MP4 output with H.264 and AAC.
- Native v1 still lacks image decoding, mesh3d rasterization, select visuals, SVG paths/filters/masks/gradients and complete transition compositing. Full browser E2E and production-scale performance/quality validation remain pending.

## 2026-11-21: Coenx 3D shading, morphing, physics and native mesh path

- Added reusable 3D vector math, vertex-normal generation, flat/smooth mesh shading, ambient/directional/point lighting, specular response and material controls.
- Added morph targets and frame-keyed 3D position/rotation/scale/morph-weight tracks to the shared animation evaluator.
- Added deterministic 3D physics with gravity, sphere/AABB collisions, friction, restitution, angular velocity, fixed substeps and optional world bounds. Export and interactive playback reuse precomputed compact pose buffers.
- Extended scene entrance transitions with zoom, wipe and flip-3D alongside fade/slide in SVG, Canvas/SVG playback and Cairo native export.
- Added native Cairo polygon rendering and projected shaded 3D faces, including morph animation, physics and transition clip rectangles. Images and selects remain unsupported in the native path.
- Added regression tests and a real native 3D MP4 smoke test.
- Renderer decision: retain ImageMagick as the compatibility rasterizer and keep the current Cairo/Pango native baseline. Added a pinned Linux x64/arm64 Q8 vendor installer for ImageMagick 7.1.2-36 (8-bit output avoids unnecessary Q16/HDRI memory overhead) with SHA-256 checks, SVG/complex-text delegate verification, shared-library validation and atomic replacement. The runtime resolver prefers explicit configuration, then the packaged binary, then PATH. The portable x64 binary was tested against a real Coenx 3D MP4 render; it depends on host glibc and libgomp. Evaluate Skia as a future native 2D replacement only after comparing build size, CPU throughput, memory, text quality and distribution complexity. The future 3D scene graph remains a separate Three.js milestone.

## 2026-11-22: Sprint 2 — Targeted Learning completion + performance/resource fixes (agent swarm, 11 tasks, all verifier-passed)

- Bug #2 (2026-11-09 RSS → 15.8 GB ingest crash) ROOT CAUSE FIXED: TXT/DOCX parsers stamped every outline entry `page: 1`, so `buildSectionsFromOutline` duplicated the entire book text once per heading. Sections now tile page text between headings via character offsets (120-heading 277 KB book: Σ section text 33.0 MB → 0.277 MB; chunk-stage RSS 380 → 108 MB; `headings=80 → sections=80, sectionBytes=bookBytes` end-to-end). minChunkTokens rescue added so correctly-tiled micro-chapters still produce indexable chunks; split-section-id/FK contract regression-tested.
- Arabic RTL chunk-extraction garbling (bug #11) fixed at two roots: digit-aware sentence splitting (decimals like `3.5` no longer split; real Arabic boundaries intact; unterminated trailing text no longer dropped) and `text_norm` now stores `normalizeForSearch` output while display `text` stays raw — `chunks_fts` finally matches retrieval normalization. Pre-fix books need re-ingest (NORMALIZER_VERSION bump deferred until the migration-job runner exists).
- Grounding numeric-claim verification (bug #4) implemented: new `grounding/numeric.ts` folds Arabic-Indic/Fullwidth digits to ASCII, handles thousand/decimal separators (Arabic `٫` decimal, `٬` grouping, `1.000`→1000) and percent; verifier check #3 requires cited chunks to contain every asserted figure; `VerifiedCitation` extended additively (`numericClaimsGrounded`, `ungroundedFigures`); failures named in retry prompts.
- Silent-failure hardening: all 9 `catch: () => null` mappers in parsers/sqlite-vec/hybrid replaced with typed errors or recorded diagnostics (empirically confirmed the old pattern short-circuited Effect generators with null errors — the 2026-11-09 `error:"null"` incident mechanism). `@ts-nocheck` removed from parsers, embed pipeline and eval (TS2590 resolved with a narrow factory cast).
- Dead Phase-1 pool stub deleted (`ingest/pool.ts` + dangling export + stale comments; no HTTP pool-status endpoint ever existed) with a reintroduction-guard test; `embed-pool.stats()` added for observability; ingest-time `parsed`/`chunked` retention pruned.
- New automated ingest-under-load stress test (`test/ingest-load.test.ts`): 400-page book through the real orchestrator asserts bounded in-flight vectors (≤ concurrency×batchSize), per-wave `chunk_vecs` checkpointing, monotonic progress, post-completion cleanup; plus an outline-heavy variant pinning the tiling fix.
- Memory: `mergeNodes` now transactional via additive `IndexerService.runInTransaction` (plan → single SQLite transaction with in-transaction verification/rollback; fs-mirror writes after commit, documented limitation); naive `String.includes` duplicate-content detection replaced with normalized containment (NFKC/case/punctuation/Arabic-harakat); failure-injection tests prove no partial state. Suite 10/10 ×3.
- Retrieval: FTS implicit-AND on heuristic-rewritten follow-ups fixed — `(re: …)` marker stripped in `runBm25` term-building (dense path still embeds the raw query; native engine deliberately unstripped); 8 regression tests incl. real FTS5 end-to-end.
- Server: production route graph could not resolve `@diveeoi/RemoteSession` — every authenticated instance request died "Service not found"; `RemoteSession.node` added to `AppServices.serviceNodes`; pre-existing `httpapi-instance.test.ts` went 0/7 → 7/7. New TL route integration suite (26 tests) boots the full `HttpApiApp.routes` tree offline with temp XDG roots; settings PATCH deep-merge semantics verified against on-disk config.
- OCR e2e: REAL-mode verification offline (pinned `eng.traineddata` sha256 match → tesseract.js WASM; scanned PDF → OCR → chunks → searchable) plus `TL_OCR_E2E_MODE=mock` fallback; 4/4 ×3.
- Frontend first paint (bug #10): entry JS 1793.7 KB → 904.1 KB (−49.6%; gzip 536 → 273 KB) via lazy MarkedProvider (marked+katex+shiki) and lazy file viewer, and Effect runtime removed from the entry path; app unit suite 451/451.
- Library UI: failed books no longer render a literal `null` — `displayBookError` helper with i18n fallback (`targetedLearning.library.errorUnavailable` added to all 18 locales) + full-error tooltip. TL settings-v2 tab verified mounted (no wiring fix needed).
- Eval tooling for the three hardware-gated Retrieval-V2 TODOs: `tl:eval` CLI (pluggable real/standin/student embedder, golden-set schema v2, recall@k/MRR/nDCG/gate/refusal metrics, p50/p95 latency, peak RSS, student-vs-teacher comparison, promote.py-matched gate verdicts), 2-book synthetic fixture, 23-test harness suite. Live runs stay open for a GPU/model host.
- Verification: dedicated verifier agent per task (11/11 PASS or PASS-WITH-NOTES after independent re-runs, adversarial probes and cp-backup mutation checks) + global gate: smoke 5/0 GREEN, learning 321 pass / 2 skip / 0 fail, memory 10/0, app i18n 5/0, server TL 26/0 + instance 7/7. Full evidence in `agent-ctx/results/`, `agent-ctx/verifications/` and `agent-ctx/EVENTS.log`.
- Known follow-ups recorded in TODO.md §11 (store/index.ts mappers, retained-heap assertion, re-ingest migration, docs sweep, 400-shape unification, Phase-C orphan-file cleanup, TOC attribution refinement, server tsgo typecheck on a larger machine).

## 2026-11-22: Sprint 3 — Section 8 repo hygiene / build / housekeeping (agent swarm, 5 tasks, all verifier-passed)

- Patch hygiene: registered the two meaningful orphan patches — `@silvia-odwyer/photon-node@0.3.4` (runtime dep of db+server; its wasm fix is now provably applied: installed copy has zero `module.exports.__wbg` remnants and a runtime `new_from_base64`+`resize` probe exits 0) and `@npmcli/agent@4.0.2` — and deleted the three whose target versions no longer resolve (`gcp-metadata@8.1.2` → lock 8.1.3, `pacote@21.5.0` → lock 21.5.1, `@standard-community/standard-openapi@0.2.9` → absent). `@ff-labs/fff-bun` patch re-keyed 0.9.3 → 0.9.4 (patch context matches exactly; applied copy verified via `FFF_LIBC` marker). `bun install` green; frozen-lockfile dry-run exit 0; bun.lock diff audited with no version churn; bogus-entry mutation check fails install hard.
- Dead code deleted after zero-reference proof: `packages/plugins` (single un-wired file importing non-existent `@opencode-ai/*`), the `ocred` (7.7 MB) + `ocread` prebuilt Go binaries (Go sources kept; `.gitignore` guards rebuilt names; `packages/mcp/README.md` documents the source-only status), and the vestigial `packages/server/migration/` drizzle output (duplicated the real db migration, which even carries an idempotency guard).
- `third_party/motion-graphics` submodule initialized at the pinned commit `3d83d98…` (matches the index gitlink; `.gitmodules` unchanged; superproject tree stays clean).
- Dockerfile production start fixed: the image already builds the single compiled Bun standalone executable; a `RUN cp` promotes it to `/usr/local/bin/diveeoi` and `CMD` became exec-form `["/usr/local/bin/diveeoi"]` (clean PID 1/SIGTERM). HEALTHCHECK, VOLUME /data, EXPOSE 4097, NODE_ENV=production preserved. Verified by construction (build.ts emits exactly one matching binary; no Docker daemon in the dev sandbox — record a `docker build && docker run` smoke on a real host).
- `REMINDERS.md` deleted (heading-only file; the live reminders feature is DB-backed and never reads it).
- `tools/self-hosted-ci` verified clean with Go 1.27.4 in /tmp: `go vet ./...` zero findings, `go test ./...` 36/36 — decision: KEEP; README documents `make check` / `go vet && go test`.
- `tests/fixtures/` documented (per-fixture purpose/origin/consumers, origin commits re-verified) + `check-fixtures.ts` integrity script (20 checks).
- Favicons single-sourced: `packages/ui/src/assets/favicon/` canonical; 3 unreferenced exact duplicates deleted from `brand/generated/` (sha256-verified); 22 kept brand variants have zero hash overlap with canonical; `brand/README.md` + `scripts/check-favicons.sh` drift checker (mutation-verified).
- `docs/plans/INDEX.md` created (3 LIVE / 6 SUPERSEDED / 1 UNBUILT-ROADMAP / 9 ARCHIVED, each with evidence) and `.draft-01…09` archived to `docs/plans/archive/` (all 9 sha256-identical to HEAD blobs); `.draft-10` stays at root as the live unbuilt roadmap.
- Hyperframes: trial-flagged "history" blocks removed from both SKILL.md files; suite decision KEEP as vendored external-ecosystem content, documented in the new `skills/README.md` (zero product wiring re-verified).
- New follow-ups recorded in TODO.md §11: `/favicon-light.svg` 404 (missing from `app/public/` and the server `PUBLIC_UI_PATHS` allowlist), combined-run server-test inter-file contamination, docker-build smoke on a real daemon, pacote 21.5.1 tarball-fallback bug re-derivation note.
- Verification: dedicated verifier agent per task (5/5 PASS-WITH-NOTES after independent re-runs, counterfactual/mutation checks and scope attribution) + coordinator global gate. Stale doc references touched by the hygiene work were fixed in PROJECT_GUIDE.md, docs/development.md, docs/architecture.md, docs/PROJECT_MAP.md and tests/fixtures/README.md. Full evidence: `agent-ctx/results/6-*-result.md`, `agent-ctx/verifications/7-*-verification.md`, `agent-ctx/EVENTS.log`.

## 2026-11-22: Sprint-3 follow-up — light-scheme favicon 404 fixed

- `packages/app/index.html:8` references `/favicon-light.svg` for `prefers-color-scheme: light`, but the file was neither shipped in `packages/app/public/` nor allowed through the server's `PUBLIC_UI_PATHS` allowlist (both gaps found during the sprint-3 favicon single-sourcing audit). Fix: copied the canonical `packages/ui/src/assets/favicon/favicon-light.svg` byte-identical into `packages/app/public/` (sha256-verified, same convention as the other 11 public favicons) and added `/favicon-light.svg` to `PUBLIC_UI_PATHS` next to `/favicon.svg`. `isPublicUIPath` sanity-checked (GET true / POST false / unknown false); smoke 5/0 GREEN, server TL 26/0 and httpapi-instance 7/7 re-run green. (Server `tsgo` typecheck still OOMs in this sandbox — known §11 item.)

## 2026-11-22: Sprint 4 — UI bug round from the 2026-11-09 manual test (re-verified against HEAD)

Re-verification + fix round for TODO.md §2 items #5–#9/#15 that were still open after the ingest-focused rounds; full diagnosis written up in `docs/testing/2026-11-09-ui-test/docs/fix_round6.md`.

- #5 "New session" banner dead (no network call): `openNewSession()` silently returned with no open project and the group headers only wired the handler when a project existed. Fixed with a picker-fallback — the CTA is now always live; with no project it opens the directory picker and starts the session on the first picked directory (`chooseProject(conn, after)` gained an `after` callback); both session-group headers pass the handler unconditionally.
- #6 Composer Send button dead (Enter worked): Enter/Send share `handleSubmit`, so the click was lost in the implicit form-submit chain through the Kobalte button + tooltip trigger. Both `data-action="prompt-submit"` IconButtons (v2 + normal composer) now call `handleSubmit(event)` explicitly on `onClick` with `preventDefault()` to suppress double-fire.
- #7 @ mention popup missing books (regression): the old loader was a single fragile chain — any failing `/targeted-learning/health` call (stale-cookie 401, 503 bootstrap, non-JSON) cleared the options with no retry; agents/files come from other sources, matching the symptom exactly. New resilient loader `prompt-input/book-options.ts`: only an authoritative `booksDbAvailable: false` short-circuits, `/books` retries ×3 with delay, stale loads (server/directory switch mid-flight) dropped via `isStale`, never throws. 9 new unit tests.
- #8 "No sessions found" + SSE 401/503: diagnosed, no HEAD defect — "No sessions found" is the empty-projects corollary (Home queries open projects of the focused server only); SSE 401 is the stale-cookie re-auth case on the shared session; 503s are the workspace-routing middleware's transient "broken sync connection" during bootstrap. UX follow-up (re-login prompt on 401) recorded in TODO.md §11.
- #9/#15 citation-verify false "not shown to the model this turn": `grounding/turn-state.ts` reworked into a sliding recent-turns window (`CITATION_TURN_WINDOW = 10`) — start-of-turn pushes a fresh set instead of wiping history, `getRetrieved` returns the window union, `post.ts` no longer wipes state at end of turn; bounds preserved (20k ids/session across the window with oldest-first eviction, 2 048-session LRU, 30-min TTL). 5 new window tests; existing verifier/memory suites unchanged.
- Gates: smoke 5/0 GREEN; memory 10/0; learning 326 pass / 2 skip / 0 fail; app `test:unit` 460/0; server TL 26/0 + instance 7/7; `tsgo` typecheck clean for packages/app and packages/learning.

## 2026-11-23: Release day — monorepo verification, release 1.19.7, HTTP API exercise unblocked

Section-1 ops/release blockers from TODO.md worked in the dev sandbox (4 GB / 2 cores; VDS-side actions marked as such).

- Production binary REBUILT from current source: linux-x64 standalone at `packages/server/dist/@diveeoi/server-linux-x64/bin/diveeoi`, self-reports `DiveeOI 1.19.7` (upstream-gated derived version), turbo build 5/5 with build smoke test passed. Deploy + user-approved `diveeoi.service` restart remain VDS-side ops actions.
- Full verification on HEAD `00a1cf0`: typecheck PASS for every package with a typecheck script except `server` (its `tsgo --noEmit` OOM-reproduces at ~3.5 GB RSS — the documented wrinkle; needs the 32 GiB VDS). Per-package tests all green (coenx-video, db 1082/1082, effect-drizzle-sqlite, http-recorder, learning, llm, memory, profiler, ui, app, server 215 files in memory-sized chunks). Root `bun run build` PASS.
- Bugs found and fixed during verification:
  - REAL production bug — file-picker lazy-index race (`packages/db/src/filesystem/search.ts`): the lazy ripgrep crawl was forked fire-and-forget so cold `find()` calls served an empty index (`findFile` → `[]`); first caller now joins the scoped fiber.
  - HTTP API exercise effect mode: `ChildProcessSpawner`/`FSUtil` were never provided — machine tools + skill/apply_patch failed at `ToolRegistry` init. Now provided in `AppLayer` (`effect/app-runtime.ts`) AND the route-tree composition (`server/routes/instance/httpapi/server.ts`); `tool.ids` effect-mode scenario passes, zero `Service not found`; auth mode re-verified 194/194. The 58 missing scenarios are FORMALLY ACCEPTED as debt (tracked in TODO.md §1).
  - Five minimal test stacks missing `RemoteSession.Service` (instance-context, promptasync-context, session/prompt, tool/glob, tool/grep) — provide `RemoteSession.defaultLayer` explicitly.
  - `httpapi-v2-location` SSE schema: filesystem-scoped events omit `location.project` → optional now.
  - `plugin/openai-ws` upgrade-rejection message made Bun-version-portable (pinned 1.3.14 vs Node wording) — the Bun 1.4.4-vs-1.3.14 mismatch resolution in the safe direction: everything verified on the pinned 1.3.14.
  - db location-layer fixtures updated for the two coenx-video tools; stale tool-parameters snapshots regenerated.
- Release cut: CHANGELOG `Unreleased` → **1.19.7 (2026-11-23)** (first tag since the fork), server+app version bumped, `v1.19.7` tag. Turbo strict env fixed (`globalPassThroughEnv` now carries `DIVEEOI_VERSION`/`DIVEEOI_BUMP`/`DIVEEOI_RELEASE`/`DIVEEOI_CHANNEL`) so release builds can pin versions explicitly.
- Verified-in-source (no code change needed): ingest `error:"null"` fix (pipeline import → typed `EmbedError`, `run.ts` `util.inspect`), Bug #2 budgets (`d9ce5bc`) with regression tests, FTS anchor-content migration registered (`migration.gen.ts:54`) — its live-DB run happens at first boot of the rebuilt binary.
- Still blocked on production access / credentials (documented in TODO.md §1): service restart, Bug #14 on-binary verification (no stall fix has landed in source), math-book recovery (`Mathematics-EN-Part1.pdf` on VDS), OpenRouter/AgentRouter live checks, mobile QA.

## 2026-11-23: TODO §5 (Memory system) + §6 (Server / core) — full sweep

Sandbox was recycled between sessions; repo re-cloned from origin/dev at cb93415 (release 1.19.7) and `bun install` re-run before any work.

**Memory (§5):**
- Daily consolidation wired: decision REQUIRED (extraction adds nodes every session; without maintenance, duplicates accumulate until someone manually consolidates). `SessionMemoryIntegration.runConsolidationMaintenance()` (gated on `consolidation.enabled`) called by the scheduler's daily tick after extraction, failure-isolated. `ConsolidationService` is now exported from `@diveeoi/memory` (it was previously unreachable from the server).
- `executeStream()` implemented in all three SQLite adapters (materialize-under-acquired-connection + `Stream.fromIterable` chunking); en route fixed statement PREPARATION outside the try block in all six run/runValues fns (bad queries died as defects, not `SqlError`). 3 new tests + migration suite green.
- Memory-integration verification list executed as real tests: `memory-integration.test.ts` (real Memory node + integration + REAL scheduler with Session service; context loading incl. hostile-content XML escaping; CRUD; real maintenance; scheduler next-run/extractNow incl. missing-session tolerance; 8 tools + status/toggle vs valid/empty/missing/invalid — 44 assertions) and `memory-disabled.test.ts` (child process with `DIVEEOI_DISABLE_FEATURES=memory`: no-op layers, unregistered route, skipped tool import). Verification surfaced + fixed: scheduler `extractNow(missingSession)` failed uncaught (now logs+skips); extractor node IDs contained UUID hyphens violating `NODE_ID_REGEX` (would fail any later merge's Phase C) — now `generateNodeId()`.
- MEMORY_REVIEW_1/2/3 criticals re-checked at current file:line: path traversal / non-atomic merges / O(n²) queue CLOSED; prompt injection PARTIAL → residual closed (`sanitizeUntrusted` neutralizes `</conversation>` break-outs). Remaining review items recorded as §11 tickets (extraction idempotency, multi-node transaction, `updateNode` wikilink race, indexer DDL/user_version).
- GraphView: DECIDED — keep as the future Settings→Memory inspector visualization (currently ZERO consumers; file also has a mock demo export); needs a memory graph/stats endpoint + tab + i18n (§11).
- Memory suite 10/0; memory+learning tsgo clean.

**Server / core (§6):** tool.ts dead type removed; agent provider bleed → `Provider.requestCapabilities`; transform.ts surrogate fast-path; **`Env.set`/`Env.remove` were silent no-ops (unyielded `Effect.sync`) — fixed + runtime contract documented; provider Bedrock/sap-ai-core now publish keys through Env**; plugin init failures routed through `publishPluginError`; formatter `backend` alias (ruff/uv disable as a unit, config-key↔registry-key mismatch handled); workspace sync fiber now fails via `tapError` (FiberMap drops + restart allowed); api `pty.connect` gained the graceful-shutdown tracker (`pty-ws-tracker.ts` + routes.ts layer); **watchdog interrupt-and-restart finished** (per-session supervisor in the instance scope, cancel + diagnosis-injected restart, cap 3 → pause + degraded event; live test drives a hanging LLM through the full path); copilot Chunk typing made concrete (`ZodType<OpenAICompatibleErrorData>`); RECORD drift fixed (`isRecordMode()` + READMEs); opencode facade gained `layerWithDatabase` storage injection.
- Decisions recorded in TODO.md §6: pricing stopgap stays (models.dev lacks reasoning rates); default-first-org until a choose-org UI exists; v1 stays canonical for session messages (v2 = flag-gated mirror; deleting the v2 half is the eventual pure deletion); hash-match migration fallback stays fail-loud BY DESIGN; gitlab-duo suite stays commented until rewritten against current APIs.
- Gates: db 1082-test file set + executeStream/migration suites green (db typecheck exit 0); memory 10/0; server prompt.test 56 (1 skip), instance/registry/retry 52/0, format+control-plane+plugin 189/0, smoke 5/0 GREEN; api/db/memory/learning/effect-* typechecks exit 0 (server tsgo still OOMs in this 4 GB sandbox — §11).

## 2026-11-23: TODO §1 — 58 missing HTTP API exercise scenarios written (route coverage complete)

Sandbox recycled again; repo re-cloned at 5a14e92 and `bun install` re-run. Coverage mode listed exactly 58 routes without
scenarios (8 auth, 4 prefs, 10 tasks, 3 composer-key, 2 global, 1 session anchor, 26 targeted-learning, 4 console).

- **Scenarios (all 58)**: `/api/auth/*` exercise the real register→login→refresh→Bearer flow against the isolated DB (first
  registration claims the admin role); `/api/prefs/*` set/list/delete/deleteScope (delete asserts the shipped 200-empty
  body and documents the declared-204 drift); `/api/v1/tasks/*` seed tasks through the real create route (create paused,
  get/update/cancel/pause/resume/run/generate/events); `/config/composer-key` ordered status→set→remove against the
  XDG-isolated secret store; `/global/features` full shape; `/session/{id}/anchor` empty-until-compaction contract;
  `/targeted-learning/*` setup (status/cancel/repair/import-local 400/start), settings (get/update/schema/presets),
  system (health/debug/probe), books (list/upload/import/delete), jobs (list + pause/resume/cancel/retry on unknown ids),
  search inspector, memory (list + student pin/delete via the real memory service + note delete via a seeded book row);
  `/experimental/console/{login,poll,cancel,logout}` run the RFC-8628 device flow against a local fake console (login
  asserts attemptID/userCode/verificationURL/cadence; poll reports pending; logout tolerates unknown accounts).
- **Harness**: `ctx.request` seed helper (seeds drive real routes through the same in-process app), `protectedJwt` policy
  (`/api/auth/*` bypasses Basic auth, so me/refresh/profile only probe the 401 leg), `onlyIn(...)` mode scoping.
- **Two real hazards fixed in the harness**: (1) the exercise ran from inside the developer's checkout — auth-mode probes
  carry no directory header, so fallback instance resolution hit THE REPO and worktree/workspace routes allocated full
  repo worktrees (155 MB each, two per auth run) — the exercise now `chdir`s into its XDG-isolated root and the three
  worktree routes decode-fail their probes; (2) `POST /global/restart` has NO payload schema, so the scenario's
  decode-fail trick was silently ignored, the handler re-execed the exerciser itself (`childArgs()` replays argv) and
  scheduled a real `process.exit` — fork-bombing earlier runs (that cascade also wiped `node_modules/.bun` twice via
  install-interrupt rollbacks). The scenario is now `onlyIn(coverage, effect)` and stubs `process.exit` while pointing
  the re-exec at a no-op script (restore via a properly-typed `Effect.addFinalizer(() => ...)` — the first version passed
  an Effect instead of a function, which defected scope close and hung the runner).
- **Bonus production bug found by the new coverage**: `Anchor.create` INSERT omitted the NOT NULL `time_updated` column —
  `POST /session/{sessionID}/summarize` (compaction) returned 500 on every call with the anchor feature enabled. Fixed in
  `packages/server/src/anchor/anchor.ts` (both timestamps written); `test/anchor` 34/34 and compaction+prompt suites
  re-verified.
- **Gates**: coverage **252/252, missing=0, extra=0** with `--fail-on-missing --fail-on-skip`; auth **251/251** (restart
  excluded by design); effect **252/252** across four chunk runs (73+79+139+31; TL-books→search re-covered) — every
  scenario passes. TL setup-start pins its download endpoint to a local 404 server so no model is downloaded; all seeds
  are XDG/DB-isolated per run.

## 2026-11-23: storage-aware I/O governor — HDD-friendly file operations with device-class visibility

Ask: the project's file operations must be gentle on spinning disks (no thrashing, low pressure), while still KNOWING what
medium each operation touches (ssd→ssd / ssd→hdd / hdd→ssd / hdd→hdd / network) so pacing can speed up or calm down.

**New subsystem `@diveeoi/db/io` (packages/db/src/io/):**
- `storage.ts` — classification: path → st_dev → major:minor (new-style dev_t decode) → /sys/dev/block walk up to the whole
  disk owning `queue/rotational` (partitions have no `queue/`); name heuristics (nvme/vd/mmcblk → ssd); network filesystems
  via statfs magics (nfs/cifs/smb/9p/afs/ocfs2); device-mapper and loop devices report unknown. Everything cached per device;
  everything degrades to "unknown" (conservative pacing) off Linux / in containers. `describeIo(src, dst)` → direction label
  ("ssd→hdd") + the slowest end as the pacing input.
- `pressure.ts` — live I/O pressure, 2s-cached: PSI /proc/pressure/io first (kernel's own stall percentages), then
  diskstats io_ticks delta per device (classic %util), then loadavg; levels calm/busy/saturated.
- `governor.ts` — lanes (copy/worktree/ingest/download/index): slow media (hdd/network/unknown) serialize ALL heavy lanes
  through ONE slot per device key (seeky disks die from concurrency, not throughput); SSDs get per-lane limits (2, index 1)
  scaled down by the adaptive resource profile (constrained ×0.5, critical → 1). Saturated pressure defers new heavy work
  before queueing (bounded 5s, then proceeds — never spins). `pacedCopyFile` copies sequentially in 1 MiB chunks, sleeps
  2/15ms between chunks under busy/saturated pressure, no per-chunk fsync. Nested same-slot calls run inline via an
  AsyncLocalStorage held-slot guard (the ingest → OCR-pack-download re-entrancy deadlocked the first version — caught by
  the learning OCR e2e suite, fixed + unit-tested). Real-time safety valve: a queued acquisition waiting >120s
  (DIVEEOI_IO_LANE_FORCE_MS) logs a warning and forces through — deadlocks surface, never hang. Bun quirk found en route:
  `AsyncLocalStorage.run` does not return promise-returning callback results — capture by assignment, and create the async
  body INSIDE the callback so continuations inherit the held-slot context.
- Wired: worktree create-boot/remove/reset lanes (the 155 MB+ checkouts), learning model downloadManifest + local model
  import (download lane), book ingest (ingest lane), filesystem lazy index crawl (index lane, no defer — user-on-demand).
  Adaptive service pushes its profile into the governor at init + every retarget. Off switch `DIVEEOI_IO_GOVERNOR=off`;
  `ioGovernorStatus()` for diagnostics; every governed op logs `io[ssd→hdd] lane=… op=… done in …ms`.

**Gates**: db io tests 38/38 (classification, dev_t decode, PSI/diskstats parsing, thresholds, lane limits, device-level
serialization, profile scaling, deferral + bounded valve, nested re-entrancy, paced copy correctness + direction label);
db adaptive/filesystem suites green; learning 328/328 in 9s (the OCR e2e that deadlocked the first governor version now
passes); server worktree exercise scenarios 5/5 with lanes; smoke GREEN 5/0; db + learning typechecks exit 0 (server tsgo
OOM = known 4 GB sandbox limitation). DB pragmas untouched (WAL + NORMAL + autocheckpoint already HDD-sane) — HDD-specific
checkpoint tuning recorded as a §11 follow-up.

## 2026-11-24: coenx-video WP4 bounded filter/effect graph + renderer roadmap close-out (WP2–WP6) + video preview UI

Ask: complete the "3. coenx-video renderer" roadmap item and its hand-off plan fully — Rust renderer, TS bindings,
logic & rendering, the sidebar-tab UI (same panel as exams / book previewer), all tools and agent guidance, and a
real LLM end-to-end test with the bundled opencode models as the default.

**WP4 — bounded filter/effect graph (`packages/coenx-video`):**
- Model: `NodeBase.effects[]` (`blur` σ≤64, `drop-shadow` σ≤32/offsets ±128, `color-adjust` amounts 0..4/hueRotate
  ±360; max 4 effects per node; padded temporary surface ≤ 8,388,608 px per node). Validation in the new
  `model/validate-effects.ts`; mesh3d rejects effects.
- Defined semantics identical on every backend: chain applies to node content BEFORE clip/mask/opacity, in list
  order (SVG rendering model); blur/shadow radii are Gaussian sigmas; color-adjust follows CSS
  brightness/contrast/saturate/hue-rotate (combined 4x5 feColorMatrix).
- Static + interactive SVG: generated scoped `filter` defs (feGaussianBlur / feDropShadow / feColorMatrix) with
  userSpaceOnUse padded regions, deduplicated per identical (chain, node dims) — same dedup rule applied to the WP1
  clip defs (the last WP1 leftover). No caller-provided SVG filter markup can enter the pipeline.
- Canvas: padded node-box offscreens; CSS filter chain applied on the blit (feature-detected); when `ctx.filter` is
  unavailable the player dispatches `coenx:renderer-warning` and renders without effects — explicit partial
  capability, mirroring the gradient-spread precedent. Mask compositing refactored onto the same padded scratch
  pair (content → effects → mask in the offscreen, clip at the blit).
- Rust/Cairo: new `render/effect.rs` — node content rasterized into a node-bounded padded ARGB surface (AABB from
  rotate/scale + 3σ+offset pad, pixel-budget guarded), three-pass W3C box blur on premultiplied BGRA, drop shadow
  built from source alpha tinted + blurred then composited source-over-shadow, color matrices on unpremultiplied
  pixels; mask DestIn compositing on the effect surface; result blitted back in device space with the deferred
  resource clip active. `render_node` restructured for deferred clipping on the effects path.
- CML: node `filter="blur(4) drop-shadow(2 4 3 #000000) brightness(1.2) …"` attribute (repair-hint diagnostics with
  line/column) plus bounded stylesheet `filter`/`clip`/`mask` properties; stylesheet ALLOWED set extended.
- Capability matrix: `filter-effects` → supported (Canvas partial with degradation note); renderer feature lists now
  carry `filter-effects`/`masks`/`paint-resources`; authoring gap list updated. `coenx_video_reference` gained the
  `effects` topic; stale CML/gradient sections corrected (defs authoring, spread/transform, paint resources exist).
- Skills: core/language/rendering/validation skills updated in `.agents/skills/` AND the bundled copies; a new DB
  test enforces byte equality for the whole coenx-video catalogue (20 pairs), not just the rendering skill.

**WP1–WP6 close-out (code landed in the previous batch, now documented):** roadmap WP2/WP3/WP5/WP6 sections marked
implemented with verified evidence; issue register I-001/I-002/I-003 → RESOLVED, I-005 (telemetry/fixtures) and
I-006 (Zen free-tier outage) added; hand-off doc got a 2026-11-24 status header + §13 addendum; TODO.md §3 rewritten.

**Repo hygiene:** `model/validate.ts` split below the 300-line preference (`validate-nodes.ts`,
`validate-interactions.ts`, `validate-effects.ts`); effects helpers exported from the package root.

**UI — Coenx Video preview tabs (packages/app):**
- `video:<path>` tabs in the session side-panel tab strip (same slot as exam/book tabs): `video-tabs.ts` (tab id
  helpers + pending detail), `video-preview-panel.tsx` (streams the exported MP4 via the standard binary file
  endpoint `GET /file` → base64 data URL, cached per path; header with play icon, path, hint, close), rendered by
  `FileTabContent` and labelled by a new `VideoTabVisual` in `session-sortable-tab.tsx`.
- `video-side-tabs.tsx` bridge (mounted in `session-side-panel.tsx`): opens/focuses the tab and raises the review
  panel when a `coenx_video_export` tool part completes (same pattern as the exam bridge) or on the manual
  `diveeoi:open-video-preview` window event; re-focus never steals focus twice.
- `helpers.ts` activeTab logic extended for `video:` non-file tabs; i18n keys (`video.preview.*`, `video.tab.close`)
  added to all 18 locales with real translations.

**Real-LLM e2e (`packages/server/script/coenx-e2e-live.ts`):** fixed three real plumbing bugs found while running it
— server auth (explicit `DIVEEOI_SERVER_USERNAME/PASSWORD` + Basic header incl. the health probe), instance routing
(session-scoped calls now carry `?directory=` — without it the transcript lives in a different instance) and
completion detection (the V2 `/wait` endpoint is a hard stub returning 503; the script now polls the durable
transcript until tools settle and the fingerprint stabilizes). Provider catalogue switched from the offline fixture
to the live models.dev fetch (the fixture path is rejected by the rooted FS read → silently empty catalog). Verified
in-repo: server boots, auth works, session created, prompt admitted, `opencode/grok-code` resolves and is enabled
from the live catalogue. The final hop fails at OpenCode Zen upstream: every anonymous free model answers
`{"error":{"type":"server_error","message":"Upstream request failed: Model is unavailable."}}` (paid models return a
proper AuthError) — confirmed with direct curl probes independent of this repo, 2026-11-24. Recorded as issue I-006;
re-run the script when the free tier recovers.

**Gates**: coenx 115/115 pass (2 browser-runtime tests skip outside a browser; incl. 22 new effect tests, clip-dedup
fixture and the effects MP4 smoke), Rust 16/16 + `cargo fmt --check` + clippy `-D warnings` + offline release build,
DB coenx tool tests 17/17 (incl. the whole-catalogue parity test), coenx/db/app typechecks exit 0, oxlint clean
coenx-wide, app pre-existing component-test failures unchanged (stash-verified identical 16 fail / 12 errors).

## 2026-11-26 — interactive world verification sweep (sandbox)

- Recovered the repo after a sandbox reset by fast-forwarding to origin/dev (19 commits) — all previous interactive-runtime work survived because it had been pushed.
- Built the Rust sidecar on this machine (cargo 1.100.0 via rustup, `bun run build:native` in `packages/coenx-video`, 42.6s release build); native-video + live-physics suites pass 14/14 against the compiled binary, so the native/Cairo path is active.
- Booted the real stack (server :4097 + app :3000), signed in, opened a session and played `exports/world-showcase.coenx4` in the `CoenxInteractivePanel` with agent-browser. Found and fixed three real bugs:
  1. `CanvasVideoRenderer.draw()` reset the context transform to identity, discarding the stage->backing scale — at any display size other than the stage size the world clipped to the top-left corner (ball/floor/right wall invisible). `draw()` now re-derives the scale; the canvas smoke test probes through the mapping.
  2. The panel mounted the player paused with no playback control — added restart + play/pause to the panel header (handle in a Solid signal, i18n keys in all 18 locales).
  3. `setNode` color overrides ignored solid-fill shapes — `applyNodeOverride` now restyles `fill` on rect/ellipse/button as well as text color.
- Live proof: click-kick runs the statement list (HUD "hits 1" via concat expression), kinematic drag tracks the pointer and release keeps the fling velocity, collide events increment the bounce counter, and the new molecules heat chamber heats 0->600 K (molecules turn orange, motion speeds up, "temperature 300 K · bumps 210" HUD) and cools back to blue.
- New molecules heat-chamber scene in `scripts/world-showcase-composition.ts` (gravity-free gas, 24 bodies, per-molecule impulse+color interactions, collide bump counters); packed via `bun scripts/pack-showcase.ts`.
- Updated all agent-facing instructions for the world model: interactive + physics skills (both `.agents/skills` and bundled copies), the coenx authoring-language reference, package AGENTS.md, root AGENTS.md, README, docs/coenx-video.md, CHANGELOG, TODO. Whole-catalogue skill parity test green (17/17).
- Full coenx-video suite: 164/164.
- Pushes: commits 14411d5, 4121117, a9e8c14 are local-only because the sandbox lost GitHub credentials in the snapshot reset — push `dev` from a machine with auth as the first action of the next session.

## 2026-11-27 — low-end machine pass on the interactive player (sandbox)

- Question driving the pass: does the whole stack (server + browser + TL retrieval + interactive coenx4 playback) run well on the reference low-end machine — 8GB DDR4 / i5-10th gen / MX250 / 15GB NVMe swap?
- Audit result: server + TL were already bounded (adaptive profiles land balanced/constrained on 8GB, SQLite cache 64-128MB, sqlite-vec KNN keeps vectors on disk, embeddings int8 batch 16); the app panel already caps the player at maxFps 30 / DPR 1.5. The player hot path itself had real waste; fixed in commit 8c6219f:
  1. Two forced layout reads per frame (render + sizeCanvas) -> one shared read.
  2. Scene evaluated twice per frame (hit-testing + drawing) -> one shared evaluation (canvas + svg draw() take optional pre-evaluated nodes).
  3. Per-step physics allocations (array + 2 Sets per step, up to 12 steps/render) -> zero (reused buffers, overlapping-set ping-pong, squared-distance rejection before the sqrt).
  4. Pose/override merge rebuilt every frame -> skipped while idle/settled via new InteractiveEngine.overridesVersion guard; posesInto() pooled API added (poses() still returns owned snapshots - impulse test caught the aliasing, semantics preserved).
  5. Grain tile cache guaranteed a miss every frame (per-frame seed vs single-entry cache): 64KB ImageData + pattern per grain node per frame -> 8 deterministic seed buckets.
  6. Controls + transition CSS rewritten every frame -> value-signature dirty checks (state/value syncs stay unconditional).
- Fresh measurement: packages/coenx-video/scripts/bench-live-physics.ts (44 bodies, collide-heavy): median 0.0537 -> 0.0392 ms/step (-27%), identical 366 collision events. Suite: 161 pass / 0 fail; typecheck back to the 2 pre-existing script errors (scripts/pack-molecules-test.ts, scripts/world-showcase-composition.ts, stash-verified pre-existing).
- Docs: new "Low-end hardware target" section in docs/optimization.md (machine table, stack budget, before/after table, rules to not regress).
- Pushes: 8c6219f + the docs commit are local-only - this sandbox has no GitHub credentials (same as the 2026-11-26 note). Push dev from a machine with auth first thing next session; full-history bundle at download/DiveeOI-dev-backup-20261127b.bundle.

## 2026-11-27 (later) — native sidecars built + verified; low-end runbook completed (sandbox)

- Context: previous entry left 8c6219f + docs local-only (no git credentials in recycled sandbox; bundle at download/DiveeOI-dev-backup-20261127b.bundle). This session restored `dev` to ee0d2ce (fast-forward of origin/dev 0abc0b1 + the two local commits) from that bundle before touching anything; tree was clean at start.
- Rust toolchain installed in-sandbox (rustup stable 1.100.0 under /home/z/my-project/toolchain, persisted outside the repo). System libs cairo/glib-2.0/pango present.
- Built BOTH sidecars and proved them end-to-end:
  - `coenx-video-native`: `cargo build --release` 38 s, 607 KB. `simulate` bounce test: ball settles exactly on the static floor with restitution 0.6, statics hold position. New bench `scripts/bench-native-physics.ts`: 900-step 44-body batch = 0.083 ms/step end-to-end (spawn + JSON of 901 frames x 44 poses included) vs in-process JS 0.0389 ms/step — confirms the architecture split (interactive stays JS in-browser; native amortizes in the headless export batch + cairo render_frame).
  - `divee-retrieval`: `cargo build --release` 78 s, 4.0 MB. New verify script `scripts/verify-native-retrieval.ts`: builds a books.db with the production schema, one-shot `--query photosynthesis --vector-base64 ...` returns bio-c1 top with dense 0.998 / fused 0.033 — BM25+dense+RRF fusion working through the real binary.
- Suites after the installs: coenx-video 164 tests 0 fail (3 skip); learning native-engine 12/0; learning hybrid 14/0.
- Docs: new "Native sidecars on the low-end machine" subsection in docs/optimization.md (sidecar table, fresh side-by-side numbers, the three architecture rules, toolchain prereqs for the 8 GB laptop).
- Next session: paste the GitHub PAT again (the sandbox recycle loses it every time — it is never written to disk) and push `dev` immediately — the tree must go to GitHub before any further work.

- PUSHED: origin/dev 0abc0b11..8231687e (4 commits: 8c6219f low-end player perf, ee0d2ce low-end docs, 7a3a977 bench typecheck fix, 8231687 native sidecar verification). Tree clean; nothing left local.

## 2026-11-27 (evening) — context/token efficiency round, no information loss (sandbox)

- User ask: "improve the context window and token quota usage in diveeoi? without losing any context?" Explored agent mapped the whole prompt/context/quota architecture (8 waste sites); this round fixes all of them.
- Root changes (commit adafb2b8, PUSHED):
  1. Compaction-first window: estimate > usable() now creates a compaction (summary + Anchor preserved) instead of the silent oldest-turn slice; applyTokenWindow demoted to safety net.
  2. Cache-stable system split: system() -> stableParts/volatileParts; run loop routes every per-step block into systemVolatile; LLMRequestPrep emits it trailing. Prefix caches on the stable head survive reminder/todo/memory churn (Anthropic cache_control marks the first 2 system messages; the volatile tail invalidates only itself).
  3. Real budget tier: ContextBudget.compute gets last finished step's inclusive usage (input + cache.read + cache.write), parts-based fallback; tier gates + budget hint were dead at 0.
  4. Routing fit on inclusive tokens: composer context-fit sees the true prompt size; non-cached fit could route to windows that cannot hold the real prompt (413 -> compaction churn).
  5. session/estimate.ts: file/image/pdf parts counted (image 1600, pdf 2000, file 1000 conservative constants); previously 0 — window cut fired far too late on image-heavy sessions.
  6. Compaction tail estimate parts-based (was JSON.stringify: syntax overhead shrank the preserved tail).
  7. Memory-context boundary cut: sentence/line/space boundaries instead of blind 1800-char slice.
  8. Dead `<budget:token_budget>{tier}:{remaining}` line stripped from 9 base prompts + core/context-budget.md (unsubstituted literal on every call).
- Tests: new estimate.test.ts (8 pass). Green: compaction 52/0, prompt integration 55/0, memory 2/0, retry+message-v2+system 70/0, composer+free-tier 52/0, TL httpapi 27/0. httpapi-listen timeouts + full-suite OOM reproduce on clean base (stash-verified; environment-bound, not regressions). Server package tsgo typecheck still SIGKILLs in this sandbox (known).
- Forensics note: prompt.ts:141 looked syntax-corrupted in some reads this session ("sgssgs"); verified against GitHub raw + git cat-file + repeated sha256 — the committed file is healthy, the corruption was display/transport-layer flakiness in this sandbox, not repo content.
- Open follow-ups (not done this round): scheduler re-extraction quota gating (hash exists but active sessions with any new messages re-extract daily), applyTokenWindow system/tools overhead (tool schemas still uncounted — tools are built after the window cut), ContextBudget tier unit tests.

## 2026-11-27 (night) — truncated shell outputs -> tmp .output files + targeted-access guidance (sandbox)

- User ask: truncate long shell/bash outputs, persist the full output to a tmp `.output` file, and tell the agent it can access the full content at that path with targeted grepping (lines, matching text, ranges).
- Was already half-there: Truncate.output existed (app-data dir, no extension, two divergent hint texts; shell used its own terse "Full output saved to:"). This round (commit 185324d5, PUSHED):
  1. TRUNCATION_DIR -> os.tmpdir()/diveeoi-tool-output; files named tool_<id>.output. Cleanup (7-day retention) unaffected (Identifier.timestamp slices 5-17); agent read permission auto-follows Truncate.GLOB.
  2. Shared Truncate.accessHint(): states "output was too long — N <unit> truncated", the full path, and concrete access commands: grep -n "pattern" (matching text + line numbers), sed -n '100,150p' (line range), head/tail -50, wc -l. Task-tool agents also get the delegate-to-explore guidance.
  3. Shell reports what actually bound: bytes when the raw payload exceeded the byte cap, else lines.
- No content loss by design: model sees bounded preview, disk keeps the full output, agent re-enters via targeted commands or Read offset/limit.
- Tests: truncation 19/0 (extension, tmp location, round-trip, hint patterns, task variants), shell 23/0 (end-to-end), read 39/0, task+question+acp 28/0.

## 2026-11-27 — voice mode M1: gateway mounted, session stream → TTS, prompt-input voice pill

- `feature/voice-mode` on top of the M0 branch: `/voice/*` routes in the main server (authed listen + ticket-validated WS proxy + HTTP proxy), lazy gateway spawn in `packages/server/src/voice/bridge.ts`, `POST /voice/say` ingest + session mode in the gateway, voice pill + settings keys + EN/AR i18n + mic icons in the app, `/voice` vite proxy.
- Bridge speaks only assistant **text** parts (part-type tracking filters reasoning/tool deltas), sentence-chunks via the shared chunker, TTS language detected per sentence.
- Verified: bridge unit test over real HTTP (silent reasoning/foreign sessions, flush semantics, single-use tickets); server boot with the new layers; live authed flow (listen → ticket → gateway spawn; demo UI at `/voice/`; say-token guard). Voice tests 18/18.
- Owed: full tsgo typecheck (OOMs on the 4 GB sandbox — run on the Colab session), agent-browser QA screenshots of the pill (needs an LLM-configured app session), sidecar binary rebuild, vosk grammar boost (M2, needs a sidecar grammar API).
