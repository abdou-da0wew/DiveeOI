# @diveeoi/profiler — Design Contract

Detailed, lightweight resource profiler for DiveeOI. Tracks timing and memory
for every instrumented function/file/module. Costs nothing when disabled.

## Hard Rules

1. **Env-flag gated.** When `DIVEEOI_PROFILER` is not set, every public entry
   point is a no-op:
   - `wrap(fn)` returns `fn` unchanged (identity — zero call overhead).
   - `instrument(mod)` returns `mod` unchanged (identity).
   - `measure(fn)` calls `fn` directly.
   - `measureAsync(fn)` returns `fn()` directly.
   - `effect(program)` returns `program` unchanged.
   - `scope()` returns a shared no-op scope.
   - `record()` / `snapshot()` / `onSnapshot()` do nothing.
   Only the one-time boolean check at module init happens. No allocation.
2. **No dependencies except `effect` (catalog).** Zero-dep core. Must be
   importable from every package without cycles.
3. **When enabled, overhead stays small**: O(1) per call, no string concat in
   hot path (reuse key strings), buffered async writes (never sync file I/O in
   the call path).
4. **Never throw.** A failure inside the profiler (e.g. write error) is caught
   and swallowed. Profiling must never break the app.
5. **No emojis, no Arabic** in code or comments. English only.

## Env Flags

| Flag | Meaning | Default |
|---|---|---|
| `DIVEEOI_PROFILER=1` | Enable profiler | disabled |
| `DIVEEOI_PROFILER_OUTPUT` | JSONL output path | `.divee/profiler.jsonl` |
| `DIVEEOI_PROFILER_SNAPSHOT_MS` | Full-snapshot interval | `60000` |
| `DIVEEOI_PROFILER_FLUSH_MS` | Writer flush interval | `5000` |
| `DIVEEOI_PROFILER_MIN_MS` | Only emit `scope_done` lines with durMs >= this | `1` |
| `DIVEEOI_PROFILER_SAMPLE_RATE` | Memory sampling: sample every N calls (1 = all) | `1` |

`.divee/` is gitignored runtime data — the default output lives there.

## Package Layout

```
packages/profiler/
├── DESIGN.md            (this file)
├── package.json         @diveeoi/profiler, private, type module
├── tsconfig.json        mirror packages/memory/tsconfig.json, but ADD
│                        "rewriteRelativeImportExtensions": true (fixes the
│                        allowImportingTsExtensions + noEmit:false conflict
│                        that currently trips memory's tsconfig)
└── src/
    ├── types.ts         shared types (no runtime code)
    ├── core.ts          flag parse, registry, wrap/instrument/measure/scope/record/snapshot/onSnapshot, processMem
    ├── effect.ts        Effect wrapper (only file importing `effect`)
    ├── writer.ts        buffered JSONL writer + snapshot interval + exit flush
    └── index.ts         flat re-exports + auto-start writer when enabled
```

`package.json`:
- `"exports"`: `".": "./src/index.ts"`, `"./core": "./src/core.ts"`, `"./effect": "./src/effect.ts"`, `"./types": "./src/types.ts"`
- `"scripts"`: `"test": "bun test"`, `"typecheck": "tsgo --noEmit"`
- `"devDependencies"`: `"@tsconfig/bun": "catalog:"`, `"@types/bun": "catalog:"`
- `"dependencies"`: `"effect": "catalog:"`
- Mirror the `$schema/version/license/private` fields from `packages/memory/package.json`.

## Types (`src/types.ts`)

```ts
export interface ProcessMem {
  rssMB: number
  heapUsedMB: number
  externalMB: number
}

export interface NodeStats {
  key: string        // "module.file.function" — full path
  name: string       // last segment
  calls: number
  errors: number
  totalMs: number
  minMs: number
  maxMs: number
  heapDeltaMB: number      // cumulative heapUsed delta across calls
  heapDeltaMaxMB: number
  rssDeltaMB: number       // cumulative rss delta across calls
  concurrentMax: number
}

export interface Aggregates {
  functions: NodeStats[]                  // leaf stats, sorted by totalMs desc
  files: Record<string, NodeStats>        // aggregated by middle segment
  modules: Record<string, NodeStats>      // aggregated by first segment
  total: NodeStats                        // all keys combined
}

export interface ScopeEvent {
  durMs: number
  heapDeltaMB?: number
  rssDeltaMB?: number
  error?: boolean
}
```

Aggregation: key format is `module.file.function`, split on `.`. A key may omit
segments (`module.file`, `module` alone is allowed). `files` sums all stats
whose key contains `file` at position 1; `modules` sums at position 0.
Functions with no file/module segments are counted in their partial bucket.

## Core API (`src/core.ts`)

```ts
export const isEnabled: () => boolean

export const wrap: <T extends (...args: never[]) => unknown>(key: string, fn: T) => T
// Disabled: returns fn. Enabled: returns wrapper preserving `this`, args, result.
// If result is a Promise (thenable), hook .then to close the scope on settle
// (counts errors via rejected promise), tracks concurrentMax by active counter.
// Guard with a symbol (e.g. Symbol.for("diveeoi.profiler.wrapped")) — never
// double-wrap.

export const instrument: <T extends object>(key: string, mod: T) => T
// Disabled: returns mod. Enabled: for each OWN enumerable property of mod that
// is a plain function (skip generator/async-generator functions and already
// wrapped), replace mod[prop] with wrap(`${key}.${prop}`, fn) IN PLACE.
// Object identity is preserved. Class methods (prototype) are untouched —
// safe. Returns mod.

export const measure: <T>(key: string, fn: () => T) => T
export const measureAsync: <T>(key: string, fn: () => Promise<T>) => Promise<T>
export const scope: (key: string) => { start(): void; end(): void }
// Disabled: shared no-op object.

export const record: (key: string, event: ScopeEvent) => void
// Manual event (e.g. "memory.consolidation.run"): calls++ and accumulate.

export const snapshot: () => Aggregates
export const processMem: () => ProcessMem
// Bun: try Bun.memoryUsage() (bytes), fall back to process.memoryUsage().
// Wrap in try/catch; on failure return zeros.

export const onSnapshot: (cb: (agg: Aggregates, mem: ProcessMem) => void) => () => void
// Register snapshot listener; returns unsubscribe. Used by DevMonitor.

export const dispatchSnapshot: () => void
// Internal: writer calls this each interval; core notifies listeners.
```

Memory sampling: only when `callCount % sampleRate === 0` OR duration exceeded
`DIVEEOI_PROFILER_MIN_MS`, sample `processMem()` at scope entry and exit and
accumulate deltas (heap delta can be negative — accumulate as-is). To stay
cheap, `processMem()` is called at most twice per sampled scope.

Errors: wrap/measureAsync must rethrow/reject exactly as the original. Sync
wrappers rethrow after recording. The wrapper counts `errors` on throw/reject.

## Effect Wrapper (`src/effect.ts`)

```ts
export const effect: <A, E, R>(key: string, program: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
```
- Disabled: returns `program` unchanged.
- Enabled: `Effect.acquireUseRelease(Effect.sync(() => beginScope(key)), () => program, (s, exit) => Effect.sync(() => endScope(s, Exit.isFailure(exit))))` — preserves the original failure (never converts it), counts errors via `Exit.isFailure`.
- Import `{ Effect, Exit }` from `effect`. Do NOT wrap the whole program with `Effect.gen` — acquireUseRelease keeps semantics intact.
- `effect` must not break uninterruptibility: use `Effect.acquireUseRelease` (it handles interrupt properly — release runs on interruption).

## Writer (`src/writer.ts`)

- Buffered write: accumulate lines in a `string[]`, flush via `fs/promises.appendFile` (Bun.write overwrites — never use it for appends) every `DIVEEOI_PROFILER_FLUSH_MS` (async, not awaited in hot path — fire and forget with `.catch(() => {})`).
- Line kinds:
  - `{"kind":"scope_done","t":<ms epoch>,"key":"...","durMs":n,"heapDeltaMB":n,"rssDeltaMB":n,"err":bool}` — emitted for every completed scope when `durMs >= DIVEEOI_PROFILER_MIN_MS` OR error. (Aggregation already counts every call regardless of emission.)
  - `{"kind":"snapshot","t":...,"mem":{"rssMB":..,"heapUsedMB":..,"externalMB":..},"functions":[...top 200 by totalMs...],"modules":{...},"files":{...}}` — every `DIVEEOI_PROFILER_SNAPSHOT_MS`, via `snapshot()` + `processMem()`. Top 200 functions only, to bound line size.
  - `{"kind":"proc","t":...,"mem":{...}}` — process memory line every flush interval (cheap leak trend).
- Flush on `exit`, `SIGINT`, `SIGTERM` (register listeners; remove on flush).
- All writer errors swallowed (rule 4).
- `export const start: () => void` — starts interval + listeners. Idempotent.
- After `start`, call `dispatchSnapshot()` on every snapshot tick so DevMonitor listeners fire.

## index.ts

```ts
export * from "./types"
export * from "./core"
export * from "./effect"
// (writer is internal, not re-exported)
import { isEnabled } from "./core"
import { start } from "./writer"
if (isEnabled()) start()
```

## Integration Rules (for instrumentation agents)

1. Add `"@diveeoi/profiler": "workspace:*"` to the consuming package's
   `dependencies` in `package.json`.
2. Import style: `import { instrument, wrap, effect as profiled, measureAsync } from "@diveeoi/profiler"`.
3. Wrap every **exported function** of every file, keyed `module.file.function`:
   - Object exports (export const obj = {...}): `export const x = instrument("module.file", { ... })` or instrument in place after definition.
   - Standalone functions: prefer defining `const fn = (...)` then `export const fn = wrap("module.file.fn", fnImpl)`; if that is invasive, wrap the export expression: `export const fn = wrap("module.file.fn", (...args) => ...)`.
4. Class methods: wrap at the call boundary instead (public instance method wrappers) or wrap the class-returning factory — do NOT mutate prototypes unless done once and carefully.
5. Effect programs: `profiled("module.file.op", program)` at the boundary of significant operations (session processing, memory ops, llm calls, tool execution, db queries, server routes).
6. Manual `record` for non-function events: cache evictions, queue drops, compaction runs, gzip runs, db pragma changes, adaptive profile switches.
7. DO NOT wrap: trivial getters, pure constant accessors, functions called in tight loops (tokenizers, encoders, serializers) unless the loop is coarse, functions compared by reference or used as Map/Set keys (identity matters), already-wrapped functions, generator functions, async generators, Effect `Layer` values, `Context.Service` objects, schema values. When in doubt, instrument at the module export boundary instead of the hot loop.
8. Never wrap recursively — `wrap` of `wrap` is guarded by the symbol, but do not create self-referential keys.
9. Every instrumented file gets a `module` segment = package name (`db`, `server`, `memory`, `llm`, ...), `file` = file name sans extension, `function` = export name.
10. Verification: after edits, re-read the file to confirm import + wrap placement, balanced parens, no syntax errors. **NEVER run typecheck, tsgo, tsc, bun build, or any build command.** The user runs `bun run typecheck` himself.
