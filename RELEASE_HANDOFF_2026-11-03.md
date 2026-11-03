# DiveeOI Release & Engineering Handoff

**Snapshot:** 2026-11-03 21:57 UTC  
**Repository:** `/home/celestial-dev/DiveeOI`  
**Branch:** `dev`  
**Base commit:** `2f5b2c3cdf6d80af084369ff5ad662b49791a72b`  
**Runtime used for verification:** Bun 1.4.4, Node 22.22.1  
**Production service:** `diveeoi.service`, port 6050

> This document supersedes older build/test/deployment status statements in `COMPOSER_INCIDENT_HANDOFF.md`. That file remains useful for the original incident analysis and detailed Composer decisions, but some of its test counts and “not yet built” statements are stale.

---

## 1. Executive status

The current working tree has been typechecked and built. The new server binary starts successfully in isolation, serves the embedded UI, responds to an authenticated health check, and applies the pending database migrations against a disposable copy of the production database.

**The production service has not been restarted. The new build is not deployed.**

Current production process:
- `diveeoi.service` is active.
- Main PID observed: `914318`.
- Service start time: `2026-11-02 20:15:10 UTC`.
- Listener: `0.0.0.0:6050`.
- `/proc/914318/exe` resolves to the service binary path with `(deleted)`. The build replaced the on-disk executable while the existing process continued running its previous, already-open executable inode.
- The next service restart will load the newly built binary at the configured `ExecStart` path.

No sudo command was run and no production restart was attempted. The user explicitly asked to be asked before privileged deployment. Obtain that approval before running `sudo systemctl restart diveeoi.service`.

Repository state:
- HEAD is `2f5b2c3cdf6d80af084369ff5ad662b49791a72b` (`feat(composer): add consented heuristic fallback ranking`).
- Local HEAD matches its upstream tracking branch (`0 0` ahead/behind).
- Working tree is intentionally dirty: **64 tracked paths modified and 19 untracked paths** at the last snapshot.
- Changes have not been committed, pushed, or deployed. Do not reset, clean, commit, or push them without instruction.

## 2. What changed

### 2.1 DiveeComposer catalogue visibility and routing safety

Main files:
- `packages/server/src/provider/composer.ts`
- `packages/server/src/provider/provider.ts`
- `packages/server/src/provider/artificial-analysis.ts`
- `packages/server/src/provider/free-tier.ts`
- `packages/server/src/session/prompt.ts`
- `packages/server/src/server/routes/instance/httpapi/handlers/config.ts`
- Relevant tests under `packages/server/test/provider/` and `packages/server/test/session/`

The original incident was that DiveeComposer disappeared from the model catalogue if Artificial Analysis measurements were missing while local-heuristic ranking consent was disabled. Catalogue visibility had been coupled to request-route eligibility.

The recovery separates the two concepts:
- A synthetic `divee/composer` catalogue entry can remain visible when there is a valid, known-free representative model, even if no request route is presently eligible.
- Actual request routing requires a concrete selected provider/model target, retained through a route association (WeakMap).
- A display-only representative is never allowed to become the real request target. `Composer.model()` only returns a route-backed model.
- Missing authentication and missing catalogue candidates produce distinct no-route reasons.
- Do not weaken the free-only requirement to make the UI look populated. Unknown or missing pricing is not proof that a model is free; paid/unknown-price fallback must remain prohibited.

Provider availability no longer treats a non-empty `baseURL` as proof of authentication. The working-tree changes check usable credentials and resolved environment placeholders, interpolate nested provider options/headers, preserve the intended precedence of configured and stored credentials, support explicit auth headers, and account for keyless private/loopback endpoints. Provider filtering is kept instance-scoped so one instance's custom/plugin provider filtering does not mutate shared catalogue data.

Artificial Analysis remains optional. A persisted score cache can be loaded without an API key, so a previous valid cache can still inform ranking offline. Saving/removing the AA key clears stale cached data and refreshes provider state.

Free-tier error handling distinguishes:
- Provider-wide missing-auth failures, with a temporary five-minute auth cooldown.
- OpenCode free-model per-model key refusals.
- OpenCode free usage/quota exhaustion, with a one-hour provider-wide cooldown persisted through ComposerBans.

The concrete selected model/provider identity is retained in session/prompt processing. Error feedback should be associated with the real route, not with the synthetic `divee/composer` catalogue identity.

### 2.2 Settings V1/V2 and provider refresh

Main files:
- `packages/app/src/components/settings-models.tsx`
- `packages/app/src/components/settings-v2/models.tsx`
- `packages/app/src/context/server-sync.tsx`
- `packages/server/src/server/routes/instance/httpapi/handlers/config.ts`

Both settings implementations now expose the Composer settings:
- Use all configured providers.
- Explicit consent for local heuristic ranking when AA data is unavailable, with the reduced-accuracy warning.
- AA key save/replace/remove and configured-status handling.
- Fallback AA environment-variable name.

Provider queries are refreshed after relevant config/key mutations, including invalidation of global and directory-scoped provider queries. The browser receives key status, not the secret key itself.

Browser QA is recorded in `docs/qa/COMPOSER_BROWSER_QA.md`. Settings V1 and V2 were checked for visibility and config persistence. An isolated test verified AA key save/status/remove using a fake test key; that secret was removed afterward. A later V1/V2 smoke test against the existing service changed the two provider/consent booleans and restored their observed original values. No provider credentials were changed.

### 2.3 Vite API proxy

File: `packages/app/vite.config.ts`

The API proxy path boundary now accepts a slash, query-string delimiter, or end-of-path. This fixes API calls such as `/file?directory=...` being served the Vite app HTML instead of being forwarded to the backend. The proxied request was verified to return the backend JSON directory-list payload.

### 2.4 Preferences persistence repair

Main files:
- `packages/db/src/prefs/sql.ts`
- `packages/db/src/database/migration/20261102220154_20261102000002_preference_primary_key.ts`
- Generated schema/registry files and migration tests.

The Drizzle schema now models the actual composite preference key as `(scope, name)`. The migration rebuilds legacy preference data, removes duplicate keys by retaining the latest `time_updated` row (with `rowid` as a tie-break), and creates the intended composite primary key. This is needed for the preference upsert behaviour used to persist Composer cooldown/state.

A migration test covers duplicate repair and an `ON CONFLICT (scope, name)` upsert.

### 2.5 Anchor-content FTS bootstrap migration

File:
- `packages/db/src/database/migration/20261103001500_bootstrap_anchor_content_fts.ts`

Adds the bootstrap migration for the `session_content_fts` FTS5 table. This is registered in the generated migration registry. The migration was applied successfully to a disposable copy of the production database during the new-binary smoke test. It has **not** been run against the live production database yet.

### 2.6 Session notification deduplication

Files:
- `packages/app/src/context/notification.tsx`
- `packages/app/src/context/notification-domain.ts`
- `packages/app/src/context/notification-domain.test.ts`

The notification-domain helpers key session state by directory plus session ID, avoid duplicate failure notifications, suppress duplicate error events within a short window, consume the matching failure on the corresponding idle event, and derive a safe concise error description. Tests cover duplicate/late events and ensure a global idle event does not incorrectly consume a session-specific failure.

### 2.7 Test harness and test-runner fixes

Files:
- `packages/server/test/server/httpapi-exercise/backend.ts`
- `packages/app/happydom.ts`
- `packages/app/package.json`
- `packages/learning/package.json`
- `packages/profiler/package.json`
- `packages/ui/package.json`

Changes made to make the test environment match package/runtime expectations:
- The HTTP API exercise fixture now uses the server's default Basic-auth username, `DIVEEOI`, and attaches the expected Authorization header to ordinary harness requests.
- App unit tests run with the browser condition and the Solid/Vite happy-dom preload, fixing the missing `jsxDEV` runtime in that test context.
- Profiler tests use Bun isolation to prevent shared global profiler state from leaking between test files.
- Learning's default test command skips the live model-download smoke path. A separate `test:live` script exposes that network/model-cache-dependent check explicitly.
- UI tests use the app's Solid/Vite transform preload rather than running untransformed JSX tests.

These are test setup changes, not changes to the production test APIs. Review the package scripts before adopting them into a future release branch.

## 3. Verification results

### 3.1 Build and type safety

| Check | Result |
|---|---|
| Full monorepo typecheck | **Passed: 14/14 tasks** |
| Production build | **Passed** using `bun run build --current --force` |
| Build output | Server binaries and embedded app UI generated |
| Migration generator check | **Passed: no incremental schema changes** |
| `git diff --check` | **Passed** |
| Lint error-only scan | **Passed** with no error-level diagnostics |

The typecheck was rerun after the final test-harness edits using:

```bash
bun turbo typecheck --force --concurrency=2
```

All 14 typecheck tasks passed in approximately 19 seconds. Turbo emitted non-blocking Vercel remote-cache permission warnings; local tasks still completed successfully.

The production build completed with:

```bash
bun run build --current --force
```

It completed successfully (approximately 82 seconds). Vite reports large chunks above 500 KB; this is a warning, not a failed build. Available memory during the build was approximately 16 GB. The build used Bun 1.4.4, while the root package manifest pins Bun 1.3.14. The exact pinned Bun version was not tested in this pass.

The migration check must be run from the DB package directory:

```bash
cd packages/db
bun script/migration.ts --check
```

It completed with “No schema changes, nothing to migrate.”

The lint command that passed was an error-only scan, not a claim that the entire repository has zero warnings:

```bash
bun run lint --ignore-pattern '**/node_modules/**' --ignore-pattern '**/dist/**' --quiet
```

### 3.2 Test suites

| Area | Result |
|---|---|
| DB package | **1,047 passed**, 0 failed; 2,815 assertions; 133 files |
| Server package | **2,770 passed**, 14 skipped, 1 todo, 0 failed; 7,291 assertions; 21 snapshots; 212 files |
| App | **429 unit tests + 2 virtualizer tests passed**, 0 failed |
| Learning | **180 passed**, 2 skipped; live embedding download test excluded from the default command |
| LLM | **275 passed**, 30 skipped |
| Profiler | **30 passed**, 0 failed when run with isolation |
| UI | **68 passed**, 0 failed with the Solid/Vite preload |
| Effect Drizzle SQLite | **7 passed** |
| HTTP recorder | **33 passed** |
| Memory | **2 passed** |
| Focused Composer/provider/free-tier/AA/prompt suite | **214 passed**, 1 skipped, 0 failed; 622 assertions across 7 files |

**Assertion-count correction:** the older Composer incident handoff contains a 7,292 server assertion count. The final complete server-suite output for this pass was **7,291**. Use 7,291 unless a fresh rerun proves otherwise.

The full server suite completed successfully during this verification pass, but it was not rerun after the last isolated HTTP API exercise fixture edits. The server typecheck was rerun after those edits and passed.

### 3.3 HTTP API exercise runner: incomplete

Do not describe the HTTP API exercise as fully green.

- Auth mode exercised the 194 registered scenarios with **194 passing, 0 failed, 0 skipped**. The runner also reported **58 missing route scenarios** because the current route set contains additional routes without entries in the scenario registry. This mode was not invoked with fail-on-missing.
- Coverage mode uses fail-on-missing and therefore exits nonzero with those **58 missing route scenarios**. This is route coverage debt.
- After correcting the fixture's Basic-auth user and Authorization header, the effect-mode run still failed in the test harness at runtime with a missing Effect service: `effect/process/ChildProcessSpawner`, reached through the experimental tool ID route / `ToolRegistry.all()`. No successful effect-mode result is claimed.

These are known test-harness/coverage gaps. They are not evidence that the normal server unit suite, typecheck, production build, or isolated server smoke test failed. Follow them up separately; do not silently mark the whole API exercise green.

### 3.4 Isolated new-binary smoke test

The newly built server was started separately from production using temporary XDG directories, a disposable Basic-auth credential, and an isolated database. It listened on an alternate port.

Verified:
- Authenticated `GET /global/health` returned HTTP 200 and `{"healthy":true,"version":"1.19.6"}`.
- `/` returned HTTP 200 with HTML.
- The embedded JavaScript asset returned HTTP 200.
- The disposable SQLite database passed `PRAGMA integrity_check`.
- Graceful shutdown succeeded.

Both native Linux x64 and Linux x64 baseline outputs were generated. The systemd service is configured to use the baseline binary path:

`packages/server/dist/@diveeoi/server-linux-x64-baseline/bin/diveeoi`

The production health endpoints reject unauthenticated requests with HTTP 401. That is expected because the service is Basic-auth protected; do not interpret an unauthenticated 401 as a failed health check.

### 3.5 Production-database migration rehearsal

A copy of the active production DB was made and tested with the new binary in an isolated process on an alternate port. The new binary started, returned the authenticated health result above, and reported the release migration rows:

- `20261102220154_20261102000002_preference_primary_key`
- `20261103001500_bootstrap_anchor_content_fts`

The disposable DB passed SQLite integrity check. The live production database was not migrated by this rehearsal.

## 4. Backups and rollback assets

Backups were created before any production restart.

### 4.1 Previous production executable

Path:

`/home/celestial-dev/backups/DiveeOI/diveeoi-before-release-20261103-171612`

SHA-256:

`d2b16d023e618fd24f883fea154bca5f7ad25a79e088696da71d4d7b5b2abf80`

Size at the last check: 183,519,408 bytes. The backup was copied from the previous running executable through `/proc/914318/exe`, not from the already replaced on-disk path.

### 4.2 Database backups

Directory:

`/home/celestial-dev/backups/DiveeOI/database-before-release-20261103-174920`

Files:
- `opencode-master.db`
- `targeted-learning-books.db`
- `targeted-learning-student.db`
- `SHA256SUMS`

The files were made using SQLite's online backup API from the active DB handles. Each backup passed `PRAGMA integrity_check` with result `ok`. The backup directory is mode 0700 and database/checksum files are mode 0600.

SHA-256 values:
- `opencode-master.db`: `a240c9e799cf8a2861ddbe4a3fb8fcd1f3dd716f8b5707ea46b5b97f25fc6713`
- `targeted-learning-books.db`: `91b6e2029b5b30001399626540a094b91c10de8603901c4de386a5fa85669b78`
- `targeted-learning-student.db`: `ddda9befabdd6a8b7f9663d46267265211d3b211fb5bcdca20352a2f25fc72bd`

Convenience pointers:
- `/home/celestial-dev/backups/DiveeOI/latest-rollback-path.txt`
- `/home/celestial-dev/backups/DiveeOI/latest-database-backup-path.txt`

**Rollback caution:** restoring a database backup rolls back user writes made after the backup timestamp. Do not restore the entire live database just because a service restart fails. First inspect the migration failure and determine whether the schema can be repaired or rolled forward. The old executable backup is the first binary rollback asset.

A binary rollback, if approved and required, would restore the saved executable to the configured baseline path and restart the service. That restart also requires privileged authorization.

## 5. Known limitations and follow-up items

1. **No production deployment yet.** Service PID 914318 is still running the old executable inode. New binary is on disk at the configured path.
2. **No live OpenRouter/AgentRouter request verification.** No authorized test credentials were configured for the isolated QA run. No external model-generation requests were sent. Do not invent credentials or use user tokens without permission.
3. **Live embedding test not run by default.** The Learning live embedding test depends on a cached/downloadable model and previously failed because the tokenizer was unavailable in the local-only temporary model path. It is now an explicit `test:live` command; ordinary unit tests skip it.
4. **HTTP API exercise is incomplete.** Coverage mode reports 58 missing scenario definitions; effect mode fails because `ChildProcessSpawner` is not provided to the relevant test execution path.
5. **Mobile/responsive browser QA not performed.**
6. **Bun version mismatch.** Verified with Bun 1.4.4; root manifest specifies 1.3.14.
7. **Vite large-chunk warning remains.** Build succeeds; chunk splitting/size optimization is separate work.
8. **No commit or push.** All working-tree changes remain local.

## 6. Suggested next actions

### Deployment (requires user approval)

Once explicit approval for privileged restart is received:

1. Reconfirm the baseline executable exists and is executable; verify the backup and DB checksum files still exist.
2. Reconfirm that the current service is the expected `diveeoi.service` and port 6050 listener.
3. Restart only the DiveeOI service using the approved sudo path:
   `sudo systemctl restart diveeoi.service`
4. Verify `systemctl is-active diveeoi.service`, the new MainPID/start time, and that `/proc/<MainPID>/exe` resolves to the current baseline executable without `(deleted)`.
5. Inspect service logs for migration/startup errors.
6. Check the service's authenticated health endpoint and a UI asset response. A plain unauthenticated 401 is expected and is not sufficient as a failure signal.
7. If startup or migration fails, stop and diagnose before restoring databases. Binary rollback should be evaluated first.

Do not use a stale password, cached sudo authorization, or any previously mentioned secret. The user asked to approve privileged execution.

### Separate engineering follow-up

After deployment, separately repair the HTTP API exercise effect-mode dependency, decide whether to add the missing 58 route scenarios, and run the live embedding test when its model assets are available. These are not prerequisites for the immediate binary restart given the completed build/typecheck/core tests and isolated DB migration rehearsal.

## 7. Handoff pointers

- Original incident analysis and code rationale: `COMPOSER_INCIDENT_HANDOFF.md`.
- Settings V1/V2 browser evidence and QA caveats: `docs/qa/COMPOSER_BROWSER_QA.md`.
- Project-wide architecture and working conventions: `PROJECT_GUIDE.md`, `AGENTS.md`, and package-level `AGENTS.md` files.
- Work history / prior session updates: `WORKLOG.md`.
- Current project state notes: `CONTEXT.md`.

Before making further source changes, read the root and relevant package `AGENTS.md` instructions and `.zcode-quality.md`. Preserve the uncommitted worktree; this handoff is a status record, not authorization to commit, push, clean, or deploy.

---

## 8. Final verification refresh

**Follow-up date:** 2026-11-04. The VDS host clock reported 2026-11-03 22:11:30 UTC at the time of the final repository/status recheck.

### 8.1 Current production state re-confirmed

The recheck still found:

- diveeoi.service is active.
- Main PID remains 914318; systemd start time remains 2026-11-02 20:15:10 UTC.
- Port 6050 is listening on 0.0.0.0.
- /proc/914318/exe still resolves to the configured baseline binary with (deleted). This confirms that the process is still running the old executable inode.
- The new binary is present at the configured ExecStart path and has not been loaded by the production process.

Current on-disk baseline build:

- Path: packages/server/dist/@diveeoi/server-linux-x64-baseline/bin/diveeoi
- Size: 183,535,792 bytes
- Mode: 0755
- SHA-256: 089d7db8ebc5e8d1bb03ab24ddb77f7e2bc61c9b7f26379e0312b203debeb8e8

The previous running executable backup remains present at the path in section 4.1, with the original recorded SHA-256. Database backup files and their checksum manifest also remain present with restrictive permissions. No backup was restored or modified during this refresh.

### 8.2 Repository state re-confirmed

- Branch: dev
- HEAD: 2f5b2c3cdf6d80af084369ff5ad662b49791a72b
- Ahead/behind upstream: 0 / 0
- Working tree: 64 tracked paths modified and 9 untracked entries (73 status entries total) at this refresh.
- No commit, push, reset, clean, or production deployment was performed.
- git diff --check passed.
- cd packages/db && bun script/migration.ts --check exited successfully. The incremental check reported no schema changes. The script also generated a full-schema comparison artifact under its temporary /tmp directory; it did not deploy migrations to the production database.

The 73-entry count is a later snapshot and supersedes the older 64-modified/19-untracked count in section 1.

### 8.3 HTTP API effect-mode run disposition

The previously running managed effect-mode exercise process (389fbb9f-e0a, PID 3468213) was still running after approximately 16 minutes. Its log showed an Effect runtime failure:

    Service not found: effect/process/ChildProcessSpawner

The failure occurred while resolving the experimental tool ID route through ToolRegistry.all(). The process was stopped with SIGKILL after confirming it had not completed; its wrapper did not write a normal exit-code marker. Therefore:

- No effect-mode pass is claimed.
- The auth-mode result remains 194/194 scenarios passing, with 58 route scenarios missing from the registry.
- Coverage mode remains incomplete and exits nonzero because of those 58 missing scenario definitions.
- The ordinary server unit suite was not rerun after the final HTTP exercise fixture edits. Its previously recorded 2,770-pass / 14-skip / 1-todo result remains the last complete server-suite result for this pass.

This is an explicit harness/coverage limitation. Do not describe the HTTP API exercise as fully green.

### 8.4 Deployment authorization boundary

No privileged command was executed in this refresh. The user requested explicit approval before sudo use. Do not restart diveeoi.service until that approval is received.

The build, typecheck, package-suite results, isolated new-binary smoke test, disposable production-DB migration rehearsal, and backups are documented above. The remaining deployment step is a controlled systemd restart and post-restart verification, not an already completed deployment.
