# @diveeoi/profiler

In-process call-tree profiler for an Effect web server. Tracks function/group call counts, wall time, concurrent peaks, heap/RSS deltas, and gauges (active requests, queue depth). Auto-starts when `DIVEEOI_PROFILER=1`, adds no measurable overhead when disabled (constant-time `isEnabled()` guard).

## How it works

- Gate: `config.enabled = DIVEEOI_PROFILER === "1"` (`packages/profiler/src/core.ts`), `DIVEEOI_PROFILER_SAMPLE_RATE in (0,1]` controls what fraction of scopes record `heapDelta/rssDelta`.
- Call tree via `AsyncLocalStorage<ScopeNode{key, parent}>` — `_beginScope(key)` `als.enterWith(node)` nests store node `_endScope`, so `.then` callbacks from a wrapped async function correctly resolve `caller`.
- `wrap(key,fn)` deduplicates via `Symbol.for("diveeoi.profiler.wrapped")` and instruments both sync and thenable returns (tracks rejection as `error`). Equivalent `instrument(key, mod)` wraps every function prop with `key.prop` keys.
- Helpers: `measure(key, fn)` / `measureAsync(key, () => Promise)`, manual `scope(key): { end(error?) }`, `gauge(key, value)`, `gaugeDelta(key, delta)`, plus `wrap/measure` input through `packages/profiler/src/effect.ts` (`Effect.wrap("Domain.method")`, `Effect.asEffect(fn => Effect.fn(...))`).
- Sampling via `callCounts` linear threshold (`floor(count*rate) > floor((count-1)*rate)`), so sampled events are evenly spaced. Memory sampling is fresh `processMem()` deltas (`Bun.memoryUsage` else `process.memoryUsage`) with `rssDeltaMB/heapDeltaMB` rounded to 2dp.
- Consumers: `Server.Default.app.fetch` wraps `handler(request, context)` with `measureAsync("http.METHOD.path")` when `isEnabled()`; `main.ts` GC fiber and `AdaptiveResource` expose gauge inputs; `profiler/writer.ts` flushes JSONL every flush/snapshot window.
- **Writer** (`writer.ts`, 158) buffers `kind: "scope_done|proc|states|snapshot|start|stop"` lines and flushes via `openSync(writeSync(drain))` to `DIVEEOI_PROFILER_OUTPUT || ".divee/profiler.jsonl"` (with `mkdirSync(..., {recursive:true})`). Timers `DIVEEOI_PROFILER_FLUSH_MS=5000 / SNAPSHOT_MS=60000` are `unref()`'d; `SIGINT/SIGTERM` does `onFlushTick+drain` and `exit` drains without `process.exit(0)` (see `FINDINGS_AUDIT.md H3`).

Aggregates (`snapshot(): Aggregates`) fold `registry: Map<string,NodeStats{key,name,calls,errors,totalMs,minMs,maxMs,heapDeltaMB,heapDeltaMaxMB,rssDeltaMB,concurrentMax}>` into `functions|files|modules|classes|states|active|total`, where `files = segment(1)`, `modules = segment(0)`, `classes = segment(2)` on the `module.file.Class.fn` key grammar.

## Why it exists (optimization role)

The profiler was rewritten as part of the adaptive perf pass (`commit d1c4622`). Without it, every MTI/leak fix in the 800-line `OPTIMIZATION_PLAN.md` was unverifiable. It is the only way to prove the 13 adaptive targets track reality across the 4 profiles.

## Enabling

```bash
DIVEEOI_PROFILER=1 bun --cwd packages/server run dev
DIVEEOI_PROFILER=1 DIVEEOI_PROFILER_SAMPLE_RATE=0.05 bun --cwd packages/server run dev  # 5%
# custom sinks/intervals (see writer.ts)
DIVEEOI_PROFILER_OUTPUT=.divee/profiler.jsonl DIVEEOI_PROFILER_FLUSH_MS=5000 DIVEEOI_PROFILER_SNAPSHOT_MS=60000 DIVEEOI_PROFILER_MIN_MS=1 DIVEEOI_PROFILER_TOP_FUNCTIONS=200 bun --cwd packages/server run dev
```

Test override (without env): `import { _configure } from "@diveeoi/profiler"` then `_configure({enabled:true, sampleRate:0.1})`; pair with `_reset()` per fixture and `_onScope(listener)` to observe completion.

## In the repo

- `packages/server/src/main.ts` starts the GC + profiler runtime under `ManagedRuntime(AdaptiveResourceDefaultLayer)` (no independent runtime). `packages/server/src/dev/monitor.ts:DevMonitor` mirrors adaptive deviation every 60s.
- `packages/server/test/...` uses `testEffect()` which shares the `memoMap` and `_reset()`s between cases.
- Full wiring + target table: `docs/optimization.md`.

## Adaptive link

13 targets + 4 profiles are defined in `packages/db/src/adaptive/profiles.ts` (`comfortable/balanced/constrained/critical`). The writer's `flushMs/snapshotMs/minMs` env reads are *outside* that table — they tune profiling, not resource policy. Resource tuning belongs to `AdaptiveTargets`.

## Scripts

```bash
bun --cwd packages/profiler run typecheck
bun --cwd packages/profiler run test   # wrapper tests exercise wrap/instrument/gather
```
