# DiveeOI Test Framework Report

- **Timestamp (UTC):** 2026-11-21T23:17:07.031Z
- **Bun:** 1.3.14 · **git:** c0951df
- **Command:** `bun tests/framework/runner.ts unit`
- **Per-command timeout:** 240000ms (env `FW_TIMEOUT_MS`)
- **Overall verdict:** ❌ **RED** — 10 pass · 1 fail · 0 skip · 1 timeout in 4m58s

## unit

| Package | Command | Status | Duration | Detail |
|---|---|---|---|---|
| api | `bun test  (cwd: packages/api)` | ✅ pass | 12ms |  |
| app | `bun run test  (cwd: packages/app)` | ✅ pass | 3.1s |  |
| coenx-video | `bun run test  (cwd: packages/coenx-video)` | ✅ pass | 628ms |  |
| db | `bun run test  (cwd: packages/db)` | ❌ fail | 42.6s | PRE-EXISTING: db unit suite fails at the current tree (LocationServiceMap isolation test, reproduced standalone) — PRE-EXISTING, packages/db untouched by this sprint |
| effect-drizzle-sqlite | `bun run test  (cwd: packages/effect-drizzle-sqlite)` | ✅ pass | 265ms |  |
| http-recorder | `bun run test  (cwd: packages/http-recorder)` | ✅ pass | 440ms |  |
| learning | `bun run test  (cwd: packages/learning)` | ✅ pass | 8.0s |  |
| llm | `bun run test  (cwd: packages/llm)` | ✅ pass | 1.2s |  |
| memory | `bun run test  (cwd: packages/memory)` | ✅ pass | 818ms |  |
| profiler | `bun run test  (cwd: packages/profiler)` | ✅ pass | 54ms |  |
| server | `bun run test  (cwd: packages/server)` | ⏱️ timeout | 4m00s | exceeded FW_TIMEOUT_MS=240000 · PRE-EXISTING: server unit suite was already RED at sprint baseline HEAD c0951df (loop/HttpApi suites, 246 failures) — PRE-EXISTING, not caused by this framework |
| ui | `bun run test  (cwd: packages/ui)` | ✅ pass | 769ms |  |

## Failures

### unit / db — bun run test (bun test --only-failures)

- command: `bun run test  (cwd: packages/db)`
- exit: 1
- full log: `tests/framework/logs/unit-04-db.log`

```

- Expected  - 0
+ Received  + 2

      at toEqual (unknown:1:1)
      at /home/z/my-project/DiveeOI/packages/db/test/location-layer.test.ts:102:70
      at ~effect/Effect/successCont (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:912:25)
      at runLoop (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:422:31)
      at evaluate (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:382:21)
      at /home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:655:13
      at runTasks (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/Scheduler.js:159:15)
      at afterScheduled (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/Scheduler.js:149:10)
(fail) LocationServiceMap > isolates location state while sharing location policy with catalog [2025.15ms]

 1081 pass
 1 fail
 2913 expect() calls
Ran 1082 tests across 136 files. [42.57s]
error: script "test" exited with code 1
```

### unit / server — bun run test (bun test --timeout 30000 --only-failures)

- command: `bun run test  (cwd: packages/server)`
- exit: n/a (timed out)
- full log: `tests/framework/logs/unit-11-server.log`

```
      at ~effect/Effect/evaluate (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:732:15)
      at runLoop (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:422:31)
      at evaluate (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:382:21)
      at forkUnsafe (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:2541:8)
      at go (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:2319:11)
      at /home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:2307:12
      at ~effect/Effect/evaluate (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:732:15)
      at runLoop (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:422:31)
      at evaluate (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:382:21)
      at /home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:736:9
      at /home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:2361:9
      at evaluate (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:399:10)
      at /home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:736:9
      at /home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:2361:9
      at evaluate (/home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:399:10)
      at /home/z/my-project/DiveeOI/node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/internal/effect.js:736:9
      at processTicksAndRejections (native:7:39)
(fail) session messages endpoint > keeps full-history responses when limit is omitted [3389.70ms]
error: script "test" was terminated by signal SIGTERM (Polite quit request)
```

## Notes

- unit discovery skipped (no test files): effect-sqlite-node (no test files), identity (no package.json), mcp (no package.json), plugin (no test files), plugins (no package.json), script (no test files), sdk (no test files)
- unit/db: failures labeled PRE-EXISTING (see PREEXISTING_UNIT_FAILURES in runner.ts)
- unit/server: failures labeled PRE-EXISTING (see PREEXISTING_UNIT_FAILURES in runner.ts)

_Generated by tests/framework/runner.ts — see tests/framework/README.md for suite docs._
