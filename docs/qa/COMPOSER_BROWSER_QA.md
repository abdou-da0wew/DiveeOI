# DiveeComposer manual browser QA

Date: 2026-11-02  
Branch: `dev`  
Scope: Composer Models settings in Settings V1 and Settings V2, config persistence, AA key lifecycle, and authenticated app startup.

## Test environment

- Frontend: Vite dev server at `http://127.0.0.1:4173`.
- Backend: current working-tree server at `http://127.0.0.1:4097`.
- Authentication: dedicated Basic-auth test account; credentials were not written to this report.
- Data/config: isolated XDG directories under `/tmp/diveeoi-browser-qa`; no production database, configuration, or provider credentials were used.
- Browser: VDS `agent-browser` CLI, named sessions `diveeoi-qa-20261102` and `diveeoi-qa-v2-20261102`. Followed the installed `core` and `dogfood` workflows.

## Results

| Check | Result | Evidence |
|---|---|---|
| Login form | Passed | Login page displayed; submitting the isolated Basic credentials opened the workspace. |
| Settings V2 Models | Passed | Composer section and controls rendered: all-provider toggle, local-ranking consent, AA key field, fallback env field, and synthetic DiveeComposer model. |
| V2 config persistence | Passed | Toggling `use_all_providers` and `allow_unmeasured_ranking`, and applying a test AA env-variable name, updated the isolated `diveeoi.jsonc` file. |
| V2 AA key save/status/remove | Passed | Fake test key changed the UI from Save to Replace + Remove; encrypted `.runtime/.catalog` appeared with mode `0600`; Remove cleared configured status and deleted the file. |
| Settings V1 Models | Passed | The same Composer controls were present and displayed the shared test config values. |
| V1 AA key save/status/remove | Passed | The fake test key produced the configured/Remove UI state; removal restored Save state and removed the encrypted file. |
| Browser event stream | Passed after authentication | Initial pre-auth event requests returned 401 as expected; authenticated event stream returned 200. |
| Browser page errors | Passed | `agent-browser errors` returned no page errors after sign-in. Console was cleared after authentication and had no new messages during the final V2 check. |
| Restore test state | Passed | Test config returned to `use_all_providers: true`, `allow_unmeasured_ranking: false`, and `ARTIFICIAL_ANALYSIS_API_KEY`; encrypted test key file absent. |

No user-facing defect was found in the tested Settings V1/V2 flows.

## Expected test-only log entries

The server logged an Artificial Analysis 401 after the deliberately fake, non-working test key was saved and the provider list refreshed. This was intentional negative test data, not a production credential; the key was removed immediately afterward. The server also logged an SSH startup warning because SSH was not configured in the isolated test instance.

## Screenshots

Screenshots are on the VDS at `docs/qa/screenshots/`:

- `01-login.png`
- `02-settings-models-v1.png`
- `03-settings-models-v2.png`

## Not tested

- No model-generation request was sent. No OpenRouter or AgentRouter credentials were configured in the isolated environment, so no external provider request was made.
- No responsive/mobile browser pass was performed.
- This manual QA does not replace the full package typecheck or production build. Those checks were subsequently completed on the user's 32 GiB VDS; see RELEASE_HANDOFF_2026-11-03.md for exact commands, results, and the Bun-version caveat. Colab was not required for that verification pass.


## 2026-11-03 supplemental smoke test

This follow-up was run after the isolated QA above. It intentionally has a different scope and environment, so do not conflate the results.

- The V2 frontend was served from the current working tree using Vite at `http://127.0.0.1:3003`; its API requests went to the already-running service at `http://127.0.0.1:6050`. That backend process is the pre-recovery deployed binary, not a build of the current uncommitted server source.
- The V1 screen was opened from the existing service at `http://127.0.0.1:6050`.
- V1 and V2 both displayed the Composer section, provider toggle, local-ranking consent, AA key input/status, fallback environment variable, and model catalogue.
- In each screen, `use_all_providers` and `allow_unmeasured_ranking` were each changed from `true` to `false` and restored to `true`. Each PATCH and subsequent config GET returned HTTP 200. The final config read showed both booleans `true` and the AA fallback variable still `ARTIFICIAL_ANALYSIS_API_KEY`.
- The unchanged fallback environment variable was applied once in V1 and once in V2; each action completed and refreshed config successfully. No AA API key was entered, saved, replaced, or removed in this follow-up.
- Browser startup produced the expected unauthenticated `401` responses before Basic sign-in. After authentication, the event stream returned HTTP 200. A full dev-page reload loses the in-memory Basic credential by design and returns to the login screen.
- Screenshots from this follow-up: `composer-settings-v1-manual-test.png` and `composer-settings-v2-manual-test.png`.
- The Vite dev server and the two named browser sessions were stopped/closed after the test; the browser cookies were cleared. The existing service on port 6050 was not restarted.

This supplemental smoke test did make reversible config changes against the existing 6050 service rather than an isolated database. The settings were restored to the values observed before the test, and no provider credentials or keys were changed. For subsequent manual QA, prefer the isolated XDG setup documented above.


## 2026-11-03 working-tree backend smoke and Vite proxy correction

- Started the current uncommitted server source on `127.0.0.1:4097` with `env -i` and fresh XDG data/config/cache/state directories under `/tmp/diveeoi-qa-workingtree-20261103`. No inherited provider API keys, OAuth tokens, or production configuration were available to that process. A Vite frontend was started on `127.0.0.1:3003` and authenticated with a disposable Basic-auth test account.
- The first manual project-picker attempt exposed a Vite proxy matcher defect: API paths ending in a query string (for example `/file?directory=...`) did not match the configured API proxy pattern and returned the Vite app HTML instead of the backend JSON. Updated `packages/app/vite.config.ts` so the path boundary accepts `/`, `?`, or end-of-path. After restarting only the temporary Vite process, `GET /file?directory=...` through port 3003 returned `Content-Type: application/json` and the backend directory-list payload, matching the direct 4097 response.
- The browser's recursive absolute-path project search did not complete within this resource-constrained session and caused the temporary server's RSS to climb sharply. The isolated server and Vite process were stopped; the browser session/cookies were closed/cleared; the temporary XDG directory was removed. Memory availability recovered. No active service on port 6050 was restarted or changed during this isolated backend smoke.
- Because a project/session could not be opened safely before stopping the process, this pass did **not** complete a Composer prompt/no-route browser test. No model-generation request was sent. The Vite proxy correction was verified at the HTTP level, not by completing the project picker UI.

## 2026-11-03 isolated Composer no-route browser test



This test used a dedicated temporary project and an explicit isolated SQLite path. The backend was launched from a clean environment (`env -i`) with `OPENCODE_DB` pinned to `/tmp/diveeoi-composer-noroute-final-20261103/data/diveeoi/opencode-local.db`; its config, data, cache, and state directories were also under that temporary root. The frontend used Vite on `127.0.0.1:3004`, proxying only to that backend on `127.0.0.1:4100`. The existing service on `6050` was not restarted or used for this test.

The model catalogue contained one zero-cost OpenCode test model with a public endpoint at `https://api.example.invalid/v1` and no configured environment-variable credentials. The endpoint is intentionally non-routable; it is not a localhost/private endpoint that the provider loader would legitimately allow without a key. The synthetic `divee/composer` entry remained visible in the model picker.

| Check | Result | Evidence |
|---|---|---|
| Composer catalogue visibility without an eligible provider route | Passed | `/provider` returned the synthetic `divee/composer` model while the test model had no configured credentials. |
| Browser prompt submission with DiveeComposer selected | Passed | Two prompt submissions selected `{ providerID: divee, modelID: composer }`; both `prompt_async` requests returned 204. |
| No-route handling | Passed | Server log recorded `ProviderModelNotFoundError` before any model call. No assistant response or token usage was created. |
| User-visible safe error | Passed | Browser displayed a `Session error` toast: `DiveeComposer has no eligible route. no Artificial Analysis measurement matches the available free models; add an Artificial Analysis key or enable local ranking in Settings > Models`. No stack trace was shown in the UI. |
| External provider traffic | Passed | Both HAR files contain only local frontend/backend traffic and no request to the configured invalid provider URL or another model endpoint. |
| Production-data isolation | Passed | Backend DB file descriptors pointed only to the temporary SQLite DB. A read-only check of the live service DB found no test account and no QA session. |

Artifacts saved in this directory: `composer-no-route-before-send.png`, `composer-no-route-after-send.png`, `composer-no-route-after-error.png`, `composer-no-route-final.har`, and `composer-no-route-event-check.har`.

The disposable test account, temporary database, and project were confined to the QA paths above. They were not production credentials or production data.

## 2026-11-03 final VDS verification

The remaining local build and regression checks were executed on the VDS after the user confirmed 32 GiB RAM and authorized local builds/typechecks. Results:

| Check | Result |
|---|---|
| Monorepo TypeScript typecheck | Passed: 14/14 Turbo tasks |
| SDK + app production build | Passed: 2/2 Turbo tasks |
| Server Linux x64 and x64-baseline production build | Passed; both smoke tests passed |
| Full DB test suite | 1,047 passed, 0 failed, 2,815 assertions, 133 files |
| Full server test suite | 2,770 passed, 14 skipped, 1 todo, 0 failed, 7,292 assertions, 212 files |
| App unit tests | 429 passed, 0 failed, 73 files |
| App virtualizer tests | 2 passed, 0 failed |
| Final focused provider/Composer/session tests | 214 passed, 1 skipped, 0 failed, 622 assertions, 7 files |
| Migration generator check and `git diff --check` | Passed |
| Oxlint on modified/untracked source files | Passed with zero diagnostics |

The broad repository lint scan exits successfully but reports existing warnings in untouched legacy code, design assets and documentation examples. The SDK/app Vite build also prints its non-fatal large-chunk warning.

The production server was not restarted: PID 914318 on port 6050 is still running the old loaded binary. The new Linux baseline binary is built and smoke-tested on disk. Live OpenRouter/AgentRouter authentication and real upstream quota exhaustion/reselection were not tested because no authorized provider credentials were available; the isolated no-route HAR confirms no external model request was made during browser QA.

