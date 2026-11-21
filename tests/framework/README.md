# DiveeOI Test Framework

A zero-new-dependency unified test framework for the DiveeOI monorepo
(Bun 1.3.14). One CLI runs every layer of testing: smoke gate → unit →
integration → e2e, plus a manual QA checklist and machine-readable reports.

```
tests/framework/
├── runner.ts                  # the CLI (bun tests/framework/runner.ts <suite>)
├── README.md                  # this file
├── MANUAL_TEST_CHECKLIST.md   # human QA script for the live UI
├── e2e/
│   ├── playwright.config.ts   # Playwright config (live server, no webServer auto-start)
│   └── smoke.spec.ts          # app loads / login form renders / no console errors
├── last-report.md             # written on every run (human-readable)
├── last-report.json           # written on every run (machine-readable)
└── logs/                      # per-command stdout/stderr (overwritten per run; files from
                                # interrupted/older runs may linger — safe to delete)
```

No npm dependencies were added: the runner uses only `node:child_process`
(`spawnSync`) + `node:fs`, and the e2e suite imports `@playwright/test` from the
workspace's **existing** devDependency in `packages/app` (catalog v1.59.1,
browsers in `~/.cache/ms-playwright`).

## Quick start

```bash
bun tests/framework/runner.ts smoke    # fast gate (< 2 min target)
bun tests/framework/runner.ts unit     # full bun test per package
bun tests/framework/runner.ts integration
bun tests/framework/runner.ts e2e      # skips cleanly if no live server
bun tests/framework/runner.ts all      # everything, aggregated
bun tests/framework/runner.ts report   # alias of `all` (reports always written)
bun run smoke                          # same as the first line (root script)
bun run test:framework                 # same as `all` (root script)
```

## Suites — what they cover

| Suite | Scope | Commands it runs |
|---|---|---|
| `smoke` | bun health probe + 4 canary test runs pinned by the sprint baseline | `bun --version`; app `bun test src/i18n/parity.test.ts`; memory `bun test`; learning `bun test test/rewrite.test.ts test/gate.test.ts test/hybrid.test.ts`; http-recorder `bun test` |
| `unit` | auto-discovered full `bun test` per package under `packages/*` | every package that has a `test/` dir or `*.test.*` files runs its own `bun run test` script when defined (learning: `SKIP_LIVE_EMBED=1`, ui: happydom preload, server/db/llm: `--timeout 30000 --only-failures`), otherwise plain `bun test`. `packages/app` keeps its tests co-located under `src/**` + `test-browser/`, so its own `test` script (`test:unit && test:virtualizer`, `--conditions=browser --preload ./happydom.ts`) is used. Packages with no tests (identity, mcp, plugin, plugins, script, sdk, effect-sqlite-node) are skipped and listed in the report notes. |
| `integration` | behavioral suites that run fully inside the sandbox | learning `test/embed-pool.test.ts`, `test/ingest-turn.test.ts`, `test/download-faults.test.ts` (with `SKIP_LIVE_EMBED=1`); memory `test/memory.test.ts`; http-recorder `test/record-replay.test.ts`. All five files verified to exist; a missing file is reported as a failure so drift cannot slip through. |
| `e2e` | Playwright against a **live** app server | `playwright test --config tests/framework/e2e/playwright.config.ts` (3 tests: app root loads + renders `#root`, login form renders, no console/page errors on load) |
| `all` | smoke → unit → integration → e2e, aggregated | — |
| `report` | alias of `all` | — |

To change what a suite runs, edit the commented definition blocks
(`SMOKE_TARGETS`, `INTEGRATION_TARGETS`, `unitTargets()`) in `runner.ts`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | all green — **skips allowed** (e.g. e2e skipped because no live server) |
| `1` | any failure, timeout, or usage error (unknown/missing suite) |

The runner is crash-proof: a suite that throws is recorded as a *failed result*
and the remaining suites still run (continue-on-fail everywhere).

## Timeouts

Every spawned command gets a per-command timeout, default **240 s**:

```bash
FW_TIMEOUT_MS=900000 bun tests/framework/runner.ts unit   # slow machines / full server+db suites
```

A command that outlives the timeout is recorded as `timeout` (counts as a
failure) and its partial log is kept.

## e2e — env vars & behavior

The app dev server is Vite on **port 3000** (`packages/app/vite.config.ts`),
which proxies API paths to the DiveeOI server on **port 4097**; boot both with
`bun run dev:both`. The e2e suite needs that live server — it does **not** start
one itself.

| Env var | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://127.0.0.1:3000` | app URL under test (both runner probe and Playwright `baseURL`) |
| `E2E_WORKERS` | `1` | parallel Playwright workers |
| `CI` | unset | `forbidOnly` + 2 retries when set |
| `PLAYWRIGHT_BROWSERS_PATH` | `~/.cache/ms-playwright` | where Playwright browsers are looked up |

Skip behavior (exit 0, explicit reason in output + report):

- no live server answering `BASE_URL` within **3 s** →
  `e2e skipped: no live server at <url>`;
- `@playwright/test` missing from `packages/app/node_modules` →
  `e2e skipped: Playwright not available`;
- browsers not installed → `e2e skipped: Playwright browsers not installed`
  (fix: `bun --cwd packages/app x playwright install chromium`).

Local dev login uses Basic auth `DIVEEOI` / `divee` (see `docs/security-auth.md`);
the login-form test only asserts that the form renders — it does not submit.

## Reports

Every run (any suite, including `all`/`report`) refreshes:

- `tests/framework/last-report.md` — timestamp (UTC), bun version, git sha,
  per-suite/per-package table (pass/fail/skip/timeout, duration, command),
  failure log tails, notes (skip reasons, discovery skips), overall verdict.
- `tests/framework/last-report.json` — the same data, machine-readable.

CI can consume the verdict either from the exit code or the final
`FW-JSON {"verdict":...}` line printed to stdout. Per-command raw output is kept
in `tests/framework/logs/`.

## Manual QA

`MANUAL_TEST_CHECKLIST.md` is a numbered, checkbox-based script for a human
tester walking the real UI (login → workspace → new session → composer →
@-mention → library/ingest → settings → grounded Q&A → persistence → console
sweep). Steps 7, 10, 13, 17 and 12 are explicit **"pay attention"**
regression checks for the known bugs recorded in
`docs/testing/2026-11-09-ui-test/docs/DiveeOI_ManualTest_Report_2026-11-09.md`
(dead New-session banner, dead composer Send button, @-mention popup missing
books, library error shown as `null` without a real tooltip, prompt stall).
Run it after major UI changes or before a release; file the signed-off
checklist next to your change or in `docs/testing/`.

## CI wiring suggestion

The repo ships a self-hosted CI runner (`tools/self-hosted-ci/`). Wire the
framework in as a workflow step (gate first, heavier suites on the default
branch / nightly):

```yaml
# tools/self-hosted-ci workflow / pipeline.yml step sketch
steps:
  - name: smoke gate           # every push — fast, no live server needed
    run: bun tests/framework/runner.ts smoke
  - name: unit                 # pushes to main — allow long timeouts
    run: FW_TIMEOUT_MS=900000 bun tests/framework/runner.ts unit
  - name: integration          # pushes to main
    run: bun tests/framework/runner.ts integration
  - name: e2e (nightly)        # needs `bun run dev:both` running first
    run: |
      bun run dev:both &
      bun tests/framework/runner.ts e2e
  - uses: actions/upload-artifact@v4   # or the self-hosted equivalent
    with: { name: test-report, path: tests/framework/last-report.md }
```

(For a `turbo.json` setup: add a root task `"test:framework"` with
`"dependsOn": ["^build"]` only if you want the e2e leg to run against a built
app; the smoke/unit/integration legs need no build step.)

## Baselines (sprint HEAD `c0951df`)

- `packages/memory bun test` → 2 pass
- `packages/app bun test src/i18n/parity.test.ts` → 5 pass (Wave-1 task 2-a
  extended the locale dicts and parity tests; was 1 pass at the original baseline)
- learning canaries (rewrite/gate/hybrid) → 39 pass
- http-recorder → 33 pass

### Known PRE-EXISTING unit failures (not framework regressions)

Full `bun test` was already RED at the sprint baseline for:

- `packages/server` — 2801 tests, **246 fail** (loop + HttpApi suites, 2 broken
  snapshots); run takes ~12 min, so use `FW_TIMEOUT_MS=900000`.
- `packages/db` — 1 of 1082 tests fails deterministically
  (`LocationServiceMap > isolates location state while sharing location policy
  with catalog`); reproduced standalone.

The runner labels these automatically via `PREEXISTING_UNIT_FAILURES` in
`runner.ts` (edit it as the baseline moves). An archived copy of a full `all`
run report from this sprint lives at `docs/testing/framework/2026-11-21-all-run-report.md`.
