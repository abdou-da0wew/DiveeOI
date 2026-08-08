import { mkdirSync, openSync, writeSync, closeSync } from "node:fs"
import { dirname } from "node:path"
import { _onScope, isEnabled, processMem, snapshot } from "./core"
import type { ScopeEvent } from "./types"

const DEFAULT_OUTPUT = ".divee/profiler.jsonl"

const outputPath = process.env["DIVEEOI_PROFILER_OUTPUT"] ?? DEFAULT_OUTPUT
const flushMs = parsePositiveMs(process.env["DIVEEOI_PROFILER_FLUSH_MS"], 5000)
const snapshotMs = parsePositiveMs(process.env["DIVEEOI_PROFILER_SNAPSHOT_MS"], 60000)
const minMs = parseMs(process.env["DIVEEOI_PROFILER_MIN_MS"], 1)
const topFunctions = parseNum(process.env["DIVEEOI_PROFILER_TOP_FUNCTIONS"], 200)

let started = false
let fd: number | null = null
let buffer: string[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let snapshotTimer: ReturnType<typeof setInterval> | null = null
const cleanup: Array<() => void> = []

_onScope((key, event) => {
  if (!started) return
  if (event.durMs < minMs) return
  writeLine({
    kind: "scope_done",
    t: Date.now(),
    key,
    durMs: round2(event.durMs),
    caller: event.caller,
    err: event.error,
    heapDeltaMB: event.heapDeltaMB,
    rssDeltaMB: event.rssDeltaMB,
  })
})

export function start(): void {
  if (started) return
  if (!isEnabled()) return
  started = true
  mkdirSync(dirname(outputPath), { recursive: true })
  fd = openSync(outputPath, "a")
  flushTimer = setInterval(onFlushTick, flushMs)
  flushTimer.unref?.()
  snapshotTimer = setInterval(onSnapshotTick, snapshotMs)
  snapshotTimer.unref?.()

  const onSignal = (): void => {
    try {
      onFlushTick()
      drain()
    } catch {}
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, onSignal)
    cleanup.push(() => process.off(signal, onSignal))
  }
  const onExit = (): void => {
    if (started) {
      try {
        drain()
      } catch {
        // never throw from exit handlers
      }
    }
  }
  process.on("exit", onExit)
  cleanup.push(() => process.off("exit", onExit))

  writeLine({ kind: "start", t: Date.now(), pid: process.pid, output: outputPath })
  drain()
}

export function stop(): void {
  if (!started) return
  started = false
  for (const off of cleanup) off()
  cleanup.length = 0
  if (flushTimer) clearInterval(flushTimer)
  if (snapshotTimer) clearInterval(snapshotTimer)
  flushTimer = null
  snapshotTimer = null
  writeLine({ kind: "stop", t: Date.now() })
  drain()
  if (fd !== null) {
    closeSync(fd)
    fd = null
  }
}

export function flush(): void {
  if (started) drain()
}

/** Test hooks. */
export const _flushTick = (): void => onFlushTick()
export const _snapshotTick = (): void => onSnapshotTick()

function onFlushTick(): void {
  if (!started) return
  const mem = processMem()
  writeLine({
    kind: "proc",
    t: Date.now(),
    rssMB: round2(mem.rssMB),
    heapUsedMB: round2(mem.heapUsedMB),
    externalMB: round2(mem.externalMB),
  })
  const agg = snapshot()
  writeLine({ kind: "states", t: Date.now(), states: agg.states, active: agg.active })
  drain()
}

function onSnapshotTick(): void {
  if (!started) return
  const agg = snapshot()
  writeLine({
    kind: "snapshot",
    t: Date.now(),
    functions: agg.functions.slice(0, topFunctions),
    files: agg.files,
    modules: agg.modules,
    classes: agg.classes,
    states: agg.states,
    active: agg.active,
    total: agg.total,
  })
}

function writeLine(line: Record<string, unknown>): void {
  buffer.push(JSON.stringify(line))
}

function drain(): void {
  if (buffer.length === 0 || fd === null) return
  const chunk = buffer.join("\n") + "\n"
  buffer = []
  const written = writeSync(fd, chunk)
  if (written < chunk.length) buffer.push(chunk.slice(written))
}

function parseMs(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function parsePositiveMs(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parseNum(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
