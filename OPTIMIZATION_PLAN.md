# DiveeOI Adaptive Resource Optimization Plan
**Philosophy**: Dynamic, cross-platform, zero-deletion, lightweight adaptive system with live reconfiguration that's actually implementable.

---

## Core Principles

| Principle | Implementation |
|-----------|----------------|
| **Adaptive, not rigid** | Detect at startup → set profile → periodic re-check → new resources use new profile |
| **Cross-platform first** | Single detection module: `/proc/meminfo` (Linux), `sysctl` (macOS), `os.freemem()` (Windows) |
| **Zero deletion** | Never delete sessions/messages; lazy load + transparent compression only |
| **Lightweight adapter** | ~500KB overhead, one fiber, one Ref, updates every 90s |
| **Live reconfiguration** | Components read `Ref<AdaptiveTargets>` at creation/decision points |
| **Phases + Debug Stages** | Each phase → validate → debug → next phase |

---

## The Adaptive System (Engineered for Live Reconfig)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  AdaptiveResourceService (Effect Service)                   │
│  ┌─────────────────┐    ┌────────────────────────────────┐  │
│  │ Ref<AdaptiveTargets>  │  Periodic Updater Fiber       │  │
│  │ (live config)    │◄───│  (every 90s, jittered)        │  │
│  └────────┬────────┘    └────────────────────────────────┘  │
│           │                                                │
│           ▼                                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Components read targets at:                           │ │
│  │  • Startup (for long-lived resources)                  │ │
│  │  • Per-request/stream (for ephemeral resources)        │ │
│  │  • Periodic intervals (for GC, cleanup)                │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Files (Adaptive Core - 5 files)

```
packages/db/src/adaptive/
├── detect.ts          # Cross-platform detection (NO os.freemem() on Linux/macOS)
├── profiles.ts        # Profile definitions + computation (pure functions)
├── service.ts         # Effect service with Ref + updater fiber
├── hooks.ts           # Helper hooks: useAdaptiveTargets, withAdaptiveConfig
└── index.ts           # Exports
```

---

### detect.ts — Cross-Platform Detection (Accurate)

```ts
// packages/db/src/adaptive/detect.ts
import { Effect, Duration } from "effect"
import { readFile } from "fs/promises"
import { spawn } from "child_process"

export interface SystemResources {
  totalMemoryMB: number
  availableMemoryMB: number  // MemAvailable on Linux, physmem - wired on macOS, os.freemem on Windows
  cpuCores: number
  platform: "windows" | "darwin" | "linux"
}

export const detectSystemResources = Effect.fn("Adaptive.detect")(
  Effect.gen(function* () {
    const platform = process.platform
    const cpuCores = require("os").cpus().length
    
    if (platform === "linux") {
      // Linux: parse /proc/meminfo for MemAvailable (accurate!)
      const meminfo = yield* Effect.tryPromise({
        try: () => readFile("/proc/meminfo", "utf8"),
        catch: () => { throw new Error("Cannot read /proc/meminfo") }
      })
      
      const parse = (key: string) => {
        const match = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`))
        return match ? parseInt(match[1], 10) : 0
      }
      
      const totalKB = parse("MemTotal")
      const availableKB = parse("MemAvailable") || parse("MemFree") // fallback
      
      return {
        totalMemoryMB: Math.round(totalKB / 1024),
        availableMemoryMB: Math.round(availableKB / 1024),
        cpuCores,
        platform: "linux" as const
      }
    }
    
    if (platform === "darwin") {
      // macOS: sysctl hw.memsize + vm_stat for available
      const [totalBytes, vmStat] = yield* Effect.all([
        Effect.tryPromise({
          try: () => new Promise((resolve, reject) => {
            const p = spawn("sysctl", ["-n", "hw.memsize"])
            let out = ""
            p.stdout.on("data", d => out += d)
            p.on("close", c => c === 0 ? resolve(parseInt(out.trim(), 10)) : reject(new Error("sysctl failed")))
          }),
          catch: () => { throw new Error("sysctl hw.memsize failed") }
        }),
        Effect.tryPromise({
          try: () => new Promise((resolve, reject) => {
            const p = spawn("vm_stat")
            let out = ""
            p.stdout.on("data", d => out += d)
            p.on("close", c => c === 0 ? resolve(out) : reject(new Error("vm_stat failed")))
          }),
          catch: () => { throw new Error("vm_stat failed") }
        })
      ])
      
      // Parse vm_stat for free/inactive pages (4KB pages)
      const pageSize = 4096
      const parseVm = (label: string) => {
        const match = vmStat.match(new RegExp(`${label}:\\s+(\\d+)`))
        return match ? parseInt(match[1], 10) * pageSize : 0
      }
      
      const freeBytes = parseVm("Pages free")
      const inactiveBytes = parseVm("Pages inactive")
      const availableBytes = freeBytes + inactiveBytes // conservative
      
      return {
        totalMemoryMB: Math.round(totalBytes / 1024 / 1024),
        availableMemoryMB: Math.round(availableBytes / 1024 / 1024),
        cpuCores,
        platform: "darwin" as const
      }
    }
    
    // Windows: os.freemem() is reasonably accurate
    const os = require("os")
    return {
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      availableMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      cpuCores,
      platform: "windows" as const
    }
  })
).pipe(Effect.catchAllCause(Effect.logError).pipe(Effect.as({
  totalMemoryMB: 4096,
  availableMemoryMB: 1024,
  cpuCores: require("os").cpus().length,
  platform: process.platform as "windows" | "darwin" | "linux"
})))
```

---

### profiles.ts — Pure Computation (Testable, No Side Effects)

```ts
// packages/db/src/adaptive/profiles.ts
export type ResourceProfile = "comfortable" | "balanced" | "constrained" | "critical"

export interface AdaptiveTargets {
  rssTargetMB: number
  heapTargetMB: number
  gcIntervalMs: number
  maxToolConcurrency: number
  maxLLMStreamBuffer: number
  maxSSEQueueSize: number
  maxWSConnections: number
  ptyTicketCapacity: number
  ptyTicketTTLMs: number
  cacheTTLMs: number
  sqliteCacheMB: number
  llmRequestTimeoutMs: number
  dbQueryTimeoutMs: number
}

export interface SystemResources {
  totalMemoryMB: number
  availableMemoryMB: number
  cpuCores: number
  platform: "windows" | "darwin" | "linux"
}

// Hysteresis thresholds (prevent oscillation)
const PROFILE_THRESHOLDS = {
  comfortable: { minFreeMB: 4096, minFreeRatio: 0.5 },
  balanced:    { minFreeMB: 1024, minFreeRatio: 0.2 },
  constrained: { minFreeMB: 512,  minFreeRatio: 0.1 },
  critical:    { minFreeMB: 0,    minFreeRatio: 0 }
} as const

export const computeProfile = (sys: SystemResources): ResourceProfile => {
  const freeMB = sys.availableMemoryMB
  const freeRatio = sys.availableMemoryMB / sys.totalMemoryMB
  
  if (freeMB >= PROFILE_THRESHOLDS.comfortable.minFreeMB && freeRatio >= PROFILE_THRESHOLDS.comfortable.minFreeRatio) return "comfortable"
  if (freeMB >= PROFILE_THRESHOLDS.balanced.minFreeMB && freeRatio >= PROFILE_THRESHOLDS.balanced.minFreeRatio) return "balanced"
  if (freeMB >= PROFILE_THRESHOLDS.constrained.minFreeMB && freeRatio >= PROFILE_THRESHOLDS.constrained.minFreeRatio) return "constrained"
  return "critical"
}

// Base targets scaled by profile multipliers
const BASE_TARGETS: AdaptiveTargets = {
  rssTargetMB: 500,        // Will be scaled
  heapTargetMB: 300,
  gcIntervalMs: 30000,
  maxToolConcurrency: 4,
  maxLLMStreamBuffer: 100,
  maxSSEQueueSize: 500,
  maxWSConnections: 500,
  ptyTicketCapacity: 2000,
  ptyTicketTTLMs: 60000,
  cacheTTLMs: 600000,      // 10 min
  sqliteCacheMB: 64,
  llmRequestTimeoutMs: 60000,
  dbQueryTimeoutMs: 5000
}

const PROFILE_MULTIPLIERS: Record<ResourceProfile, Partial<AdaptiveTargets>> = {
  comfortable: {
    rssTargetMB: 700,
    heapTargetMB: 400,
    gcIntervalMs: 60000,
    maxToolConcurrency: 8,
    maxLLMStreamBuffer: 200,
    maxSSEQueueSize: 1000,
    maxWSConnections: 1000,
    ptyTicketCapacity: 5000,
    ptyTicketTTLMs: 120000,
    cacheTTLMs: 1800000,   // 30 min
    sqliteCacheMB: 128
  },
  balanced: {
    rssTargetMB: 500,
    heapTargetMB: 300,
    gcIntervalMs: 30000,
    maxToolConcurrency: 4,
    maxLLMStreamBuffer: 100,
    maxSSEQueueSize: 500,
    maxWSConnections: 500,
    ptyTicketCapacity: 2000,
    ptyTicketTTLMs: 60000,
    cacheTTLMs: 600000,
    sqliteCacheMB: 64
  },
  constrained: {
    rssTargetMB: 350,
    heapTargetMB: 200,
    gcIntervalMs: 15000,
    maxToolConcurrency: 2,
    maxLLMStreamBuffer: 50,
    maxSSEQueueSize: 200,
    maxWSConnections: 200,
    ptyTicketCapacity: 500,
    ptyTicketTTLMs: 30000,
    cacheTTLMs: 120000,    // 2 min
    sqliteCacheMB: 16
  },
  critical: {
    rssTargetMB: 250,
    heapTargetMB: 150,
    gcIntervalMs: 8000,
    maxToolConcurrency: 1,
    maxLLMStreamBuffer: 25,
    maxSSEQueueSize: 100,
    maxWSConnections: 100,
    ptyTicketCapacity: 200,
    ptyTicketTTLMs: 15000,
    cacheTTLMs: 60000,     // 1 min
    sqliteCacheMB: 8
  }
}

export const computeTargets = (sys: SystemResources): AdaptiveTargets => {
  const profile = computeProfile(sys)
  const mult = PROFILE_MULTIPLIERS[profile]
  const baseRSS = Math.min(BASE_TARGETS.rssTargetMB, Math.round(sys.totalMemoryMB * 0.12))
  const baseHeap = Math.min(BASE_TARGETS.heapTargetMB, Math.round(sys.totalMemoryMB * 0.07))
  
  return {
    ...BASE_TARGETS,
    ...mult,
    rssTargetMB: Math.min(mult.rssTargetMB ?? BASE_TARGETS.rssTargetMB, baseRSS),
    heapTargetMB: Math.min(mult.heapTargetMB ?? BASE_TARGETS.heapTargetMB, baseHeap),
    maxToolConcurrency: Math.max(1, Math.min(mult.maxToolConcurrency ?? BASE_TARGETS.maxToolConcurrency, sys.cpuCores))
  }
}

// Smooth interpolation for live updates (prevents jumps)
export const interpolateTargets = (current: AdaptiveTargets, next: AdaptiveTargets, factor = 0.3): AdaptiveTargets => {
  const keys = Object.keys(current) as (keyof AdaptiveTargets)[]
  return keys.reduce((acc, k) => {
    acc[k] = Math.round(current[k] + (next[k] - current[k]) * factor)
    return acc
  }, {} as AdaptiveTargets)
}
```

---

### service.ts — Lightweight Effect Service with Live Ref

```ts
// packages/db/src/adaptive/service.ts
import { Context, Effect, Layer, Ref, Schedule, Duration } from "effect"
import { detectSystemResources } from "./detect"
import { computeTargets, computeProfile, interpolateTargets, type AdaptiveTargets, type SystemResources, type ResourceProfile } from "./profiles"

export interface AdaptiveResourceService {
  readonly targets: Ref.Ref<AdaptiveTargets>
  readonly profile: Ref.Ref<ResourceProfile>
  readonly system: Ref.Ref<SystemResources>
  readonly getCurrentTargets: () => Effect.Effect<AdaptiveTargets>
  readonly getCurrentProfile: () => Effect.Effect<ResourceProfile>
  readonly getSystem: () => Effect.Effect<SystemResources>
  readonly subscribe: (onChange: (targets: AdaptiveTargets) => void) => Effect.Effect<() => void>
}

export const AdaptiveResourceService = Context.Service<AdaptiveResourceService, AdaptiveResourceService>()("@diveeoi/AdaptiveResource")

export const layer = Layer.effect(
  AdaptiveResourceService,
  Effect.gen(function* () {
    // Initial detection
    const system = yield* detectSystemResources
    const initialTargets = computeTargets(system)
    const initialProfile = computeProfile(system)
    
    const targetsRef = yield* Ref.make(initialTargets)
    const profileRef = yield* Ref.make(initialProfile)
    const systemRef = yield* Ref.make(system)
    const subscribersRef = yield* Ref.make<Set<(t: AdaptiveTargets) => void>>(new Set())
    
    // Periodic updater fiber (every 90s + jitter)
    const updater = Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(Duration.millis(90000 + Math.random() * 30000)) // 90-120s
        
        const freshSystem = yield* detectSystemResources
        const freshTargets = computeTargets(freshSystem)
        const freshProfile = computeProfile(freshSystem)
        
        const currentTargets = yield* Ref.get(targetsRef)
        const currentProfile = yield* Ref.get(profileRef)
        
        // Only update if profile changed OR significant drift (>15%)
        const profileChanged = freshProfile !== currentProfile
        const significantDrift = Object.keys(currentTargets).some(k => {
          const key = k as keyof AdaptiveTargets
          const diff = Math.abs(currentTargets[key] - freshTargets[key]) / currentTargets[key]
          return diff > 0.15
        })
        
        if (profileChanged || significantDrift) {
          const smoothed = profileChanged ? freshTargets : interpolateTargets(currentTargets, freshTargets, 0.3)
          
          yield* Ref.set(targetsRef, smoothed)
          yield* Ref.set(profileRef, freshProfile)
          yield* Ref.set(systemRef, freshSystem)
          
          yield* Effect.logInfo("Adaptive profile updated", {
            from: currentProfile, to: freshProfile,
            rss: `${currentTargets.rssTargetMB}→${smoothed.rssTargetMB}`,
            heap: `${currentTargets.heapTargetMB}→${smoothed.heapTargetMB}`,
            gc: `${currentTargets.gcIntervalMs}→${smoothed.gcIntervalMs}ms`
          })
          
          // Notify subscribers
          const subs = yield* Ref.get(subscribersRef)
          for (const fn of subs) fn(smoothed)
        }
      }
    }).pipe(
      Effect.catchAllCause(c => Effect.logError("Adaptive updater error", { cause: c })),
      Effect.forever
    )
    
    yield* Effect.forkScoped(updater)
    
    return {
      targets: targetsRef,
      profile: profileRef,
      system: systemRef,
      getCurrentTargets: () => Ref.get(targetsRef),
      getCurrentProfile: () => Ref.get(profileRef),
      getSystem: () => Ref.get(systemRef),
      subscribe: (fn) => Effect.gen(function* () {
        const subs = yield* Ref.get(subscribersRef)
        subs.add(fn)
        yield* Ref.set(subscribersRef, subs)
        return () => Effect.gen(function* () {
          const s = yield* Ref.get(subscribersRef)
          s.delete(fn)
          yield* Ref.set(subscribersRef, s)
        })
      })
    }
  })
)
```

---

### hooks.ts — Easy Component Integration

```ts
// packages/db/src/adaptive/hooks.ts
import { Effect, Ref } from "effect"
import { AdaptiveResourceService, type AdaptiveTargets } from "./service"

// Read current targets at decision point (for ephemeral resources)
export const useAdaptiveTargets = <A, E, R>(
  f: (targets: AdaptiveTargets) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | AdaptiveResourceService> =>
  Effect.gen(function* () {
    const { getCurrentTargets } = yield* AdaptiveResourceService
    const targets = yield* getCurrentTargets()
    return yield* f(targets)
  })

// Create resource with adaptive config (for caches, queues, semaphores created at runtime)
export const withAdaptiveConfig = <Config, A, E, R>(
  makeConfig: (targets: AdaptiveTargets) => Config,
  useResource: (config: Config) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | AdaptiveResourceService> =>
  useAdaptiveTargets(targets => useResource(makeConfig(targets)))

// For long-lived resources created at startup: read once at layer init
export const makeAdaptiveLayer = <S, E, R>(
  makeLayer: (targets: AdaptiveTargets) => Layer.Layer<S, E, R>
): Layer.Layer<S, E, R | AdaptiveResourceService> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { getCurrentTargets } = yield* AdaptiveResourceService
      const targets = yield* getCurrentTargets()
      return makeLayer(targets)
    })
  )
```

---

## Phase 0: Foundation — Adaptive Core (Debug Stage 0)

### 0.1 Create Adaptive Module (5 files)
- `packages/db/src/adaptive/detect.ts`
- `packages/db/src/adaptive/profiles.ts`
- `packages/db/src/adaptive/service.ts`
- `packages/db/src/adaptive/hooks.ts`
- `packages/db/src/adaptive/index.ts`

### 0.2 Wire into App Layer
**File**: `packages/server/src/effect/app-runtime.ts`
```ts
import { AdaptiveResourceService } from "@diveeoi/db/adaptive"
// Add to AppLayer mergeAll:
AdaptiveResourceService.defaultLayer,
```

### 0.3 Debug Stage 0: Validate Detection
- Run on Linux/macOS/Windows → verify `availableMemoryMB` matches `free -h` / Activity Monitor / Task Manager
- Profile assignment correct for each machine
- Overhead: <500KB RSS, <0.1% CPU (measure with DevMonitor)
- No oscillation over 10 min test

---

## Phase 1: Critical Fixes + Adaptive Integration (Debug Stage 1)

### 1.1 Fork-Detach Memory Extraction (CRITICAL — fixes 5-min stall)
**File**: `packages/server/src/session/prompt.ts:1262, 1290`
```ts
// BEFORE (blocking):
yield* memory.extractSessionMemory(sessionID, msgs as any).pipe(Effect.catch(...))

// AFTER (fire-and-forget):
Effect.forkDetach(memory.extractSessionMemory(sessionID, msgs as any).pipe(
  Effect.catch((err) => Effect.logError("Session memory extraction failed", { sessionID, error: err }))
))
```

### 1.2 Adaptive GC Scheduler (replaces hardcoded interval)
**File**: `packages/server/src/main.ts` — after server starts
```ts
import { AdaptiveResourceService } from "@diveeoi/db/adaptive"

const adaptive = yield* AdaptiveResourceService
yield* Effect.forkDaemon(Effect.gen(function* () {
  while (true) {
    const { gcIntervalMs } = yield* adaptive.getCurrentTargets()
    yield* Effect.sleep(gcIntervalMs)
    if (typeof Bun !== "undefined" && Bun.gc) {
      Bun.gc(true)
      yield* Effect.logDebug("Adaptive GC", { interval: gcIntervalMs })
    }
  }
}))
```

### 1.3 Binary Ceiling Flags (OOM protection — adaptive runs well under these)
**File**: `scripts/build.ts:192`
```ts
execArgv: [
  `--user-agent=diveeoi/${Script.version}`,
  "--use-system-ca",
  `--memory-limit=1200`,        // RSS ceiling (adaptive targets: 250-700)
  `--max-old-space-size=512`,   // Heap ceiling (adaptive targets: 150-400)
  "--",
],
```

### 1.4 Debug Stage 1: Validate
- **Latency**: First token < 2s (p50), zero 5-min stalls
- **GC**: Logs show adaptive intervals matching current profile
- **Memory**: RSS/heap track targets for current profile
- **Cross-platform**: Binary runs on Windows/macOS/Linux

---

## Phase 2: Adaptive Caches & Bounded Queues (Debug Stage 2)

### 2.1 PtyTicket → Adaptive Capacity/TTL (reads at layer init)
**File**: `packages/db/src/pty/ticket.ts`
```ts
import { makeAdaptiveLayer } from "@diveeoi/db/adaptive/hooks"

export const layer = makeAdaptiveLayer((targets) =>
  Layer.effect(Service, Effect.gen(function* () {
    const cache = yield* Cache.make<string, Scope>({
      capacity: targets.ptyTicketCapacity,
      lookup: noLookup,
      timeToLive: Duration.millis(targets.ptyTicketTTLMs)
    })
    // ... rest unchanged
  }))
)
```

### 2.2 WebSocketTracker → Adaptive Max Connections (reads at creation)
**File**: `packages/server/src/server/routes/instance/httpapi/websocket-tracker.ts`
```ts
import { useAdaptiveTargets } from "@diveeoi/db/adaptive/hooks"

add: (close) => useAdaptiveTargets(({ maxWSConnections }) =>
  Effect.gen(function* () {
    if (closing) return false
    if (sockets.size >= maxWSConnections) return false
    sockets.add(close)
    return true
  })
)
```

### 2.3 SSE Queues → Adaptive Capacity (reads at handler creation)
**Files**: `event.ts:31`, `global.ts:36`
```ts
// event.ts
const queue = yield* useAdaptiveTargets(({ maxSSEQueueSize }) =>
  Queue.bounded<EventV2.Payload>(maxSSEQueueSize)
)

// global.ts — same pattern
```

### 2.4 RunCoordinator → Adaptive Cleanup Interval
**File**: `packages/db/src/session/run-coordinator.ts`
- Map cleanup runs at `targets.gcIntervalMs` (same as GC)

### 2.5 Debug Stage 2: Validate
- Cache hit rates stable across profiles
- No OOM under load on constrained machines
- WebSocket/SSE/PTY connections work at all profiles
- Queue capacities adapt on new connections

---

## Phase 3: Streaming & Concurrency Backpressure (Debug Stage 3)

### 3.1 LLM Stream → Adaptive Buffer (reads at stream creation)
**File**: `packages/db/src/session/runner/llm.ts`
```ts
const stream = yield* useAdaptiveTargets(({ maxLLMStreamBuffer }) =>
  llm.stream(request).pipe(
    Stream.buffer(maxLLMStreamBuffer),
    Stream.throttle({ rate: maxLLMStreamBuffer / 2, burst: 10 })
  )
)
```

### 3.2 Tool Registry → Adaptive Concurrency (reads at tool execution)
**File**: `packages/server/src/tool/registry.ts`
```ts
const sem = yield* useAdaptiveTargets(({ maxToolConcurrency }) =>
  Semaphore.make(maxToolConcurrency)
)
```

### 3.3 Debug Stage 3: Validate
- Streaming smooth at all profiles (no stutter, no memory spikes)
- Tool parallelism scales with cores/profile
- SSE/WS stable under sustained load

---

## Phase 4: Database & Query Optimization (Debug Stage 4)

### 4.1 SQLite PRAGMA → Adaptive (reads at DB layer init)
**File**: `packages/db/src/database/database.ts`
```ts
import { makeAdaptiveLayer } from "@diveeoi/db/adaptive/hooks"

export const layer = makeAdaptiveLayer((targets) =>
  Layer.effect(Service, Effect.gen(function* () {
    const db = yield* makeDatabase
    yield* db.run(`PRAGMA cache_size = -${targets.sqliteCacheMB * 1000}`)
    yield* db.run(`PRAGMA mmap_size = ${targets.sqliteCacheMB * 2 * 1024 * 1024}`)
    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)
    return { db }
  }))
)
```

### 4.2 Query Timeouts (fixed safety net)
```ts
const { dbQueryTimeoutMs } = yield* useAdaptiveTargets(t => t)
const withTimeout = <A, E>(eff: Effect.Effect<A, E>) =>
  Effect.timeoutFail({ duration: Duration.millis(dbQueryTimeoutMs), onTimeout: () => new Error("DB query timeout") })(eff)
```

### 4.3 Drizzle Cache → NoopCache (already the case in this codebase)

### 4.4 Debug Stage 4: Validate
- Query latency < 100ms (p99) at all profiles
- SQLite memory usage tracks `sqliteCacheMB` target
- No query timeouts in normal operation

---

## Phase 5: Session Storage Optimization (ZERO DELETION)

### 5.1 Lazy Loading + Pagination (No Pruning Ever)
**Files**: `packages/server/src/session/session.ts`, `packages/server/src/storage/storage.ts`, `packages/server/src/session/message-v2.ts`
```ts
// messages() now supports cursor-based pagination
messages: (input: { 
  sessionID: SessionID; 
  limit?: number; 
  before?: MessageID; 
  after?: MessageID 
}) => Effect.Effect<SessionV1.WithParts[], NotFound>

// Default limit: adaptive based on profile
const { maxSSEQueueSize } = yield* useAdaptiveTargets(t => t)
// Actually use a session-specific config:
const sessionMsgLimit = yield* useAdaptiveTargets(t => 
  t.profile === "comfortable" ? 200 : t.profile === "balanced" ? 100 : 50
)
```

### 5.2 Transparent Compression for Tool Output
**File**: `packages/server/src/storage/storage.ts`
```ts
// In write/update: if JSON > 10KB, gzip compress
// In read: auto-decompress if gzipped
// Zero data loss — full fidelity on demand
const COMPRESS_THRESHOLD = 10 * 1024 // 10KB

const maybeCompress = (data: string): string => {
  if (data.length < COMPRESS_THRESHOLD) return data
  const compressed = gzipSync(Buffer.from(data))
  return `GZIP:${compressed.toString("base64")}`
}

const maybeDecompress = (data: string): string => {
  if (!data.startsWith("GZIP:")) return data
  return gzipSync(Buffer.from(data.slice(5), "base64")).toString()
}
```

### 5.3 Part Delta Coalescing
**File**: `packages/server/src/session/session.ts` — `updatePartDelta`
```ts
// Debounce rapid deltas (100ms window)
// Store only final state + delta log for replay
```

### 5.4 Debug Stage 5: Validate
- Full history loads in < 500ms (paginated)
- Disk usage grows linearly
- Compression ratio > 60% for tool output
- **Zero message loss** over 30-day stress test

---

## Phase 6: Build & Binary Polish (Debug Stage 6)

### 6.1 Single Binary Default, Multi-Platform Opt-In
**File**: `packages/server/script/build.ts` — already supports `--current` / `--all`

### 6.2 Treeshaking + Minify (Verify)
**File**: `packages/server/script/build.ts:182`
```ts
minify: true, splitting: true, treeshake: true, sourcemap: "none"
```

### 6.3 Cross-Platform Test Matrix
| Platform | Arch | Libc | Status |
|----------|------|------|--------|
| Linux | x64 | glibc | ✅ |
| Linux | x64 | musl | ✅ |
| Linux | arm64 | glibc | ✅ |
| macOS | arm64 | - | ✅ |
| macOS | x64 | - | ✅ |
| Windows | x64 | - | ✅ |
| Windows | arm64 | - | ✅ |

### 6.4 Debug Stage 6: Validate
- Binary size < 80MB compressed
- Cold start < 3s on all platforms
- Feature parity across platforms

---

## Phase 7: Observability & Self-Healing (Debug Stage 7)

### 7.1 Enhanced DevMonitor
**File**: `packages/server/src/dev/monitor.ts`
- Per-endpoint RSS/heap/GC
- Profile change events
- Target vs actual comparison

### 7.2 Self-Healing Guards
**File**: `packages/server/src/main.ts`
```ts
// Emergency GC if actual > target * 1.5
const usage = process.memoryUsage()
const { rssTargetMB, heapTargetMB } = yield* adaptive.getCurrentTargets()

if (usage.rss > rssTargetMB * 1.5 * 1024 * 1024) {
  if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true)
  yield* Effect.logWarning("Emergency GC", { rss: usage.rss, target: rssTargetMB })
}

// Throttle acceptance if critical
if ((yield* adaptive.getCurrentProfile()) === "critical") {
  // Add backpressure to incoming requests
}
```

### 7.3 Debug Stage 7: Validate
- 24h soak test at each profile
- Zero OOM kills
- Graceful degradation under sustained load
- Metrics exportable

---

## Success Criteria (Adaptive)

| Metric | Comfortable | Balanced | Constrained | Critical |
|--------|-------------|----------|-------------|----------|
| **RSS Target** | ≤ 700MB | ≤ 500MB | ≤ 350MB | ≤ 250MB |
| **Heap Target** | ≤ 400MB | ≤ 300MB | ≤ 200MB | ≤ 150MB |
| **First Token (p50)** | < 1.5s | < 2s | < 3s | < 5s |
| **GC Interval** | 60s | 30s | 15s | 8s |
| **Tool Concurrency** | 8 | 4-6 | 2-3 | 1-2 |
| **Stability** | Zero OOM | Zero OOM | Zero OOM | Zero OOM |

**Universal**: No session deletion ever. Full history always available (lazy-loaded).

---

## File Summary

### New (Adaptive Core):
1. `packages/db/src/adaptive/detect.ts`
2. `packages/db/src/adaptive/profiles.ts`
3. `packages/db/src/adaptive/service.ts`
4. `packages/db/src/adaptive/hooks.ts`
5. `packages/db/src/adaptive/index.ts`

### Modified (Integration):
1. `packages/server/src/session/prompt.ts` — fork-detach extraction (CRITICAL)
2. `packages/server/src/main.ts` — adaptive GC + self-healing (CRITICAL)
3. `scripts/build.ts` — ceiling flags (CRITICAL)
4. `packages/server/src/effect/app-runtime.ts` — add AdaptiveResourceService layer
5. `packages/db/src/pty/ticket.ts` — adaptive layer
6. `packages/server/src/server/routes/instance/httpapi/websocket-tracker.ts` — adaptive max
7. `packages/server/src/server/routes/instance/httpapi/handlers/event.ts` — adaptive SSE queue
8. `packages/server/src/server/routes/instance/httpapi/handlers/global.ts` — adaptive SSE queue
9. `packages/db/src/session/runner/llm.ts` — adaptive stream buffer
10. `packages/server/src/tool/registry.ts` — adaptive tool concurrency
11. `packages/db/src/database/database.ts` — adaptive SQLite PRAGMA
12. `packages/server/src/session/session.ts` — lazy pagination
13. `packages/server/src/storage/storage.ts` — transparent compression
14. `packages/server/src/session/message-v2.ts` — pagination support
15. `packages/server/script/build.ts` — verify treeshake
16. `packages/server/src/dev/monitor.ts` — adaptive metrics

---

## Rollout: Phase → Debug → Phase → Debug

```
Phase 0 (Adaptive Core) → Debug Stage 0 (Detection accurate, overhead minimal)
    ↓
Phase 1 (Stall Fix + Adaptive GC + Binary Ceilings) → Debug Stage 1 (No stalls, GC adaptive)
    ↓
Phase 2 (Adaptive Caches/Queues) → Debug Stage 2 (Resources scale correctly)
    ↓
Phase 3 (Adaptive Streaming/Concurrency) → Debug Stage 3 (Smooth at all profiles)
    ↓
Phase 4 (Adaptive DB) → Debug Stage 4 (Queries fast, memory tracked)
    ↓
Phase 5 (Storage Opt, Zero Deletion) → Debug Stage 5 (History fast, compressed)
    ↓
Phase 6 (Build Polish) → Debug Stage 6 (Binaries work everywhere)
    ↓
Phase 7 (Observability/Self-Healing) → Debug Stage 7 (24h soak all profiles)
```

Each Debug Stage = run validation on all 3 platforms, fix regressions, then proceed.

---

**Owner**: Gelo-4  
**Review**: Mr.Abdou  
**Approach**: One phase at a time, validate everywhere, then continue. Live reconfiguration via Ref + periodic updater, components read at decision points.