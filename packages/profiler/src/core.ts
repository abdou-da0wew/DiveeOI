import type { Aggregates, NodeStats, ProcessMem, ScopeEvent } from "./types"

const parseRate = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const enabled = process.env["DIVEEOI_PROFILER"] === "1"
const sampleRate = parseRate(process.env["DIVEEOI_PROFILER_SAMPLE_RATE"], 1)
const MB = 1048576

const registry = new Map<string, NodeStats>()
const activeCounters = new Map<string, number>()
const callCounts = new Map<string, number>()
const scopeListeners: Array<(key: string, event: ScopeEvent) => void> = []
const snapshotListeners: Array<(agg: Aggregates, mem: ProcessMem) => void> = []
const noopScope = { start(): void {}, end(): void {} }
const WRAPPED = Symbol.for("diveeoi.profiler.wrapped")

type AnyFn = (...args: never[]) => unknown

interface ScopeBegin {
  key: string
  t0: bigint
  sample: boolean
  mem0: ProcessMem | null
}

export const isEnabled = (): boolean => enabled

export const wrap = <T extends AnyFn>(key: string, fn: T): T => {
  if (!enabled) return fn
  if ((fn as unknown as Record<symbol, unknown>)[WRAPPED]) return fn
  const target = fn as unknown as (...args: unknown[]) => unknown
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const begin = beginScope(key)
    try {
      const result = target.apply(this, args)
      if (isThenable(result)) {
        result.then(
          () => {
            endScope(begin, false)
          },
          () => {
            endScope(begin, true)
          },
        )
        return result
      }
      endScope(begin, false)
      return result
    } catch (error) {
      endScope(begin, true)
      throw error
    }
  } as unknown as T
  ;(wrapped as unknown as Record<symbol, unknown>)[WRAPPED] = true
  return wrapped
}

export const instrument = <T extends object>(key: string, mod: T): T => {
  if (!enabled) return mod
  for (const prop of Object.keys(mod)) {
    const value = (mod as Record<string, unknown>)[prop]
    if (typeof value !== "function") continue
    if (isGenerator(value as (...args: unknown[]) => unknown)) continue
    if ((value as unknown as Record<symbol, unknown>)[WRAPPED]) continue
    ;(mod as Record<string, unknown>)[prop] = wrap(`${key}.${prop}`, value as AnyFn)
  }
  return mod
}

export const measure = <T>(key: string, fn: () => T): T => {
  if (!enabled) return fn()
  const begin = beginScope(key)
  try {
    const result = fn()
    endScope(begin, false)
    return result
  } catch (error) {
    endScope(begin, true)
    throw error
  }
}

export const measureAsync = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  if (!enabled) return fn()
  const begin = beginScope(key)
  try {
    const result = fn()
    result.then(
      () => {
        endScope(begin, false)
      },
      () => {
        endScope(begin, true)
      },
    )
    return result
  } catch (error) {
    endScope(begin, true)
    throw error
  }
}

export const scope = (key: string): { start(): void; end(): void } => {
  if (!enabled) return noopScope
  let begin: ScopeBegin | null = null
  return {
    start(): void {
      begin = beginScope(key)
    },
    end(): void {
      if (begin === null) return
      endScope(begin, false)
      begin = null
    },
  }
}

export const record = (key: string, event: ScopeEvent): void => {
  if (!enabled) return
  accumulate(ensureEntry(key), event)
  reportScope(key, event)
}

export const snapshot = (): Aggregates => {
  const functions = [...registry.values()].map((s) => ({ ...s }))
  functions.sort((a, b) => b.totalMs - a.totalMs)
  const files = new Map<string, NodeStats>()
  const modules = new Map<string, NodeStats>()
  for (const s of registry.values()) {
    const parts = s.key.split(".")
    if (parts.length > 1 && parts[1] !== undefined) mergeInto(files, parts[1], s)
    if (parts[0] !== undefined) mergeInto(modules, parts[0], s)
  }
  const total = newStats("total")
  for (const s of registry.values()) {
    total.calls += s.calls
    total.errors += s.errors
    total.totalMs += s.totalMs
    if (s.minMs < total.minMs) total.minMs = s.minMs
    if (s.maxMs > total.maxMs) total.maxMs = s.maxMs
    total.heapDeltaMB += s.heapDeltaMB
    total.heapDeltaMaxMB += s.heapDeltaMaxMB
    total.rssDeltaMB += s.rssDeltaMB
    if (s.concurrentMax > total.concurrentMax) total.concurrentMax = s.concurrentMax
  }
  return {
    functions,
    files: Object.fromEntries(files),
    modules: Object.fromEntries(modules),
    total,
  }
}

export const processMem = (): ProcessMem => {
  try {
    if (typeof Bun !== "undefined" && typeof Bun.memoryUsage === "function") {
      const mem = Bun.memoryUsage()
      return {
        rssMB: mem.rss / MB,
        heapUsedMB: mem.heapUsed / MB,
        externalMB: mem.external / MB,
      }
    }
    const mem = process.memoryUsage()
    return {
      rssMB: mem.rss / MB,
      heapUsedMB: mem.heapUsed / MB,
      externalMB: mem.external / MB,
    }
  } catch {
    return { rssMB: 0, heapUsedMB: 0, externalMB: 0 }
  }
}

export const onSnapshot = (cb: (agg: Aggregates, mem: ProcessMem) => void): (() => void) => {
  snapshotListeners.push(cb)
  return () => {
    const index = snapshotListeners.indexOf(cb)
    if (index >= 0) snapshotListeners.splice(index, 1)
  }
}

export const dispatchSnapshot = (): void => {
  if (snapshotListeners.length === 0) return
  const agg = snapshot()
  const mem = processMem()
  for (const cb of snapshotListeners) {
    try {
      cb(agg, mem)
    } catch {
      // swallow listener failures
    }
  }
}

export const _onScope = (cb: (key: string, event: ScopeEvent) => void): (() => void) => {
  scopeListeners.push(cb)
  return () => {
    const index = scopeListeners.indexOf(cb)
    if (index >= 0) scopeListeners.splice(index, 1)
  }
}

export const _beginScope = (key: string): ScopeBegin => beginScope(key)

export const _endScope = (begin: ScopeBegin, error: boolean): void => endScope(begin, error)

const beginScope = (key: string): ScopeBegin => {
  const count = callCounts.get(key) ?? 0
  callCounts.set(key, count + 1)
  activeCounters.set(key, (activeCounters.get(key) ?? 0) + 1)
  const sample = count % sampleRate === 0
  return {
    key,
    t0: process.hrtime.bigint(),
    sample,
    mem0: sample ? processMem() : null,
  }
}

const endScope = (begin: ScopeBegin, error: boolean): void => {
  const durMs = Number(process.hrtime.bigint() - begin.t0) / 1e6
  const event: ScopeEvent = { durMs, error: error ? true : undefined }
  const activeNow = (activeCounters.get(begin.key) ?? 1) - 1
  if (activeNow <= 0) activeCounters.delete(begin.key)
  else activeCounters.set(begin.key, activeNow)
  const entry = ensureEntry(begin.key)
  if (activeNow > entry.concurrentMax) entry.concurrentMax = activeNow
  if (begin.sample && begin.mem0 !== null) {
    const mem1 = processMem()
    event.heapDeltaMB = mem1.heapUsedMB - begin.mem0.heapUsedMB
    event.rssDeltaMB = mem1.rssMB - begin.mem0.rssMB
  }
  accumulate(entry, event)
  reportScope(begin.key, event)
}

const ensureEntry = (key: string): NodeStats => {
  let entry = registry.get(key)
  if (entry === undefined) {
    entry = newStats(key)
    registry.set(key, entry)
  }
  return entry
}

const accumulate = (entry: NodeStats, event: ScopeEvent): void => {
  entry.calls++
  if (event.error) entry.errors++
  entry.totalMs += event.durMs
  if (event.durMs < entry.minMs) entry.minMs = event.durMs
  if (event.durMs > entry.maxMs) entry.maxMs = event.durMs
  if (event.heapDeltaMB !== undefined) {
    entry.heapDeltaMB += event.heapDeltaMB
    if (event.heapDeltaMB > entry.heapDeltaMaxMB) entry.heapDeltaMaxMB = event.heapDeltaMB
  }
  if (event.rssDeltaMB !== undefined) entry.rssDeltaMB += event.rssDeltaMB
}

const newStats = (key: string): NodeStats => {
  const parts = key.split(".")
  return {
    key,
    name: parts[parts.length - 1] ?? key,
    calls: 0,
    errors: 0,
    totalMs: 0,
    minMs: Number.POSITIVE_INFINITY,
    maxMs: 0,
    heapDeltaMB: 0,
    heapDeltaMaxMB: 0,
    rssDeltaMB: 0,
    concurrentMax: 0,
  }
}

const mergeInto = (acc: Map<string, NodeStats>, name: string, s: NodeStats): void => {
  let target = acc.get(name)
  if (target === undefined) {
    target = newStats(name)
    acc.set(name, target)
  }
  target.calls += s.calls
  target.errors += s.errors
  target.totalMs += s.totalMs
  if (s.minMs < target.minMs) target.minMs = s.minMs
  if (s.maxMs > target.maxMs) target.maxMs = s.maxMs
  target.heapDeltaMB += s.heapDeltaMB
  target.heapDeltaMaxMB += s.heapDeltaMaxMB
  target.rssDeltaMB += s.rssDeltaMB
  if (s.concurrentMax > target.concurrentMax) target.concurrentMax = s.concurrentMax
}

const reportScope = (key: string, event: ScopeEvent): void => {
  if (scopeListeners.length === 0) return
  for (const cb of scopeListeners) {
    try {
      cb(key, event)
    } catch {
      // swallow listener failures
    }
  }
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  typeof (value as { then?: unknown }).then === "function"

const isGenerator = (fn: (...args: unknown[]) => unknown): boolean => {
  const name = fn.constructor?.name
  return name === "GeneratorFunction" || name === "AsyncGeneratorFunction"
}
