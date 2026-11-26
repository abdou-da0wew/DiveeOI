# Performance & Memory Optimization

> DiveeOI includes an adaptive resource manager: it detects host/container memory and CPU limits, selects one of four profiles, and adjusts bounded resources and GC scheduling under pressure.

> **Historical verification note — 2026-10-29:** at that checkpoint, the resource targets below matched the source configuration. Benchmark and measurement claims are not fresh results for the current branch; Bun and workspace dependencies were unavailable then. See `CONTEXT.md` for current verification status.

> **2026-11-27 low-end hardware pass:** the interactive player hot path was optimized for a specific reference machine (see "Low-end hardware target" below). One fresh measurement exists for that pass: the live-physics bench in `packages/coenx-video/scripts/bench-live-physics.ts` (44 bodies, collide-heavy, 900 steps) went from 0.0537 ms/step on the pre-pass code to 0.0392 ms/step after (-27%), producing an identical 366 collision events — determinism preserved. All other numbers in that section are structural counts or configured budgets, not benchmarks.

This document explains **what was slow, what leaks were fixed, what was measured historically, and how the adaptive system works**. For the phase-by-phase plan, see `plans/Optimization_1.0/OPTIMIZATION_PLAN.md`; profiler design details are in `packages/profiler/DESIGN.md`. Historical benchmark claims are not fresh results for this branch.

---

## The stall that mattered most

Every `SessionPrompt.prompt` that appended a user message eventually called:

```ts
// packages/server/src/session/prompt.ts:1262 (before)
yield* memory.extractSessionMemory(sessionID, msgs)
```

`extractSessionMemory` fans out to the memory extractor LLM, the graph indexer, and SQLite writes — on success 300ms, on model pressure multiple seconds, on cold resolver path up to minutes. Because it was `yield*`ed inline at loop exit and at `compaction stop`, every session's **next prompt could not start until extraction finished**. The observable effect was a 1-5 minute UI stall after each turn that touched memory.

Fix: `Effect.forkDetach` into the session scope:

```ts
yield* Effect.forkDetach(
  memory.extractSessionMemory(sessionID, msgs as any).pipe(
    Effect.catch((err) => Effect.logError("Session memory extraction failed", { sessionID, error: err })),
  ),
)
```

The same two sites are now at `1263/1294`: loop `break` and `compaction stop`. Title and summary generation already used the pattern — extraction now matches. The success path is unchanged; failures are logged rather than blocking.

This single change removed the only user-facing stall in the hot path.

---

## Adaptive resource system

Location: `packages/db/src/adaptive/{detect,profiles,service,hooks,index}.ts`.

This section describes the current configured behavior. It is not a new benchmark report; this workspace could not run Bun or the project test suite.

### Detection (host and container aware)

`detectSystemResources: Effect<SystemResources, never, never>` falls back to `4096 MB total / 1024 MB available / available CPU parallelism` if platform reads fail.

- **Linux memory:** `/proc/meminfo` provides host total/available memory. cgroup v2 `memory.max` / `memory.current` and cgroup v1 `memory.limit_in_bytes` / `memory.usage_in_bytes` further constrain the detected total and free memory.
- **Linux CPU:** `os.availableParallelism()` is clamped to cgroup v2 `cpu.max` or cgroup v1 `cpu.cfs_quota_us` / `cpu.cfs_period_us`; fractional quotas are floored with a minimum of one usable worker. Both `cpu` and common `cpu,cpuacct` v1 mount paths are checked.
- **macOS:** `sysctl -n hw.memsize` supplies total memory; free + inactive pages from `vm_stat` estimate available memory.
- **Windows:** `os.totalmem()` / `os.freemem()` provide the memory values.
- Linux storage hint reads the rotational flag for the root device when available. Detection failures are caught and logged, with a typed fallback so the adaptive service can continue.

### Profiles and targets

`computeProfile(sys)` selects the highest tier whose free-memory absolute and ratio thresholds are both satisfied. Values below are configuration targets, not guaranteed process ceilings.

| Profile | Minimum free memory | RSS budget | Heap budget | GC interval | Tool concurrency* | Stream buffer | SSE queue | WS limit | PTY capacity / TTL | Cache TTL | SQLite cache | LLM / DB timeout |
|---------|--------------------:|-----------:|------------:|------------:|------------------:|--------------:|----------:|---------:|-------------------:|-----------:|-------------:|-----------------:|
| comfortable | 4096 MB and 50% | 45% of detected total | 30% | 60 s | 16 | 400 | 2000 | 2000 | 10000 / 300 s | 30 min | 256 MB | 120 s / 10 s |
| balanced | 1024 MB and 20% | 32% | 22% | 30 s | 8 | 200 | 1000 | 1000 | 5000 / 120 s | 10 min | 128 MB | 90 s / 7.5 s |
| constrained | 512 MB and 10% | 22% | 14% | 15 s | 3 | 100 | 400 | 400 | 1500 / 60 s | 2 min | 64 MB | 60 s / 5 s |
| critical | 0 MB and 0% | 12% | 8% | 5 s | 1 | 32 | 100 | 100 | 250 / 30 s | 1 min | 16 MB | 30 s / 3 s |

\* Tool concurrency is also capped to detected CPU capacity. RSS and heap budgets scale with detected total memory (with minimum floors and an RSS upper cap); queue, cache, batch, task, heartbeat, and checkpoint targets have profile-specific values in `profiles.ts`.

Pressure sheds resources immediately. Recovery advances by at most one profile and requires 15% extra free-memory headroom and an additional 0.05 free-memory ratio beyond the profile boundary. This avoids rapid profile oscillation.

`interpolateTargets(current, next, 0.3)` smooths target changes while a profile remains stable. When the profile changes, new targets are applied directly.

### Live service

`AdaptiveResourceService` keeps `targets`, `profile` and `lastSystem` in Effect `Ref`s and exposes `getCurrentTargets()`, `getCurrentProfile()` and `subscribe(fn)`. It samples every 90 seconds, updates profile/targets, notifies subscribers and logs changes. A failed update is logged and does not terminate the updater fiber.

The server GC scheduler reads the adaptive interval. It performs a synchronous full `Bun.gc(true)` only when the detected host/container is low on memory **and** process RSS exceeds the current RSS target; otherwise it requests incremental `Bun.gc(false)`.

### Consumption seams

- `useAdaptiveTargets` reads current values at decision points (tool semaphore, stream buffer, WebSocket connection cap, SSE queues).
- `makeAdaptiveLayer` configures long-lived resources (PTY ticket cache, initial SQLite PRAGMAs) without leaking an adaptive service requirement into callers.
- The main SQLite connection subscribes to target updates and adjusts `cache_size` and `mmap_size` as profiles change.
- `DevMonitor` reports profile and current memory target information; it is diagnostic, not a hard resource-enforcement mechanism.

---

## What was integrated where (chronological by commit)

The table records implementation intent/seams. Performance deltas and memory figures documented by earlier runs are historical; no benchmarks were repeated for the current branch.

| Area | Before | After | Effect / configured behavior |
| `prompt.ts` loop exit + `compaction stop` | `yield* extract` blocked | `forkDetach(extract).catch(logError)` | first token -30% to unblocked; 5-min stall removed |
| `main.ts` GC | fixed interval/full GC | adaptive `gcIntervalMs`; full collection only when host/container is low and process RSS exceeds target, incremental collection otherwise | pressure-aware collection; this is not a hard RSS ceiling |
| `packages/db/src/database/database.ts` | fixed SQLite cache | profile-scaled `cache_size` and `mmap_size`, WAL, busy timeout, foreign keys; subscribes to changes | SQLite cache target ranges 16–256 MB |
| `packages/db/src/pty/ticket.ts:Cache` | fixed capacity/TTL | adaptive `ptyTicketCapacity` 250–10000 and TTL 30–300s at layer initialization | PTY cache sizing follows startup profile |
| `websocket-tracker.ts:add()` | unbounded | rejects new sockets at `maxWSConnections` 100–2000 via `useAdaptiveTargets` | bounded connection count |
| `handlers/event.ts` + `handlers/global.ts` SSE queues | unbounded/fixed | `Queue.bounded(maxSSEQueueSize)` with target range 100–2000 | bounded event buffering |
| `packages/db/src/session/runner/llm.ts` stream | unbounded | `Stream.buffer(maxLLMStreamBuffer)` with target range 32–400 | bounded stream buffering |
| `packages/server/src/tool/registry.ts` tool run | unbounded | `Semaphore(maxToolConcurrency)` target range 1–16, capped by detected CPU capacity | profile-aware tool concurrency |
| `packages/server/src/session/message-v2.ts` + `session.ts:messages({limit,before,after})` | always full sweep | paginated `limit 50 + cursor`, token-window `applyTokenWindow` respects last compaction | compaction time -60% on 2k-message threads, disk still zero-deletion |
| `packages/server/src/storage/storage.ts` | raw JSON | `>10KB gzipSync -> "GZIP:"+base64` + `maybeDecompress` on read | tool output compression >60%, full fidelity |
| `scripts/build.ts:execArgv` | none | `--memory-limit=1200 --max-old-space-size=512` | node/binary ceiling above adaptive targets but below OOM |
| `packages/profiler/src/*` | legacy ad-hoc timers | rewrote `core.ts` as `AsyncLocalStorage<ScopeNode>` call-tree with `wrap/instrument/measure/measureAsync/scope/gauge/gaugeDelta/sampleRate`, `writer.ts` as buffered `openSync + writeSync + drain` JSONL `scope_done/proc/states/snapshot/start/stop` to `.divee/profiler.jsonl` with `unref()` timers and `SIGINT/SIGTERM + exit` drain, no `process.exit(0)` | 40+ themes hot-path instrumented without heap impact |
| `packages/server/src/dev/monitor.ts` | simple rss log | per-endpoint RSS/heap/GC, `DevMonitorSnapshot{ts,uptimeS,memory{rssMB,heapMB,externalMB,gcAvailable},adaptive{profile,profileChanged,rssTargetMB,heapTargetMB,gcIntervalMs,rssDeviationPct,heapDeviationPct}}`, 60s interval | via own `ManagedRuntime(AdaptiveResourceDefaultLayer)` |
| `packages/server/src/session/prompt.ts:applyTokenWindow` | naive | estimate `chars/4`, search last `compaction` summary, cut by `usable tokens` | context window aware |
| Self-healing | none | `8 init, gc, ticket, WS, SSE, stream, tool` plus `dev/monitor` snapshot + stale guard | `main.ts 1.5x emergency GC + critical degrade warning` |
| `packages/server/src/session/memory-scheduler.ts` | none | `MemoryScheduler.node: Database+SessionMemoryIntegration, Layer merge + schedule daily 12:00 + manual trigger` (the one must-provide-once scheduler; its `scheduler.start()` side-effect at build time is why `createRoutes` must not duplicate the node) | off-loop memory consolidation |

---

## How to use the adaptive seams

For a short-lived buffer or queue created during request handling:

```ts
import { useAdaptiveTargets } from "@diveeoi/db/adaptive"
const queue = yield* useAdaptiveTargets(({ maxSSEQueueSize }) =>
  Queue.bounded<EventV2.Payload>(maxSSEQueueSize)
)
```

For a layer-scoped cache created once at startup:

```ts
import { makeAdaptiveLayer } from "@diveeoi/db/adaptive/hooks"
export const layer = makeAdaptiveLayer((targets) =>
  Layer.effect(Service, Effect.gen(function* () {
    const cache = yield* Cache.make({ capacity: targets.ptyTicketCapacity, timeToLive: Duration.millis(targets.ptyTicketTTLMs) })
    // ...
  }))
)
```

`makeAdaptiveLayer` wraps the layer with `Layer.unwrap( gen(detect -> compute -> makeLayer(targets)) ).pipe(Layer.provide(AdaptiveResourceDefaultLayer))` so `RIn` does not leak `AdaptiveResource`.

---

## Targets and measurement status

The following are configured profile budgets, not guarantees or fresh benchmark results. RSS/heap values scale with detected total memory rather than using a fixed MB target.

| Target | comfortable | balanced | constrained | critical |
|--------|-------------|----------|-------------|----------|
| RSS budget | 45% of detected total | 32% | 22% | 12% |
| Heap budget | 30% of detected total | 22% | 14% | 8% |
| GC interval | 60 s | 30 s | 15 s | 5 s |
| Max tool concurrency* | 16 | 8 | 3 | 1 |
| Stream buffer | 400 | 200 | 100 | 32 |
| SQLite cache target | 256 MB | 128 MB | 64 MB | 16 MB |
| First-token p50 goal** | <1.5 s | <2 s | <3 s | <5 s |

\* Capped by detected CPU capacity.  \n\** Historical performance goal only; not benchmarked in the current branch. Resource targets are intended to reduce risk under pressure but do not guarantee zero OOMs.

Zero session deletion remains a data-retention goal. Full history is kept; pagination and transparent compression reduce working-set pressure without deleting conversation history.

---

## Running and measuring

```bash
# enable JSONL + aggregation
DIVEEOI_PROFILER=1 bun --cwd packages/server run dev
# sampled variant
DIVEEOI_PROFILER=1 DIVEEOI_PROFILER_SAMPLE_RATE=0.05 bun --cwd packages/server run dev
# custom sinks/intervals
DIVEEOI_PROFILER_OUTPUT=.divee/profiler.jsonl DIVEEOI_PROFILER_FLUSH_MS=5000 DIVEEOI_PROFILER_SNAPSHOT_MS=60000 DIVEEOI_PROFILER_MIN_MS=1 DIVEEOI_PROFILER_TOP_FUNCTIONS=200 bun --cwd packages/server run dev
```

Artifacts are `kind:"start|scope_done|proc|states|snapshot|stop"` lines appended to `.divee/profiler.jsonl`; `proc` + `states` flush every `flushMs`, `snapshot` every `snapshotMs`. The live panel is `DevMonitor` (writes `process.stderr` every 60s in `development` only) using its own `ManagedRuntime(AdaptiveResourceDefaultLayer)`.

---

## One-line fixes to NEVER regress

- `packages/server/src/session/prompt.ts:1262 + 1290` stay `forkDetach`, not `yield*`.
- `packages/server/src/main.ts` keeps its own `ManagedRuntime` GC fiber (do not move GC into `AppLayer` where a disposal races `process.exit`).
- `packages/server/src/tool/registry.ts:node` deps include `Memory.node, SessionMemoryIntegration.node, MemoryScheduler.node`; `packages/server/src/server/routes/instance/httpapi/server.ts:createRoutes` supplies the two outside-group `provideMerge` connectors (duplicating `MemoryScheduler` elsewhere starts two daily schedulers).

---

## Low-end hardware target

Reference machine the stack must stay comfortable on while running **everything at once** — DiveeOI server + app in a browser + Targeted-Learning retrieval + an interactive `.coenx4` video playing in the session panel:

| Component | Spec |
|---|---|
| CPU | Intel i5, 10th gen (4C/8T mobile) |
| RAM | 8 GB DDR4 |
| Swap | 15 GB on NVMe SSD |
| GPU | NVIDIA MX250 (2 GB) |

### How the stack fits in 8 GB

- **Server.** The adaptive system detects the host and lands on `balanced` (free RAM ≥ 1024 MB and ≥ 20%) or `constrained` (≥ 512 MB and ≥ 10%) once the browser and OS take their share. That bounds the process to roughly a 1.7–2.6 GB RSS budget, SQLite page cache 64–128 MB, bounded SSE/WS/stream queues, and GC scheduling on a 15–30 s interval. The server never hard-allocates the budget; queues and caches shrink under pressure.
- **TL retrieval.** Embeddings run in-process via Transformers.js with the **int8** quantized model (default), batch size 16, and vectors stay in SQLite (`sqlite-vec` KNN with SQL-side book scoping) — the index is never fully resident. On 4 cores, ingest competes with the browser for CPU: if you ingest while playing an interactive video, cap `intraOpThreads` (settings → TL) at 2 to keep the player's frame time stable.
- **Interactive player (browser).** Fixed caps, not machine-dependent: `maxFps 30` and `maxDevicePixelRatio 1.5` are passed by the app panel (higher values are clamped, not honored). At a ~700 px-wide panel the canvas backing store is ≈ 1050×590 — small enough that the MX250 / Skia rasterization stays cheap. The player also pauses automatically when the tab or panel scrolls out of view (IntersectionObserver), so background tabs cost nothing.
- **Swap.** The 15 GB NVMe swap is a safety net for ingest spikes and LLM stream buffers, not a license to leak. The adaptive RSS targets above exist so the working set stays resident; if you see sustained swap-in of the server process, drop the profile by closing tabs or freeing RAM, not by raising budgets.

### What the 2026-11-27 player pass changed (structural, per rendered frame)

| Hot path | Before | After |
|---|---|---|
| Layout reads (`getBoundingClientRect`) | 2 per frame (render + sizeCanvas) | 1 per frame, shared |
| Scene evaluation (`evaluateSceneAtFrame` + text/grain passes) | 2 per frame (hit-testing + drawing) | 1 per frame, shared by both consumers |
| Physics step allocations | array + 2 Sets per step (up to 12 steps/render) | 0 (reused buffers, set ping-pong) |
| Collision detection | `Math.hypot` per pair | squared-distance rejection; sqrt only on overlap |
| Pose/override merge | Map + N objects per frame always | skipped entirely while the world is idle/settled (`overridesVersion` guard) |
| Grain effect | 128×128 ImageData + pattern per grain node per frame (single-entry cache vs a per-frame seed = guaranteed miss) | 8 deterministic seed buckets; per-frame cost is a `fillRect` |
| Control-node CSS writes | ~10 per control per frame | only when the value signature changes |
| Transition style writes | 6 properties × 2 elements per frame | skipped when the transition signature is unchanged |

Fresh measurement for this pass: 44-body collide-heavy physics bench, median **0.0537 → 0.0392 ms/step (−27%)**, identical collision events (366). Regenerate with `bun scripts/bench-live-physics.ts` inside `packages/coenx-video`.

### Rules to keep it true on that machine

- Never raise the app-panel player caps (`maxFps`, `maxDevicePixelRatio`) "temporarily" — they are the MX250 budget.
- `canvas` renderer stays the default for the session panel; the SVG backend rebuilds the DOM every frame and is for exports/edge cases only.
- The physics step cap (`MAX_PHYSICS_STEPS_PER_RENDER = 12`) stays; raising it reintroduces worst-case stalls after tab throttling.
- Keep collisions deterministic: reuse buffers only inside `LivePhysicsWorld`; the public `poses()` API still returns owned snapshots (tests hold them across steps).
