import { appendFileSync, mkdirSync } from "node:fs"
import { appendFile } from "node:fs/promises"
import { dirname } from "node:path"
import { _onScope, dispatchSnapshot, processMem, snapshot } from "./core"
import type { ScopeEvent } from "./types"

const parseMs = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const OUTPUT = process.env["DIVEEOI_PROFILER_OUTPUT"] ?? ".divee/profiler.jsonl"
const FLUSH_MS = parseMs(process.env["DIVEEOI_PROFILER_FLUSH_MS"], 5000)
const SNAPSHOT_MS = parseMs(process.env["DIVEEOI_PROFILER_SNAPSHOT_MS"], 60000)
const MIN_MS = parseMs(process.env["DIVEEOI_PROFILER_MIN_MS"], 1)
const TOP_FUNCTIONS = 200
const SIGNAL_GRACE_MS = 100

let started = false
let lines: string[] = []
let flushTimer: ReturnType<typeof setInterval> | undefined
let snapshotTimer: ReturnType<typeof setInterval> | undefined
let offScope: (() => void) | undefined

const onScopeEvent = (key: string, event: ScopeEvent): void => {
  if (event.durMs < MIN_MS && event.error !== true) return
  const line: Record<string, unknown> = {
    kind: "scope_done",
    t: Date.now(),
    key,
    durMs: event.durMs,
    err: event.error === true,
  }
  if (event.heapDeltaMB !== undefined) line["heapDeltaMB"] = event.heapDeltaMB
  if (event.rssDeltaMB !== undefined) line["rssDeltaMB"] = event.rssDeltaMB
  pushLine(JSON.stringify(line))
}

const onFlushTick = (): void => {
  try {
    pushLine(JSON.stringify({ kind: "proc", t: Date.now(), mem: processMem() }))
  } catch {
    // swallow
  }
  flush()
}

const onSnapshotTick = (): void => {
  try {
    const agg = snapshot()
    pushLine(
      JSON.stringify({
        kind: "snapshot",
        t: Date.now(),
        mem: processMem(),
        functions: agg.functions.slice(0, TOP_FUNCTIONS),
        modules: agg.modules,
        files: agg.files,
      }),
    )
  } catch {
    // swallow
  }
  dispatchSnapshot()
}

const pushLine = (line: string): void => {
  lines.push(line)
}

const flush = (): void => {
  if (lines.length === 0) return
  const chunk = lines.join("\n") + "\n"
  lines = []
  appendFile(OUTPUT, chunk).catch(() => {
    // swallow
  })
}

// Async appendFile cannot complete inside the exit event, so do a best-effort sync write.
const flushSync = (): void => {
  if (lines.length === 0) return
  const chunk = lines.join("\n") + "\n"
  lines = []
  try {
    appendFileSync(OUTPUT, chunk, { flag: "a" })
  } catch {
    // swallow
  }
}

const cleanup = (): void => {
  if (flushTimer !== undefined) clearInterval(flushTimer)
  if (snapshotTimer !== undefined) clearInterval(snapshotTimer)
  flushTimer = undefined
  snapshotTimer = undefined
  if (offScope !== undefined) {
    offScope()
    offScope = undefined
  }
  process.removeListener("exit", onExit)
  process.removeListener("SIGINT", onSignal)
  process.removeListener("SIGTERM", onSignal)
}

const onExit = (): void => {
  flushSync()
  cleanup()
}

// Grace period lets the pending appendFile finish before default signal handling.
const onSignal = (signal: NodeJS.Signals): void => {
  flush()
  cleanup()
  setTimeout(() => {
    process.kill(process.pid, signal)
  }, SIGNAL_GRACE_MS)
}

export const start = (): void => {
  if (started) return
  started = true
  try {
    mkdirSync(dirname(OUTPUT), { recursive: true })
  } catch {
    // swallow
  }
  offScope = _onScope(onScopeEvent)
  flushTimer = setInterval(onFlushTick, FLUSH_MS)
  snapshotTimer = setInterval(onSnapshotTick, SNAPSHOT_MS)
  flushTimer.unref()
  snapshotTimer.unref()
  process.on("exit", onExit)
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)
}
