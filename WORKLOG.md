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
