# DiveeComposer incident handoff

> **Historical incident analysis, last updated 2026-11-03.** This file preserves the original regression, root-cause investigation, and repair chronology. It is not a current working-tree or deployment-status report. Consult [CONTEXT.md](CONTEXT.md) and [RELEASE_HANDOFF_2026-11-06.md](RELEASE_HANDOFF_2026-11-06.md) for current status and verification boundaries.

Last updated: 2026-11-03. Repository: `/home/celestial-dev/DiveeOI`. Branch: `dev`.
Last pushed/deployed commit: `2f5b2c3 feat(composer): add consented heuristic fallback ranking`.
This document is the task-specific handoff for the Composer regression and the provider/authentication failures observed immediately after that deployment.

## Executive summary

DiveeComposer was made to disappear from the provider/model catalogue when Artificial Analysis (AA) measurements were missing and the local-heuristic consent setting was disabled. This was caused by eligibility and catalogue visibility being coupled: `select()` returned no candidate, `build()` returned `undefined`, and `withProvider()` therefore omitted the synthetic `divee` provider.

The V1 Models settings UI contains the all-provider toggle, heuristic-consent toggle, and AA key controls. Settings V2 did not contain those additions. An uncommitted V2 UI implementation now exists in the working tree, but it has not been included in a production build or deployment.

Two additional runtime failures appeared in the logs:
1. OpenCode free gateway requests returned `Free usage limit reached` for `opencode/beam-free` (and earlier a Nemotron free model). This is an upstream quota/refusal, not a model-context error.
2. OpenRouter model requests returned `Missing Authentication header`, including requests for `nvidia/nemotron-3.5-super-vl:free`, `anthropic/claude-haiku-4.5`, and `google/gemini-3-flash-preview`. This is a credential propagation/provider-availability problem and must not be labelled as a model-quality failure.

Do not assume that a provider being configured, having a base URL, or appearing in the catalogue means that requests are authenticated and usable.

## Production state (last verified)

- Git HEAD at last deployment: `2f5b2c3` on `dev`.
- Last observed service state immediately after that deployment: `diveeoi.service` active/running, PID `914318`, started `2026-11-02 20:15:10 UTC`.
- Listener at that time: `0.0.0.0:6050`.
- The binary deployed at that time was `packages/server/dist/@diveeoi/server-linux-x64-baseline/bin/diveeoi`, built at `2026-11-02 20:14:27 UTC`.
- Important: those timestamps precede the uncommitted recovery edits listed below. The currently running service therefore does **not** include those recovery edits. Re-check PID, start time, binary timestamp, and logs before claiming current production state.

## Confirmed causes and issues

### 1. Composer catalogue disappearance

Files:
- `packages/server/src/provider/composer.ts`
- `packages/server/src/provider/provider.ts`
- `packages/server/test/provider/composer.test.ts`

The committed consent change defaults `allow_unmeasured_ranking` to `false`. In `candidates()`, every model without an AA match is skipped unless that option is true. If no measured models exist, `select()` returns `undefined`. Before the recovery edit, `build()` immediately returned `undefined` too. The synthetic `divee` provider was then absent from `withProvider()` and `Provider.getProvider()`, making both the Composer provider and its model disappear from the UI.

The correct separation is:
- Catalogue visibility: keep a synthetic Composer provider/model visible when a valid, known-free catalog candidate exists, even when routing is temporarily unavailable.
- Request routing: only return a model carrying a concrete `routes` WeakMap target after `select()` has passed free-price, provider-availability, model-health, context, quality, and consent rules.
- A display-only representative model must never be returned by `Composer.model()` for an actual request. The provider must not silently route to a display candidate when consent is off.
- If no valid free catalogue model exists at all, decide explicitly whether to retain a disabled synthetic entry with an unavailable reason instead of dropping it. Do not reintroduce paid/unknown-price fallback.

A local recovery implementation now adds `displayCandidate()`, allows `build()` to create a display-only provider entry if `select()` has no route, adds a route WeakMap entry only for a real selected candidate, and makes `Composer.model()` return only route-tagged models. Review this carefully: it has focused tests but has not received a server typecheck or fresh production build.

### 2. Settings V1 versus V2 mismatch

Files:
- V1: `packages/app/src/components/settings-models.tsx`
- V2: `packages/app/src/components/settings-v2/models.tsx`
- Config schema: `packages/db/src/v1/config/config.ts`
- Generated SDK: `packages/sdk/src/v2/gen/types.gen.ts`
- Server key routes: `packages/server/src/server/routes/instance/httpapi/groups/config.ts` and `handlers/config.ts`

The committed V1 Models screen contains:
- Use all configured providers.
- Allow local ranking without Artificial Analysis, with an explicit reduced-accuracy acknowledgement.
- Save/replace/remove the AA key (encrypted server-side; browser only receives a boolean status).
- Configure the fallback environment-variable name.

The V2 Models screen had not been updated at incident time, which is why the user saw no new settings there. The current uncommitted implementation now adds the same controls and calls the existing SDK key-status/save/remove methods. Manual V1/V2 browser QA subsequently verified nested `performance.composer` persistence, AA key status/save/remove, and provider refresh; see `docs/qa/COMPOSER_BROWSER_QA.md`. Full app typecheck and production build remain outstanding.

### 3. Provider availability falsely inferred from endpoint configuration

File:
- `packages/server/src/provider/provider.ts`

The committed provider discovery logic used to count a configured custom provider as available merely because `provider.options.baseURL` was non-empty. A base URL identifies an endpoint; it is not authentication. This allowed unauthenticated OpenAI-compatible providers into Composer's candidate pool and is consistent with the observed `Missing Authentication header` requests.

An uncommitted patch removes baseURL-only availability, requires a non-empty credential-like value, and checks whether `${ENV_NAME}` placeholders can be resolved from the loaded environment. It also recursively interpolates environment templates in provider options/headers and gives a stored provider API key precedence over unresolved config placeholders.

Review for regressions before adopting:
- Generic API-key auth and provider-specific OAuth/plugin auth are not interchangeable. The local patch currently only counts generic stored `type: "api"` records in the generic auth loop; verify every OAuth provider with its own loader is still available.
- Do not mark a provider usable because a key-shaped property exists if it resolves to an empty/unset environment placeholder.
- Do not treat `baseURL`, provider catalogue presence, or a stale auth record as sufficient proof that the exact model request will carry an Authorization header.
- Check both `apiKey` SDK options and explicit `headers.Authorization` / `headers.x-api-key` cases without leaking credentials in logs.
- Test the actual AgentRouter custom provider IDs and the built-in OpenRouter provider independently. The VDS user configuration contains multiple AgentRouter provider definitions and a disabled entry; never copy any API key values from user config into source control or documentation.

### 4. OpenCode free-tier quota handling

Files:
- `packages/server/src/provider/free-tier.ts`
- `packages/server/src/provider/composer-bans.ts`
- `packages/server/src/session/processor.ts`

Observed error text includes:
`Free usage limit reached. Free models work in OpenCode ...`

The free-tier classifier already recognizes `free usage limit reached` as a provider-level `quota` verdict and the cooldown is intended to keep the exhausted gateway out of later selections (default one-hour cooldown). However, the live logs show Composer reaching `opencode/beam-free` and receiving this error, followed by OpenRouter attempts that failed because their Authentication header was missing.

Verify the full error path:
- Ensure AI SDK/streaming errors reliably reach `FreeTier.learn()` with the concrete routed target provider/model.
- Ensure a quota verdict calls `markQuotaExhausted("opencode")`, persists the cooldown, and is restored after restart.
- Ensure the router reselects only among actually authenticated, known-free, context-compatible candidates after the cooldown.
- Ensure a quota failure does not get recorded as a generic permanent model ban or misclassified as poor model quality.
- If all valid providers are exhausted or unauthenticated, report a clear no-route error; do not silently pick a paid or unknown-price model.

### 5. Artificial Analysis optionality and cache

Files:
- `packages/server/src/provider/artificial-analysis.ts`
- `packages/server/src/provider/composer-secrets.ts`
- `packages/server/src/provider/provider.ts`

The AA key is intended to be optional. Without a key, a stale locally cached AA score set should still be usable; only models without a measurement should require explicit local-heuristic consent. The committed code refreshes AA only when the key is available. An uncommitted change exports `ArtificialAnalysis.loadCache()` and invokes it when no key exists, so previously cached benchmark scores can still be used offline.

The key was not provisioned into the encrypted Composer secret store during the earlier deployment. Do not assume that a key is configured. Verify status through the existing status API/UI; never read or print its secret value. Never put credentials from `auth.json`, `opencode.json`, `opencode.jsonc`, environment variables, logs, or terminal output into this handoff or a commit.

### 6. Context and selection safety

Preserve these rules:
- Composer is strictly free-only.
- Only explicit known-zero-price models are eligible; missing pricing metadata is not proof of free usage.
- Reject priced input/output/cache/tier/high-context variants.
- Require a callable/tool-capable model and usable context metadata.
- Never route a session to a context window smaller than the already-used context. Headroom is preferred, not mandatory if the only remaining candidate still fits the current context.
- A display-only catalogue representative may be shown when no route exists, but must never be returned for an LLM request.
- No weak/paid/unknown-cost fallback when no candidate meets the configured quality/consent rules.

## Recovery work and current working tree

The original recovery pass modified five source files. The work continued after this snapshot and now includes the following groups. All changes remain local and uncommitted on `dev`; none are included in commit `2f5b2c3`, built into the running binary, pushed, or deployed.

### Composer and provider routing

- `packages/server/src/provider/composer.ts` — keeps a display-only synthetic `divee/composer` entry visible when a valid known-free catalogue candidate exists but routing is blocked. `Composer.model()` returns only a route-tagged model. Display mode no longer requires an authenticated provider, and the no-route reason distinguishes missing provider credentials from missing catalogue models.
- `packages/server/src/provider/provider.ts` — checks usable non-empty credentials and resolved environment placeholders instead of treating a public `baseURL` as authentication; keeps explicit config keys ahead of stored keys when resolved; supports nested provider auth headers and environment interpolation; permits keyless loopback/private endpoints; isolates custom/plugin model filtering to per-instance provider maps so shared `catalogFor()` data cannot be mutated by an anonymous OpenCode instance.
- `packages/server/src/provider/artificial-analysis.ts` — loads an existing persisted AA score cache without requiring a configured API key.
- `packages/server/src/provider/free-tier.ts` — traverses nested/sibling error causes safely, detects provider-wide missing-auth failures separately from OpenCode per-model key refusals, and applies a temporary five-minute provider auth cooldown. OpenCode quota cooldown remains a one-hour provider-wide cooldown and is persisted through ComposerBans.
- `packages/server/src/session/prompt.ts` and `packages/server/src/session/processor.ts` — Composer target identity remains attached to the concrete model through processor execution; no-route messages expose the Composer reason without surfacing unrelated provider error causes.
- `packages/server/src/server/routes/instance/httpapi/handlers/config.ts` — saving/removing the AA key clears the AA cache and marks the current provider instance for disposal.
- Tests: `packages/server/test/provider/composer.test.ts` and `packages/server/test/provider/free-tier.test.ts`; the existing `packages/server/test/provider/provider.test.ts` regression suite verifies isolation between unauthenticated and keyed instances.

### Settings V1/V2 and provider refresh

- `packages/app/src/components/settings-v2/models.tsx` — adds the Composer controls to Settings V2, matching the V1 controls.
- `packages/app/src/components/settings-models.tsx` — refreshes provider queries after AA key save/remove.
- `packages/app/src/components/settings-v2/models.tsx` — also refreshes provider queries after AA key save/remove.
- `packages/app/src/context/server-sync.tsx` — exposes an awaited provider refresh helper and uses it after config mutation, invalidating global and per-directory provider queries.
- `packages/app/vite.config.ts` — fixes the API proxy boundary so query-string endpoints such as `/file?directory=...` reach the backend instead of returning Vite `index.html`. Verified through the Vite proxy with a JSON directory-list response.
- Manual browser QA passed for Settings V1 and V2, including Composer control visibility, config persistence, and disposable AA-key save/remove. Evidence: `docs/qa/COMPOSER_BROWSER_QA.md`.

### Preferences schema and persistence repair

- `packages/db/src/prefs/sql.ts` — declares `(scope, name)` as the actual composite primary key in Drizzle.
- `packages/db/src/database/schema.gen.ts`, `packages/db/schema.json`, and `packages/db/src/database/migration.gen.ts` — regenerated canonical snapshot and migration registry.
- `packages/db/src/database/migration/20261102220154_20261102000002_preference_primary_key.ts` — repairs legacy preference tables by retaining the latest `(scope, name)` row and rebuilding the composite primary key.
- `packages/db/test/database-migration.test.ts` — verifies duplicate repair and a working `ON CONFLICT (scope, name)` upsert.

### Documentation and agent instructions

- `CONTEXT.md`, `WORKLOG.md`, `PROJECT_GUIDE.md`, root `AGENTS.md`, `.cursorrules`, `.zcoderules`, and 21 tracked `AGENTS.md` files contain the handoff references or current incident notes.
- `COMPOSER_INCIDENT_HANDOFF.md` is the task-specific incident record. Keep it current as the working tree changes.

## Verification performed on the current working tree (2026-11-03 final)

- Full monorepo typecheck: **14/14 tasks passed** with `bun turbo typecheck --concurrency=4`. The only message was a non-blocking Vercel remote-cache write-permission warning; local compilation completed successfully.
- SDK + web app production build: **2/2 Turbo build tasks passed** (`@diveeoi/sdk`, `@diveeoi/app`). Vite completed successfully; it warns that several chunks exceed 500 kB, but this is not a build failure.
- Server production build: passed with `bun run build --single --baseline --skip-install`. Embedded UI build completed and smoke tests passed for the native Linux x64 and Linux x64 baseline executables. The baseline path used by the current systemd service exists and is executable.
- Full DB package suite: **1,047 passed, 0 failed, 2,815 assertions, 133 files**. This includes the earlier `public-opencode.test.ts` filesystem-interruption case, which now passes in the full run. The migration generator check reports no schema changes.
- Full server package suite: **2,770 passed, 14 skipped, 1 todo, 0 failed, 7,292 assertions, 21 snapshots, 212 files**. A stale Basic-auth test fixture was corrected to use the current `DIVEEOI` default username; its two tests also pass independently.
- App suite: **429 unit tests passed** across 73 files plus **2 virtualizer tests passed**; zero failures.
- Final focused provider/Composer/free-tier/Artificial Analysis/session-prompt suite after the last source cleanup: **214 passed, 1 skipped, 0 failed, 622 assertions, 7 files**.
- Modified-source oxlint pass: **0 diagnostics** across the changed/untracked TypeScript/JavaScript files. The broad repository scan exits successfully but still reports warnings in untouched legacy source, design assets, and documentation examples; it is not a zero-warning repository baseline.
- `git diff --check` and `bun script/migration.ts --check` both pass.
- Fresh verification rerun on 2026-11-03: `bun turbo typecheck --force --concurrency=2` passed all 14 tasks; `bun run build --current --force` passed; both native Linux x64 and x64-baseline binaries passed explicit `--version` smoke tests. The full DB/app/server suites passed with 1,047 / 431 / 2,770 passing tests respectively; the server suite also had 14 skipped and 1 todo, with 7,292 assertions. The lint error-only scan exited 0.
- Runtime note: this rerun used Bun 1.4.4, while the root `package.json` pins `bun@1.3.14`. All checks passed on 1.4.4; the exact pinned runtime was not re-tested in this rerun.
- Isolated Composer no-route browser QA passes. Two prompt submissions kept `divee/composer` visible while no provider route was eligible; the browser displayed the safe Session error toast, with no stack trace, no assistant output, and no external provider request. Screenshots and HAR artifacts are in `docs/qa/COMPOSER_BROWSER_QA.md`.
- Production isolation was verified: the no-route test database stayed under the dedicated temporary QA root; a read-only inspection found no QA account/session in the live DB. Temporary QA listeners were stopped.

## Remaining verification before release

1. Validate authenticated requests against OpenRouter and the configured AgentRouter endpoints with real, explicitly provisioned test credentials. Confirm the actual Authorization header without logging secrets. This was not attempted because the isolated environment had no such credentials.
2. Exercise upstream OpenCode free-quota exhaustion and cooldown/reselection end-to-end using an authorized provider account; unit tests cover classification/cooldowns, but no real upstream quota request was sent.
3. Optional responsive/mobile browser QA and a post-build live service smoke test after an authorized restart.
4. Commit/push and deployment remain separate actions. No commit, push, service restart, or deployment was performed. The process on port 6050 is still the pre-recovery binary loaded before this build; the new baseline binary is on disk but not live until an authorized restart/deployment.

## Production incident evidence (redacted)

The service log recorded:
- Composer request: `providerID=divee modelID=composer`, with a routed OpenCode free model failing with the upstream free-usage-limit message.
- Subsequent OpenRouter requests failed with `Missing Authentication header` for multiple catalog models.
- These are distinct failure classes. The first is quota exhaustion; the second is credential propagation/availability. Fix both independently.

No API key, bearer token, password, or other credential is stored in this document.


## Repository commit hook

- Tracked hook: `.githooks/commit-msg`.
- Current VDS checkout: `core.hooksPath=.githooks` (local Git config).
- The hook appends `Co-authored-by: DiveeAgent <270451464+DiveeAgent@users.noreply.github.com>` when that co-author trailer is not already present. It inspects parsed trailers rather than searching the body, so mentioning the address in commit prose does not suppress the trailer.
- Verified against a temporary Git repository with a real commit and `--amend`; exactly one trailer was present in both.

## 2026-11-03 final VDS validation

The isolated Composer no-route browser test, all local package typechecks, the SDK/app/server production builds, and the full DB/app/server test suites have now completed successfully. See the verification section above for exact counts. The prior Colab requirement is superseded for this environment: the user confirmed the VDS has 32 GiB RAM and explicitly authorized local builds/typechecks, which were completed directly on the VDS.

The final targeted provider/Composer/session suite passed after the last helper and lint cleanups. The source files changed for that cleanup have zero oxlint diagnostics. The broader repository lint scan exits 0 but reports existing warnings in untouched files/assets.

OpenRouter/AgentRouter live authentication and real upstream quota-cycle verification remain untested because no authorized credentials were configured. No credentials were invented, no external model request was sent, and no deployment was performed. The current service process on port 6050 remains untouched; only the on-disk Linux binaries were rebuilt.
