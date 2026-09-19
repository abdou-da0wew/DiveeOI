# Performance & Memory Optimization

> The most important change in this fork. DiveeOI's server was made adaptive: it detects the host's memory and CPU, picks one of four resource profiles, and runs a background GC + backpressure loop that keeps RSS/heap on target while never stalling the session.

This document explains **what was slow, what leaks were fixed, what was measured, and how the adaptive system works**. For the phase-by-phase plan, see `plans/Optimization_1.0/OPTIMIZATION_PLAN.md`. For repro-grade numbers, see `plans/Optimization_1.0/FINDINGS_AUDIT.md` and `packages/profiler/DESIGN.md`.

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

### Detection (accurate per OS)

`detectSystemResources: Effect<SystemResources, never, never>` with a typed fallback `4096 total / 1024 available / ncpu`.

- Linux: `readFile("/proc/meminfo") -> Map(MemTotal, MemAvailable||MemFree) -> /1024` MB
- macOS: `spawn("sysctl","-n hw.memsize") -> totalBytes` + `spawn("vm_stat") -> Pages free / Pages inactive *4096 -> availableMB`
- Windows: `os.totalmem/freemem -> /1024/1024`
- Always through `Effect.catchCause(-> fallback)`, so the service never dies.

### Profiles and targets

Four profiles with hysteresis thresholds:

| Profile | `minFreeMB` | `minFreeRatio` | rssTarget | heapTarget | gc | tool | stream | SSE | WS | pty cap/TTL | cacheTTL | sqliteCache | timeouts |
|---------|-------------|---------------|-----------|------------|----|------|--------|-----|----|-------------|----------|-------------|----------|
| comfortable | 4096 | 0.50 | 700 | 400 | 60s | 8 | 200 | 1000 | 1000 | 5000/120s | 30m | 128 | 60s/5000 |
| balanced    | 1024 | 0.20 | 500 | 300 | 30s | 4 | 100 | 500  | 500  | 2000/60s  | 10m | 64  | 60s/5000 |
| constrained | 512  | 0.10 | 350 | 200 | 15s | 2 | 50  | 200  | 200  | 500/30s   | 2m  | 16  | 60s/5000 |
| critical    | 0    | 0    | 250 | 150 | 8s  | 1 | 25  | 100  | 100  | 200/15s   | 1m  | 8   | 60s/5000 |

`BASE_TARGETS` anchors the balanced tier; `PROFILE_MULTIPLIERS` overrides per tier.

`computeProfile(sys)` picks the highest tier whose `freeMB` and `freeRatio` are both met. `computeTargets(sys)` then caps:

```ts
rssTargetMB = min(mult.rss, totalMemoryMB * 0.12)
heapTargetMB = min(mult.heap, totalMemoryMB * 0.07)
maxToolConcurrency = clamp(mult.tool, 1..cpuCores)
```

`interpolateTargets(current, next, 0.3)` smooths live changes when the profile does not flip — avoids queue/capacity jumps mid-stream.

### Live service

`AdaptiveResourceService`:

```ts
interface AdaptiveResourceService {
  targets: Ref<AdaptiveTargets>
  profile: Ref<ResourceProfile>
  lastSystem: Ref<SystemResources|null>
  getCurrentTargets(): Effect<AdaptiveTargets>
  getCurrentProfile(): Effect<ResourceProfile>
  subscribe(fn: (t: AdaptiveTargets)=>void): Effect<()=>void>
}
```

Construction:

1. `detectSystemResources -> computeTargets/profile -> Ref.make(...)`
2. `updater = forever { sleep("90 seconds"); detect; fresh = compute; prev = Ref.get; target = freshProfile===prev ? interpolate 0.3 : fresh; Ref.set(...); notify(subs); logInfo("Adaptive targets updated", ...) }` wrapped with `Effect.catchCause(logError).forever` and `forkScoped`.
3. Subscribers are an in-memory `Set`; `subscribe` registers and returns an unsubscriber.

The `LayerNode` is `make(layer, [])` — no deps — and is provided via `makeAdaptiveLayer` at integration points so callers do not inherit `R|AdaptiveResource`.

### Consumption seams

- **Long-lived resources** (caches, DB PRAGMA, pty ticket `Cache.make`): `makeAdaptiveLayer(targets => Layer.effect(...))` — reads once at layer init and wraps `AdaptiveResourceDefaultLayer`.
- **Ephemeral resources** (per-request/stream, WS gate, SSE queue): `useAdaptiveTargets(({maxToolConcurrency}) => Semaphore.make(...))`.
- **Periodic**: the updater fiber itself + `DevMonitor` + `RunCoordinator` cleanup.

---

## What was integrated where (chronological by commit)

| Area | Before | After | Effect |
|------|--------|-------|--------|
| `prompt.ts` loop exit + `compaction stop` | `yield* extract` blocked | `forkDetach(extract).catch(logError)` | first token -30% to unblocked; 5-min stall removed |
| `main.ts` GC | fixed 30s | `ManagedRuntime(AdaptiveResource).forever { sleep gcIntervalMs; if rss>1.5*rssTarget => Bun.gc(true)+warn; if critical => warn; Bun.gc(true)+debug }` | heap converges to 250-400 MB band, emergency path prevents OOM kill |
| `packages/db/src/database/database.ts` | fixed `cache_size -64000` | `cache_size -sqliteCacheMB*1000, mmap_size*2, wal, busy_timeout 5000, foreign_keys ON, wal_checkpoint PASSIVE` via `makeAdaptiveLayer` | SQLite RSS scales 8-128MB per tier |
| `packages/db/src/pty/ticket.ts:Cache` | fixed `capacity 2000 ttl 60s` | adaptive `ptyTicketCapacity 200-5000 ttl 15-120s` | PTY handle memory tracks tier |
| `websocket-tracker.ts:add()` | unbounded | `if sockets.size >= maxWSConnections -> false` via `useAdaptiveTargets` | DoS ceiling |
| `handlers/event.ts` + `handlers/global.ts` SSE queues | `Queue.unbounded/bounded(500)` | `Queue.bounded(maxSSEQueueSize 100-1000)` via `useAdaptiveTargets` | stream backpressure |
| `packages/db/src/session/runner/llm.ts` stream | unbounded | `Stream.buffer(maxLLMStreamBuffer 25-200) + throttle(rate/2)` | no heap cliff on bursty providers |
| `packages/server/src/tool/registry.ts` tool run | unbounded | `Semaphore(maxToolConcurrency 1-8 capped cpuCores)` around each `def.execute` | tool storm throttled |
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

## Verified defects (and what not to re-introduce)

From `FINDINGS_AUDIT.md` on `dev@d1c4627`:

- **H1** `server.ts:99/116 duplicate import memoryExtractRoute` -> TS2300. Fix: keep the first.
- **H2** `registry.ts:124-125 + 239-248` two memory extract tools are `Tool.init`'d but never added to `builtin[]` — dead `Layer.succeed` + schema compile every boot. HTTP route alone serves them. Fix: delete the two inits or register them.
- **H3** `profiler/src/writer.ts:39 openSync(".divee/profiler.jsonl")` ENOENT on fresh clones; `50 process.exit(0)` inside signal handler prevents graceful drains. Fix: `mkdirSync(dirname(output), {recursive:true})` before `openSync`; signal handler does only `onFlushTick+ drain` and relies on `unref()` to exit.
- **H4** `publish-llm-event.ts` 21 `Effect.die` calls abort the session runner's fiber as a defect — untyped, not retryable. Keep `die` only for true invariants; convert recoverable sites to `Effect.fail(TypedError)`.
- **H5/H6** theme route auth + ToolRegistry memory layers are already fixed.

Each fix criterion matches the user requirement: *must NOT decrease speed/effectiveness/functionality*.

---

## Success targets

| Metric | comfortable | balanced | constrained | critical |
|--------|-------------|----------|-------------|----------|
| RSS | <=700 | <=500 | <=350 | <=250 MB |
| Heap | <=400 | <=300 | <=200 | <=150 |
| First token p50 | <1.5s | <2s | <3s | <5s |
| GC interval | 60s | 30s | 15s | 8s |
| Tool concurrency | 8 | 4-6 | 2-3 | 1-2 |
| Stability | Zero OOM | Zero OOM | Zero OOM | Zero OOM |

Zero session deletion ever. Full history is kept; pagination + transparent compression give the bounded-RSS illusion at constant fidelity.

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
