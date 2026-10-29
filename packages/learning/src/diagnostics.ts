import { randomUUID } from "node:crypto"
import { mkdir, open, rename, stat, unlink } from "node:fs/promises"
import { dirname, isAbsolute, resolve, join } from "node:path"
import { Cause, Effect, Exit } from "effect"

export type DiagnosticLevel = "error" | "warn" | "info" | "trace"

const LEVEL_RANK: Record<DiagnosticLevel, number> = { error: 0, warn: 1, info: 2, trace: 3 }
const LEVELS = new Set<DiagnosticLevel>(["error", "warn", "info", "trace"])
const DEFAULT_HANG_MS = 60_000
const DEFAULT_MAX_LOG_BYTES = 20 * 1024 * 1024
const MAX_BACKUPS = 3
const MAX_STRING_LENGTH = 8_000
const MAX_CONTENT_LENGTH = 2_000
const SECRET_KEY = new RegExp(
  "authorization|cookie|password|passwd|token|secret|api[_-]?key|credential|private[_-]?key",
  "i",
)
const CONTENT_KEY = new RegExp(
  "query|question|user|prompt|answer|content|text|snippet|excerpt|passage|transcript|body|message",
  "i",
)

interface DebugSelection {
  enabled: boolean
  all: boolean
  categories: Set<string>
}

interface ActiveOperation {
  id: string
  component: string
  operation: string
  startedAt: number
  lastProgressAt: number
  lastStalledAt: number
  stage?: string
  paused: boolean
  fields: unknown
}

interface DiagnosticRecord {
  timestamp: string
  level: DiagnosticLevel
  component: string
  event: string
  pid: number
  data: unknown
}

export interface DiagnosticOperation {
  readonly id: string
  progress(stage: string, fields?: Record<string, unknown>): void
  pause(): void
  resume(): void
  complete(result?: unknown): void
  fail(error: unknown, fields?: Record<string, unknown>): void
  cancel(reason?: unknown): void
}

export interface DiagnosticsSnapshot {
  enabled: boolean
  categories: string[]
  level: DiagnosticLevel
  contentLogging: boolean
  hangThresholdMs: number
  maxLogBytes: number
  activeOperations: Array<{
    id: string
    component: string
    operation: string
    stage?: string
    startedAt: string
    lastProgressAt: string
    ageMs: number
    idleMs: number
    paused: boolean
    stalled: boolean
    fields: unknown
  }>
  recentErrors: Array<{ timestamp: string; component: string; event: string; operationId?: string; error: unknown }>
  eventCounts: Record<string, number>
  logWriteFailures: number
  logFile?: string
}

let configuredDataDir = process.env.DIVEEOI_TL_DATA_DIR || join(process.cwd(), "data", "targeted-learning")
let writeQueue: Promise<void> = Promise.resolve()
let writeFailures = 0
let watchdog: ReturnType<typeof setInterval> | undefined
const activeOperations = new Map<string, ActiveOperation>()
const recentErrors: Array<{
  timestamp: string
  component: string
  event: string
  operationId?: string
  error: unknown
}> = []
const eventCounts = new Map<string, number>()

const truthy = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "")

const selection = (): DebugSelection => {
  const raw = process.env.DIVEEOI_TL_DEBUG?.trim().toLowerCase() ?? ""
  if (!raw || /^(0|false|no|off|disabled)$/.test(raw)) return { enabled: false, all: false, categories: new Set() }
  if (/^(1|true|yes|on|debug|trace|all|\*)$/.test(raw)) return { enabled: true, all: true, categories: new Set() }
  const categories = new Set(raw.split(/[\s,;]+/).filter(Boolean))
  if (categories.has("all") || categories.has("*")) return { enabled: true, all: true, categories: new Set() }
  return { enabled: true, all: false, categories }
}

const enabledFor = (component?: string) => {
  const config = selection()
  if (!config.enabled) return false
  if (config.all || !component) return true
  return config.categories.has(component.toLowerCase())
}

export const diagnosticsEnabled = (component?: string) => enabledFor(component)

export const configureDiagnosticsDataDir = (dataDir: string) => {
  if (dataDir.trim()) configuredDataDir = dataDir
}

const configuredLevel = (): DiagnosticLevel => {
  const level = process.env.DIVEEOI_TL_DEBUG_LEVEL?.trim().toLowerCase() as DiagnosticLevel | undefined
  return level && LEVELS.has(level) ? level : "trace"
}

const hangThresholdMs = () => {
  const value = Number(process.env.DIVEEOI_TL_DEBUG_HANG_MS)
  return Number.isFinite(value) ? Math.min(86_400_000, Math.max(1_000, value)) : DEFAULT_HANG_MS
}

const maxLogBytes = () => {
  const value = Number(process.env.DIVEEOI_TL_DEBUG_MAX_LOG_MB)
  const mb = Number.isFinite(value) ? Math.min(1_000, Math.max(1, value)) : DEFAULT_MAX_LOG_BYTES / (1024 * 1024)
  return Math.floor(mb * 1024 * 1024)
}

const contentLoggingEnabled = () => enabledFor() && truthy(process.env.DIVEEOI_TL_DEBUG_CONTENT)

const logFilePath = () => {
  const configured = process.env.DIVEEOI_TL_DEBUG_FILE?.trim()
  if (!configured) return join(configuredDataDir, "logs", "targeted-learning-debug.jsonl")
  return isAbsolute(configured) ? configured : resolve(configuredDataDir, configured)
}

const scrubText = (value: string) =>
  value
    .replace(/\b(Basic|Bearer)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:access_token|refresh_token|id_token|token|password|secret|api[_-]?key)=)[^&#\s]*/gi, "$1[REDACTED]")

const safeErrorString = (value: string) => {
  const scrubbed = scrubText(value)
  if (!contentLoggingEnabled()) return { redacted: true, length: value.length }
  const limit = MAX_CONTENT_LENGTH
  return scrubbed.length > limit
    ? `${scrubbed.slice(0, limit)}…[truncated; ${scrubbed.length} chars]`
    : scrubbed
}

const safeString = (value: string, key: string) => {
  const scrubbed = scrubText(value)
  if (CONTENT_KEY.test(key)) {
    if (!contentLoggingEnabled()) return { redacted: true, length: value.length }
    return scrubbed.length > MAX_CONTENT_LENGTH
      ? `${scrubbed.slice(0, MAX_CONTENT_LENGTH)}…[truncated; ${scrubbed.length} chars]`
      : scrubbed
  }
  return scrubbed.length > MAX_STRING_LENGTH
    ? `${scrubbed.slice(0, MAX_STRING_LENGTH)}…[truncated; ${scrubbed.length} chars]`
    : scrubbed
}

const safeValue = (value: unknown, key = "", depth = 0, seen = new WeakSet<object>()): unknown => {
  if (SECRET_KEY.test(key)) return "[REDACTED]"
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") {
    return /^(?:error|cause|errormessage|lasterror)$/i.test(key) ? safeErrorString(value) : safeString(value, key)
  }
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "symbol" || typeof value === "function") return `[${typeof value}]`
  if (depth >= 7) return "[MaxDepth]"
  if (value instanceof Error) {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    const stack = value.stack?.split(/\r?\n/).filter((line) => /^\s*at\s/.test(line)).join("\n")
    return {
      name: value.name,
      message: safeErrorString(value.message),
      ...(stack ? { stack: safeString(stack, "stack") } : {}),
      ...(value.cause !== undefined ? { cause: safeValue(value.cause, "cause", depth + 1, seen) } : {}),
    }
  }
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return { type: value.constructor.name, byteLength: value.byteLength }
  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeValue(item, key, depth + 1, seen))
  const output: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    output[childKey] = safeValue(childValue, childKey, depth + 1, seen)
  }
  return output
}

const resultSummary = (value: unknown): unknown => {
  if (value === null || value === undefined) return { type: "null" }
  if (typeof value === "string") return { type: "string", length: value.length }
  if (typeof value !== "object") return { type: typeof value }
  if (Array.isArray(value)) return { type: "array", length: value.length }
  const record = value as Record<string, unknown>
  const summary: Record<string, unknown> = {
    type: "object",
    keys: Object.keys(record)
      .slice(0, 40)
      .map((key) => {
        if (SECRET_KEY.test(key)) return "[REDACTED_KEY]"
        if (!contentLoggingEnabled() && CONTENT_KEY.test(key)) return "[CONTENT_KEY]"
        return key.slice(0, 100)
      }),
  }
  for (const key of [
    "status",
    "setupStatus",
    "decision",
    "progress",
    "count",
    "healthy",
    "bookId",
    "slug",
    "jobId",
    "verified",
    "bestDenseScore",
    "bestFusedScore",
    "totalContextTokens",
  ]) {
    const field = record[key]
    if (typeof field === "string" || typeof field === "number" || typeof field === "boolean") summary[key] = field
  }
  if (Array.isArray(record.system)) summary.systemBlocks = record.system.length
  if (typeof record.refusal === "string") summary.hasRefusal = true
  if (typeof record.retryPrompt === "string") summary.hasRetryPrompt = true
  if (typeof record.status === "number") summary.httpStatus = record.status
  return summary
}

const rotateIfNeeded = async (path: string, nextLineBytes: number) => {
  try {
    const current = await stat(path)
    if (current.size + nextLineBytes <= maxLogBytes()) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  for (let index = MAX_BACKUPS; index >= 1; index--) {
    const source = index === 1 ? path : `${path}.${index - 1}`
    const destination = `${path}.${index}`
    try {
      await unlink(destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    try {
      await rename(source, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
}

const writeRecord = async (record: DiagnosticRecord) => {
  const path = logFilePath()
  const line = `${JSON.stringify(record)}\n`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await rotateIfNeeded(path, Buffer.byteLength(line))
  const handle = await open(path, "a", 0o600)
  try {
    await handle.writeFile(line)
    await handle.chmod(0o600).catch(() => undefined)
  } finally {
    await handle.close()
  }
}

const queueRecord = (record: DiagnosticRecord) => {
  writeQueue = writeQueue
    .then(() => writeRecord(record))
    .catch((error) => {
      writeFailures += 1
      if (truthy(process.env.DIVEEOI_TL_DEBUG_CONSOLE)) {
        process.stderr.write(`[Targeted Learning diagnostics] log write failed: ${scrubText(String(error))}\n`)
      }
    })
}

const makeRecord = (
  component: string,
  event: string,
  fields: Record<string, unknown>,
  level: DiagnosticLevel,
): DiagnosticRecord => ({
  timestamp: new Date().toISOString(),
  level,
  component,
  event,
  pid: process.pid,
  data: safeValue(fields),
})

export const logDiagnostic = (
  component: string,
  event: string,
  fields: Record<string, unknown> = {},
  level: DiagnosticLevel = "trace",
) => {
  if (!enabledFor(component) || LEVEL_RANK[level] > LEVEL_RANK[configuredLevel()]) return
  const record = makeRecord(component, event, fields, level)
  const countKey = `${component}.${event}`
  eventCounts.set(countKey, (eventCounts.get(countKey) ?? 0) + 1)
  if (level === "error") {
    const data = record.data as Record<string, unknown>
    const operationId = typeof data?.operationId === "string" ? data.operationId : undefined
    recentErrors.push({ timestamp: record.timestamp, component, event, operationId, error: data?.error ?? data })
    if (recentErrors.length > 25) recentErrors.splice(0, recentErrors.length - 25)
  }
  queueRecord(record)
  if (truthy(process.env.DIVEEOI_TL_DEBUG_CONSOLE)) {
    process.stderr.write(`${JSON.stringify(record)}\n`)
  }
}

const stallSweep = () => {
  if (!enabledFor()) return
  const now = Date.now()
  const threshold = hangThresholdMs()
  for (const operation of activeOperations.values()) {
    if (operation.paused || !enabledFor(operation.component)) continue
    const idleMs = now - operation.lastProgressAt
    if (idleMs < threshold || now - operation.lastStalledAt < threshold) continue
    operation.lastStalledAt = now
    logDiagnostic(operation.component, "operation.stalled", {
      operationId: operation.id,
      operation: operation.operation,
      stage: operation.stage,
      idleMs,
      ageMs: now - operation.startedAt,
      fields: operation.fields,
    }, "warn")
  }
}

const ensureWatchdog = () => {
  if (watchdog || activeOperations.size === 0) return
  const interval = Math.min(10_000, Math.max(250, Math.floor(hangThresholdMs() / 2)))
  watchdog = setInterval(stallSweep, interval)
  watchdog.unref?.()
}

const stopWatchdogIfIdle = () => {
  if (activeOperations.size > 0 || !watchdog) return
  clearInterval(watchdog)
  watchdog = undefined
}

export const startDiagnosticOperation = (
  component: string,
  operation: string,
  fields: Record<string, unknown> = {},
): DiagnosticOperation => {
  const tracked = enabledFor(component)
  const id = tracked ? `tl_${randomUUID()}` : ""
  const startedAt = Date.now()
  if (tracked) {
    activeOperations.set(id, {
      id,
      component,
      operation,
      startedAt,
      lastProgressAt: startedAt,
      lastStalledAt: 0,
      paused: false,
      fields: safeValue(fields),
    })
    ensureWatchdog()
    logDiagnostic(component, "operation.start", { operationId: id, operation, ...fields }, "info")
  }
  let closed = false
  const finish = (event: string, level: DiagnosticLevel, data: Record<string, unknown>) => {
    if (closed) return
    closed = true
    const current = activeOperations.get(id)
    activeOperations.delete(id)
    stopWatchdogIfIdle()
    logDiagnostic(component, event, {
      operationId: id,
      operation,
      durationMs: Date.now() - startedAt,
      ...(current?.stage ? { lastStage: current.stage } : {}),
      ...data,
    }, level)
  }
  return {
    id,
    progress(stage, progressFields = {}) {
      if (closed) return
      const now = Date.now()
      const current = activeOperations.get(id)
      if (current) {
        current.stage = stage
        current.lastProgressAt = now
        current.lastStalledAt = 0
        current.paused = false
      }
      logDiagnostic(component, "operation.progress", { operationId: id, operation, stage, ...progressFields }, "trace")
    },
    pause() {
      const current = activeOperations.get(id)
      if (!current || closed) return
      current.paused = true
      logDiagnostic(component, "operation.paused", { operationId: id, operation, stage: current.stage }, "info")
    },
    resume() {
      const current = activeOperations.get(id)
      if (!current || closed) return
      current.paused = false
      current.lastProgressAt = Date.now()
      current.lastStalledAt = 0
      logDiagnostic(component, "operation.resumed", { operationId: id, operation, stage: current.stage }, "info")
    },
    complete(result) {
      finish("operation.complete", "info", result === undefined ? {} : { result: resultSummary(result) })
    },
    fail(error, errorFields = {}) {
      finish("operation.error", "error", { ...errorFields, error })
    },
    cancel(reason) {
      finish("operation.cancelled", "warn", reason === undefined ? {} : { reason })
    },
  }
}

export const withDiagnosticPromise = <A>(
  component: string,
  operation: string,
  fields: Record<string, unknown>,
  run: () => Promise<A>,
): Promise<A> => {
  if (!enabledFor(component)) return run()
  const diagnostic = startDiagnosticOperation(component, operation, fields)
  let result: Promise<A>
  try {
    result = run()
  } catch (error) {
    diagnostic.fail(error)
    throw error
  }
  return result.then(
    (value) => {
      diagnostic.complete(value)
      return value
    },
    (error) => {
      diagnostic.fail(error)
      throw error
    },
  )
}

export const withDiagnosticEffect = <A, E, R>(
  component: string,
  operation: string,
  fields: Record<string, unknown>,
  effect: Effect.Effect<A, E, R>,
  onStart?: (diagnostic: DiagnosticOperation) => void,
): Effect.Effect<A, E, R> => {
  if (!enabledFor(component)) return effect
  const diagnostic = startDiagnosticOperation(component, operation, fields)
  onStart?.(diagnostic)
  return effect.pipe(
    Effect.onExit((exit) =>
      Effect.sync(() => {
        if (Exit.isSuccess(exit)) diagnostic.complete(exit.value)
        else if (Cause.hasInterruptsOnly(exit.cause)) diagnostic.cancel("interrupted")
        else diagnostic.fail(Cause.pretty(exit.cause))
      }),
    ),
  )
}

const errorSnapshot = (error: unknown): unknown => {
  if (typeof error === "string") return error.slice(0, 500)
  if (error === null || typeof error !== "object") return error
  const value = error as Record<string, unknown>
  if (value.redacted === true && typeof value.length === "number") return { redacted: true, length: value.length }
  return {
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.message === "string" ? { message: value.message.slice(0, 500) } : {}),
    ...(value.message !== undefined && typeof value.message !== "string" ? { message: value.message } : {}),
  }
}

export const diagnosticsSnapshot = (): DiagnosticsSnapshot => {
  const config = selection()
  const enabled = config.enabled
  const now = Date.now()
  const snapshot: DiagnosticsSnapshot = {
    enabled,
    categories: config.all ? ["all"] : [...config.categories].sort(),
    level: configuredLevel(),
    contentLogging: enabled && contentLoggingEnabled(),
    hangThresholdMs: hangThresholdMs(),
    maxLogBytes: maxLogBytes(),
    activeOperations: enabled
      ? [...activeOperations.values()].filter((operation) => enabledFor(operation.component)).map((operation) => ({
          id: operation.id,
          component: operation.component,
          operation: operation.operation,
          stage: operation.stage,
          startedAt: new Date(operation.startedAt).toISOString(),
          lastProgressAt: new Date(operation.lastProgressAt).toISOString(),
          ageMs: now - operation.startedAt,
          idleMs: operation.paused ? 0 : now - operation.lastProgressAt,
          paused: operation.paused,
          stalled: !operation.paused && now - operation.lastProgressAt >= hangThresholdMs(),
          fields: operation.fields,
        }))
      : [],
    recentErrors: enabled
      ? recentErrors
          .filter((error) => enabledFor(error.component))
          .slice(-25)
          .map((error) => ({ ...error, error: errorSnapshot(error.error) }))
      : [],
    eventCounts: enabled
      ? Object.fromEntries(
          [...eventCounts].filter(([key]) => enabledFor(key.slice(0, key.indexOf(".")))),
        )
      : {},
    logWriteFailures: enabled ? writeFailures : 0,
  }
  if (enabled) snapshot.logFile = logFilePath()
  // The HTTP endpoint uses Schema.Unknown, which still requires JSON-safe values (no undefined fields).
  return JSON.parse(JSON.stringify(snapshot)) as DiagnosticsSnapshot
}

export const flushDiagnostics = async () => {
  await writeQueue
}
