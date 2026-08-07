import { AsyncLocalStorage } from "node:async_hooks"
import type { Aggregates, GaugeStats, NodeStats, ProcessMem, ScopeEvent } from "./types"

const MB = 1048576

const config: { enabled: boolean; sampleRate: number } = {
  enabled: process.env["DIVEEOI_PROFILER"] === "1",
  sampleRate: parseRate(process.env["DIVEEOI_PROFILER_SAMPLE_RATE"], 1),
}

/** module.file.function — or module.file.class.function for 4+ segments. */
const registry = new Map<string, NodeStats>()
const activeCounters = new Map<string, number>()
const callCounts = new Map<string, number>()
const states = new Map<string, GaugeStats>()
const scopeListeners: Array<(key: string, event: ScopeEvent) => void> = []

const WRAPPED = Symbol.for("diveeoi.profiler.wrapped")

type AnyFn = (...args: never[]) => unknown

interface ScopeNode {
  readonly key: string
  readonly parent: ScopeNode | null
}

/**
 * Call-tree tracking. beginScope enterWith()s the current node so the
 * next scope created synchronously (or via a chained .then callback)
 * resolves its caller from the store.
 */
const als = new AsyncLocalStorage<ScopeNode | null>()

interface ScopeBegin {
  readonly key: string
  readonly t0: bigint
  readonly sample: boolean
  readonly mem0: ProcessMem | null
  readonly caller: string | null
  readonly node: ScopeNode
}

export const isEnabled = (): boolean => config.enabled

/** Override runtime configuration. Test-only — env vars remain the prod path. */
export function _configure(partial: { enabled?: boolean; sampleRate?: number }): void {
  if (partial.enabled !== undefined) config.enabled = partial.enabled
  if (partial.sampleRate !== undefined) config.sampleRate = partial.sampleRate
}

export function wrap<T extends AnyFn>(key: string, fn: T): T {
  if (!config.enabled) return fn
  if (typeof (fn as AnyFn & { [WRAPPED]?: boolean })[WRAPPED] === "boolean") return fn

  const wrapped = function (this: unknown, ...args: never[]) {
    const begin = _beginScope(key)
    try {
      const result = fn.apply(this, args)
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        return (result as PromiseLike<unknown>).then(
          (value) => {
            _endScope(begin, false)
            return value
          },
          (reason) => {
            _endScope(begin, true)
            throw reason
          },
        )
      }
      _endScope(begin, false)
      return result
    } catch (err) {
      _endScope(begin, true)
      throw err
    }
  }

  Object.defineProperty(wrapped, WRAPPED, { value: true, enumerable: false })
  Object.defineProperty(wrapped, "name", { value: fn.name ?? key, configurable: true })
  return wrapped as unknown as T
}

/** Wrap every function property of an object with `key.<prop>` scope keys. */
export function instrument<T extends Record<string, unknown>>(key: string, mod: T): T {
  if (!config.enabled) return mod
  const out: Record<string, unknown> = {}
  for (const [prop, value] of Object.entries(mod)) {
    if (typeof value === "function" && !value.constructor.name.startsWith("GeneratorFunction")) {
      out[prop] = wrap(`${key}.${prop}`, value as AnyFn)
    } else {
      out[prop] = value
    }
  }
  return out as T
}

export function measure<T>(key: string, fn: () => T): T {
  if (!config.enabled) return fn()
  const begin = _beginScope(key)
  try {
    const value = fn()
    _endScope(begin, false)
    return value
  } catch (err) {
    _endScope(begin, true)
    throw err
  }
}

export function measureAsync<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!config.enabled) return fn()
  const begin = _beginScope(key)
  try {
    return fn().then(
      (value) => {
        _endScope(begin, false)
        return value
      },
      (reason) => {
        _endScope(begin, true)
        throw reason
      },
    )
  } catch (err) {
    _endScope(begin, true)
    return Promise.reject(err)
  }
}

/** Manual scope: const s = scope("key"); ...; s.end(). */
export function scope(key: string): { end: (error?: boolean) => void } {
  const begin = _beginScope(key)
  let ended = false
  return {
    end: (error = false) => {
      if (!ended) {
        ended = true
        _endScope(begin, error)
      }
    },
  }
}

/** Record an absolute gauge value (e.g. active requests, queue depth). */
export function gauge(key: string, value: number): void {
  if (!config.enabled) return
  const prev = states.get(key)
  if (prev) {
    prev.current = value
    prev.min = Math.min(prev.min, value)
    prev.max = Math.max(prev.max, value)
    prev.sum += value
    prev.count += 1
  } else {
    states.set(key, { current: value, min: value, max: value, sum: value, count: 1 })
  }
}

/** Adjust a gauge by a delta (e.g. +1 / -1). `sum` accumulates deltas. */
export function gaugeDelta(key: string, delta: number): void {
  if (!config.enabled) return
  const prev = states.get(key)
  const value = (prev?.current ?? 0) + delta
  if (prev) {
    prev.current = value
    prev.min = Math.min(prev.min, value)
    prev.max = Math.max(prev.max, value)
    prev.sum += delta
    prev.count += 1
  } else {
    states.set(key, { current: value, min: value, max: value, sum: delta, count: 1 })
  }
}

interface RawMem {
  rss: number
  heapUsed: number
  external: number
}

function readRawMem(): RawMem | null {
  // Access Bun via globalThis so tsgo does not need bun-types installed.
  const bunNs = (globalThis as { Bun?: { memoryUsage?: () => RawMem } }).Bun
  if (typeof bunNs?.memoryUsage === "function") return bunNs.memoryUsage()
  if (typeof process !== "undefined" && typeof process.memoryUsage === "function") {
    const { rss, heapUsed, external } = process.memoryUsage()
    return { rss, heapUsed, external }
  }
  return null
}

export function processMem(): ProcessMem {
  const raw = readRawMem()
  if (!raw) return { rssMB: 0, heapUsedMB: 0, externalMB: 0 }
  return { rssMB: raw.rss / MB, heapUsedMB: raw.heapUsed / MB, externalMB: raw.external / MB }
}

export function _beginScope(key: string): ScopeBegin {
  const parent = als.getStore() ?? null
  const node: ScopeNode = { key, parent }
  const count = (callCounts.get(key) ?? 0) + 1
  callCounts.set(key, count)
  const sample = Math.floor(count * config.sampleRate) > Math.floor((count - 1) * config.sampleRate)
  const current = (activeCounters.get(key) ?? 0) + 1
  activeCounters.set(key, current)
  const begin: ScopeBegin = {
    key,
    t0: process.hrtime.bigint(),
    sample,
    mem0: sample ? processMem() : null,
    caller: parent?.key ?? null,
    node,
  }
  const stats = registry.get(key)
  if (stats && current > stats.concurrentMax) stats.concurrentMax = current
  als.enterWith(node)
  return begin
}

export function _endScope(begin: ScopeBegin, error: boolean): ScopeEvent | null {
  const remaining = Math.max(0, (activeCounters.get(begin.key) ?? 1) - 1)
  activeCounters.set(begin.key, remaining)
  als.enterWith(begin.node.parent)
  const durMs = Number(process.hrtime.bigint() - begin.t0) / 1e6
  const event: ScopeEvent = { durMs, error: error || undefined, caller: begin.caller ?? undefined }
  if (begin.sample && begin.mem0) {
    const delta = processMem()
    event.heapDeltaMB = round2(delta.heapUsedMB - begin.mem0.heapUsedMB)
    event.rssDeltaMB = round2(delta.rssMB - begin.mem0.rssMB)
  }
  accumulate(begin.key, event, remaining + 1)
  if (begin.sample) reportScope(begin.key, event)
  return event
}

export function snapshot(): Aggregates {
  const functions: NodeStats[] = []
  const files: Record<string, NodeStats> = {}
  const modules: Record<string, NodeStats> = {}
  const classes: Record<string, NodeStats> = {}
  for (const stats of registry.values()) {
    functions.push(stats)
    mergeInto(files, segment(stats.key, 1) ?? stats.key, stats)
    mergeInto(modules, segment(stats.key, 0) ?? stats.key, stats)
    const cls = classSegment(stats.key)
    if (cls) mergeInto(classes, cls, stats)
  }
  functions.sort((a, b) => b.totalMs - a.totalMs)
  const total: NodeStats = {
    key: "total",
    name: "total",
    calls: 0,
    errors: 0,
    totalMs: 0,
    minMs: 0,
    maxMs: 0,
    heapDeltaMB: 0,
    heapDeltaMaxMB: 0,
    rssDeltaMB: 0,
    concurrentMax: 0,
  }
  for (const stats of functions) {
    total.calls += stats.calls
    total.errors += stats.errors
    total.totalMs += stats.totalMs
    total.heapDeltaMB += stats.heapDeltaMB
    total.rssDeltaMB += stats.rssDeltaMB
    total.concurrentMax = Math.max(total.concurrentMax, stats.concurrentMax)
  }
  const active: Record<string, number> = {}
  for (const [key, count] of activeCounters) active[key] = count
  const stateSnapshot: Record<string, GaugeStats> = {}
  for (const [key, stats] of states) stateSnapshot[key] = { ...stats }
  return { functions, files, modules, classes, states: stateSnapshot, active, total }
}

/** Reset all collected state. Test-only. */
export function _reset(): void {
  registry.clear()
  activeCounters.clear()
  callCounts.clear()
  states.clear()
  als.enterWith(null)
}

/** Subscribe to completed sampled scopes. Test-only. */
export function _onScope(listener: (key: string, event: ScopeEvent) => void): void {
  scopeListeners.push(listener)
}

function accumulate(key: string, event: ScopeEvent, peak: number): void {
  let stats = registry.get(key)
  if (!stats) {
    stats = {
      key,
      name: lastSegment(key),
      calls: 0,
      errors: 0,
      totalMs: 0,
      minMs: 0,
      maxMs: 0,
      heapDeltaMB: 0,
      heapDeltaMaxMB: 0,
      rssDeltaMB: 0,
      concurrentMax: 0,
    }
    registry.set(key, stats)
  }
  stats.calls += 1
  if (event.error) stats.errors += 1
  stats.totalMs += event.durMs
  if (stats.minMs === 0 || event.durMs < stats.minMs) stats.minMs = event.durMs
  if (event.durMs > stats.maxMs) stats.maxMs = event.durMs
  stats.concurrentMax = Math.max(stats.concurrentMax, peak)
  if (event.heapDeltaMB !== undefined) {
    stats.heapDeltaMB += event.heapDeltaMB
    stats.heapDeltaMaxMB = Math.max(stats.heapDeltaMaxMB, event.heapDeltaMB)
  }
  if (event.rssDeltaMB !== undefined) stats.rssDeltaMB += event.rssDeltaMB
}

function mergeInto(target: Record<string, NodeStats>, key: string, stats: NodeStats): void {
  const existing = target[key]
  if (!existing) {
    target[key] = { ...stats, key, name: lastSegment(key) }
    return
  }
  existing.calls += stats.calls
  existing.errors += stats.errors
  existing.totalMs += stats.totalMs
  existing.minMs = Math.min(existing.minMs, stats.minMs)
  existing.maxMs = Math.max(existing.maxMs, stats.maxMs)
  existing.heapDeltaMB += stats.heapDeltaMB
  existing.heapDeltaMaxMB = Math.max(existing.heapDeltaMaxMB, stats.heapDeltaMaxMB)
  existing.rssDeltaMB += stats.rssDeltaMB
  existing.concurrentMax = Math.max(existing.concurrentMax, stats.concurrentMax)
}

function reportScope(key: string, event: ScopeEvent): void {
  for (const listener of scopeListeners) listener(key, event)
}

function parseRate(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback
}

function segment(key: string, index: number): string | null {
  const parts = key.split(".")
  return parts[index] ?? null
}

function classSegment(key: string): string | null {
  const parts = key.split(".")
  return parts.length >= 4 ? (parts[2] ?? null) : null
}

function lastSegment(key: string): string {
  const parts = key.split(".")
  return parts[parts.length - 1] ?? key
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
