// packages/db/src/io/governor.ts
//
// The I/O governor: one place that decides HOW FAST heavy file operations run.
//
// Inputs:
//   - what medium the operation touches (./storage.ts: ssd / hdd / network /
//     unknown, per end, logged as "ssd→hdd" and friends)
//   - live I/O pressure (./pressure.ts: PSI → diskstats → loadavg)
//   - the adaptive resource profile (memory pressure lowers I/O budgets too)
//
// Behavior:
//   - Spinning/network/unknown devices serialize ALL heavy I/O through ONE slot
//     per device key. Seeky disks are killed by concurrency, not by throughput:
//     one thing at a time is the single most "HDD-friendly" thing we can do.
//   - SSDs get small per-lane limits (copies and index crawls don't contend).
//   - When pressure is saturated, new heavy work DEFERS (backs off) before it
//     queues — up to a bounded wait, then proceeds anyway (never deadlock).
//   - `pacedCopyFile` copies sequentially in 1 MiB chunks and sleeps briefly
//     between chunks when pressure is busy/saturated — no per-chunk fsync, no
//     random-I/O patterns, no thrash.
//   - Every governed op records its direction so diagnostics show exactly what
//     happened on which medium.
//
// Off switch: DIVEEOI_IO_GOVERNOR=off (tests, exotic environments).

import path from "node:path"
import fsp from "node:fs/promises"
import { AsyncLocalStorage } from "node:async_hooks"
import { describeDirection, describeIo, rankOf, type IoDirection, type StorageClass, type StorageInfo } from "./storage"
import { sampleIoPressure, clearIoPressureCache, primeIoPressure, type IoPressure } from "./pressure"

export type IoLane = "copy" | "worktree" | "ingest" | "download" | "index"

export interface IoLaneOptions {
  /** Source path (read end). Optional for ops without a local source. */
  readonly src?: string
  /** Destination path (write end). Optional for read-only ops. */
  readonly dst?: string
  /** Extra log context (e.g. "worktree create", "book ingest"). */
  readonly label?: string
  /**
   * When pressure is saturated, defer (sleep-and-recheck) before queueing.
   * Default true; set false for user-on-demand work that must not add latency.
   */
  readonly deferOnSaturated?: boolean
}

export type IoDirectionInfo = IoDirection & { srcInfo: StorageInfo; dstInfo: StorageInfo }

export interface IoTicket {
  readonly lane: IoLane
  readonly direction: IoDirectionInfo
  readonly slotKey: string
  readonly acquiredAt: number
}

export interface IoLaneStat {
  readonly lane: IoLane
  readonly slotKey: string
  readonly active: number
  readonly queued: number
  readonly limit: number
  readonly lastLabel: string | undefined
  readonly lastDurationMs: number | undefined
  readonly lastDirection: string | undefined
  readonly completed: number
}

export interface IoGovernorStatus {
  readonly disabled: boolean
  readonly pressure: IoPressure
  readonly lanes: IoLaneStat[]
  /** Base per-lane concurrency on fast storage, before profile scaling. */
  readonly laneLimits: Record<IoLane, number>
}

// ---------------------------------------------------------------------------
// Environment / knobs
// ---------------------------------------------------------------------------

export interface IoGovernorEnv {
  readonly clock: () => number
  readonly sleep: (ms: number) => Promise<void>
  /** Log sink for governed operations (defaults to console). */
  readonly log: (line: string) => void
}

let governorEnv: IoGovernorEnv = {
  clock: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.log(line),
}

export const configureIoGovernor = (overrides: Partial<IoGovernorEnv>): void => {
  governorEnv = { ...governorEnv, ...overrides }
}

export const resetIoGovernor = (): void => {
  governorEnv = {
    clock: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
  }
  lanes.clear()
  slowSemaphores.clear()
  laneSemaphores.clear()
  clearIoPressureCache()
}

export const ioGovernorDisabled = (): boolean =>
  (process.env["DIVEEOI_IO_GOVERNOR"] ?? "").toLowerCase() === "off"

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

// Fast-storage concurrency per lane. Slow storage always collapses to ONE
// shared slot per device (see slotKeyFor), so these only apply on SSDs.
const BASE_LANE_LIMITS: Record<IoLane, number> = {
  copy: 2,
  worktree: 2,
  ingest: 2,
  download: 2,
  index: 1,
}

const profileScale = (profile: string | undefined): number => {
  if (profile === "critical") return 0
  if (profile === "constrained") return 0.5
  return 1
}

let adaptiveProfile: string | undefined

/** Feed the current adaptive resource profile in (governor scales down with it). */
export const setIoGovernorProfile = (profile: string | undefined): void => {
  adaptiveProfile = profile
}

const limitFor = (lane: IoLane, cls: StorageClass): number => {
  const base = BASE_LANE_LIMITS[lane]
  if (cls === "ssd") {
    // Profile scale: 1 comfortable/balanced, 0.5 constrained, 0 critical —
    // never NaN-substituted to 1 (critical must actually shrink to one slot).
    const scale = adaptiveProfile === undefined ? 1 : profileScale(adaptiveProfile)
    return Math.max(1, Math.floor(base * scale))
  }
  // hdd / network / unknown: one at a time, per device.
  return 1
}

// ---------------------------------------------------------------------------
// Semaphores
// ---------------------------------------------------------------------------

class Semaphore {
  private active = 0
  private readonly waiters: Array<{ resolve: () => void; cancelled: boolean }> = []

  constructor(readonly limit: number) {}

  get stats() {
    return { active: this.active, queued: this.waiters.length }
  }

  /** Cancellable acquisition — cancelled waiters leave the queue cleanly. */
  acquire(): { promise: Promise<void>; cancel: () => void } {
    if (this.active < this.limit) {
      this.active += 1
      return { promise: Promise.resolve(), cancel: () => {} }
    }
    const entry = { resolve: () => {}, cancelled: false }
    const promise = new Promise<void>((resolve) => {
      entry.resolve = resolve
    })
    this.waiters.push(entry)
    return {
      promise,
      cancel: () => {
        if (entry.cancelled) return
        entry.cancelled = true
        const index = this.waiters.indexOf(entry)
        if (index !== -1) this.waiters.splice(index, 1)
      },
    }
  }

  release(): void {
    this.active = Math.max(0, this.active - 1)
    for (;;) {
      const next = this.waiters.shift()
      if (!next) break
      if (next.cancelled) continue
      next.resolve()
      break
    }
  }
}

const laneSemaphores = new Map<string, Semaphore>()
const slowSemaphores = new Map<string, Semaphore>()

const semaphoreFor = (key: string, limit: number): Semaphore => {
  const existing = (key.startsWith("slow:") ? slowSemaphores : laneSemaphores).get(key)
  if (existing) return existing
  const created = new Semaphore(limit)
  ;(key.startsWith("slow:") ? slowSemaphores : laneSemaphores).set(key, created)
  return created
}

// ---------------------------------------------------------------------------
// Lane accounting
// ---------------------------------------------------------------------------

interface LaneRecord {
  lane: IoLane
  active: number
  queued: number
  lastLabel?: string
  lastDurationMs?: number
  lastDirection?: string
  completed: number
  limit: number
}

const lanes = new Map<string, LaneRecord>()

const recordOf = (slotKey: string, lane: IoLane, limit: number): LaneRecord => {
  let record = lanes.get(slotKey)
  if (!record) {
    record = { active: 0, queued: 0, completed: 0, limit, lane }
    lanes.set(slotKey, record)
  }
  return record
}

/**
 * Which slot serializes this lane? Slow media (hdd/network/unknown) share ONE
 * global slow slot keyed by device so that a worktree checkout, a book ingest
 * and a model download can never seek-conflict with each other on the same
 * spinning disk. SSDs use independent per-lane slots.
 */
const slotKeyFor = (lane: IoLane, direction: IoDirectionInfo): string => {
  const slowest = direction.slowest
  if (slowest === "ssd") return `lane:${lane}`
  const rank = rankOf(slowest)
  if (rank <= rankOf("network")) return `slow:${slowest}:${direction.dstInfo.device ?? direction.srcInfo.device ?? "device"}`
  // unknown: single shared conservative slot (can't prove the medium is fast)
  return "slow:unknown:shared"
}

// ---------------------------------------------------------------------------
// Core: acquire / release / withIoLane
// ---------------------------------------------------------------------------

const DEFER_POLL_MS = 250
const DEFER_MAX_WAIT_MS = 5_000
/**
 * Hard safety valve: a queued acquisition that waits longer than this (REAL
 * time, never the injected clock) logs a warning and takes the slot anyway.
 * Deadlocks must surface, never hang. (Nested same-slot calls never queue at
 * all — see the AsyncLocalStorage guard.)
 */
const QUEUE_FORCE_AFTER_MS = Number(process.env["DIVEEOI_IO_LANE_FORCE_MS"] ?? 120_000)
/** Real-time sleep for the safety valve (immune to test clock overrides). */
const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Slots currently held by the running async context (detects nested calls). */
const heldSlots = new AsyncLocalStorage<Set<string>>()

async function acquireLane(lane: IoLane, options: IoLaneOptions = {}): Promise<IoTicket & { nested: boolean; forced: boolean }> {
  const src = options.src
  const dst = options.dst
  const direction: IoDirectionInfo = (src || dst)
    ? await describeIo(src ?? dst!, dst ?? src!)
    : {
        src: "unknown" as StorageClass,
        dst: "unknown" as StorageClass,
        label: "unknown→unknown",
        slowest: "unknown" as StorageClass,
        srcInfo: unknownInfo(src ?? ""),
        dstInfo: unknownInfo(dst ?? ""),
      }

  const slotKey = slotKeyFor(lane, direction)
  const limit = limitFor(lane, direction.slowest)
  const record = recordOf(slotKey, lane, limit)
  const semaphore = semaphoreFor(slotKey, limit)

  // Re-entrancy: a sub-operation inside an operation that already holds this
  // slot (e.g. the OCR pack download inside a book ingest) must NOT queue on
  // its own parent's slot — that would deadlock on the shared slow-device slot.
  const parentHeld = heldSlots.getStore()
  if (parentHeld?.has(slotKey)) {
    return { lane, direction, slotKey, acquiredAt: governorEnv.clock(), nested: true, forced: false }
  }

  // Saturated pressure → back off BEFORE queueing (bounded; then proceed).
  if ((options.deferOnSaturated ?? true) && record.active >= limit) {
    const deadline = governorEnv.clock() + DEFER_MAX_WAIT_MS
    for (;;) {
      const pressure = await sampleIoPressure(
        direction.dstInfo.major !== undefined ? `${direction.dstInfo.major}:${direction.dstInfo.minor}` : undefined,
      )
      if (pressure.level !== "saturated" || governorEnv.clock() >= deadline) break
      await governorEnv.sleep(DEFER_POLL_MS)
    }
  }

  record.queued += 1
  const acquire = semaphore.acquire()
  const forced = await Promise.race([
    acquire.promise.then(() => false),
    // Safety valve on REAL time: tests inject virtual clocks whose sleeps
    // resolve instantly — the valve must never fire because of that.
    realSleep(QUEUE_FORCE_AFTER_MS).then(() => true),
  ])
  if (forced) {
    acquire.cancel()
    governorEnv.log(
      `io-governor: lane=${lane} waited >${QUEUE_FORCE_AFTER_MS}ms for slot ${slotKey} — forcing through (possible stuck holder)`,
    )
  }
  record.queued = Math.max(0, record.queued - 1)
  record.active += 1
  record.lastLabel = options.label
  record.lastDirection = direction.label
  return { lane, direction, slotKey, acquiredAt: governorEnv.clock(), nested: false, forced }
}

function releaseLane(ticket: IoTicket & { nested?: boolean; forced?: boolean }, error?: unknown): void {
  // Nested tickets share the parent's slot; forced tickets never held one.
  if (ticket.nested || ticket.forced) return
  const semaphore = (ticket.slotKey.startsWith("slow:") ? slowSemaphores : laneSemaphores).get(ticket.slotKey)
  semaphore?.release()
  const record = lanes.get(ticket.slotKey)
  if (record) {
    record.active = Math.max(0, record.active - 1)
    record.completed += 1
    record.lastDurationMs = governorEnv.clock() - ticket.acquiredAt
  }
}

/**
 * Run `fn` under the governor's pacing rules. The returned ticket describes
 * what was actually done (direction label, timing) via `onDone` logging.
 */
export async function withIoLane<T>(
  lane: IoLane,
  options: IoLaneOptions,
  fn: (ticket: IoTicket) => Promise<T>,
): Promise<T> {
  if (ioGovernorDisabled()) {
    const direction: IoDirectionInfo = (options.src || options.dst)
      ? await describeIo(options.src ?? options.dst!, options.dst ?? options.src!)
      : { ...describeDirection("unknown", "unknown"), srcInfo: unknownInfo(options.src ?? ""), dstInfo: unknownInfo(options.dst ?? "") }
    const ticket: IoTicket = { lane, direction, slotKey: `lane:${lane}`, acquiredAt: governorEnv.clock() }
    try {
      return await fn(ticket)
    } finally {
      // Disabled mode still logs the direction so "what happened where" stays visible.
      governorEnv.log(`io[${direction.label}] lane=${lane} op=${options.label ?? lane} (governor off)`)
    }
  }

  const ticket = await acquireLane(lane, options)
  const startedAt = governorEnv.clock()
  const parentHeld = heldSlots.getStore()
  const held = ticket.nested ? (parentHeld ?? new Set<string>()) : new Set([...(parentHeld ?? []), ticket.slotKey])
  // NOTE: Bun's AsyncLocalStorage.run does not reliably return the callback's
  // result when the callback returns a promise — capture it via assignment — and
  // the async body MUST be created inside the callback so its continuations
  // inherit the held-slot context (that is what nested detection reads).
  let running: Promise<T> | undefined
  heldSlots.run(held, () => {
    running = (async () => {
      try {
        const result = await fn(ticket)
        releaseLane(ticket)
        const ms = governorEnv.clock() - startedAt
        governorEnv.log(
          `io[${ticket.direction.label}] lane=${lane} op=${options.label ?? lane} done in ${ms}ms` +
            (ms > 2_000 ? ` (pressured=${(await sampleIoPressure()).level})` : ""),
        )
        return result
      } catch (error) {
        releaseLane(ticket, error)
        throw error
      }
    })()
  })
  // Fallback keeps types honest if a runtime ever skipped the callback entirely.
  return running ?? Promise.reject(new Error("io governor: ALS callback did not run"))
}

/** Effect-side wrapper (acquire → run → release). */
export async function acquireIoLane(lane: IoLane, options?: IoLaneOptions): Promise<IoTicket> {
  return acquireLane(lane, options)
}

export function releaseIoLane(ticket: IoTicket): void {
  releaseLane(ticket)
}

// ---------------------------------------------------------------------------
// Paced sequential copy (the workhorse for big file transfers)
// ---------------------------------------------------------------------------

export interface PacedCopyOptions {
  readonly label?: string
  /** Chunk size (bytes). Default 1 MiB — sequential, large enough for HDDs. */
  readonly chunkBytes?: number
  readonly onProgress?: (bytes: number, total: number | undefined) => void
}

const sleepIfPressured = async (pressure: IoPressure): Promise<void> => {
  if (pressure.level === "saturated") await governorEnv.sleep(15)
  else if (pressure.level === "busy") await governorEnv.sleep(2)
}

/**
 * Copy `src` → `dst` sequentially in large chunks, yielding briefly when the
 * system reports I/O pressure. Sequential 1 MiB chunks keep HDDs streaming
 * (seek-free) and SSDs at full speed; no per-chunk fsync.
 */
export async function pacedCopyFile(src: string, dst: string, options: PacedCopyOptions = {}): Promise<{ bytes: number; direction: IoDirectionInfo }> {
  const chunkBytes = options.chunkBytes ?? 1024 * 1024
  return withIoLane(
    "copy",
    { src, dst, label: options.label ?? `copy ${path_basename(src)}`, deferOnSaturated: true },
    async (ticket) => {
      await fsp.mkdir(path_dirname(dst), { recursive: true })
      const input = await fsp.open(src, "r")
      try {
        const output = await fsp.open(dst, "w")
        try {
          let bytes = 0
          const total = (await input.stat()).size
          const buffer = Buffer.allocUnsafe(chunkBytes)
          for (;;) {
            const { bytesRead } = await input.read(buffer, 0, chunkBytes, null)
            if (bytesRead === 0) break
            await output.write(buffer.subarray(0, bytesRead))
            bytes += bytesRead
            options.onProgress?.(bytes, total)
            if (bytes % (64 * 1024 * 1024) < chunkBytes) {
              await sleepIfPressured(await sampleIoPressure(ticket.direction.dstInfo.major !== undefined ? `${ticket.direction.dstInfo.major}:${ticket.direction.dstInfo.minor}` : undefined))
            } else {
              // Yield to the event loop so small copies never block responsiveness.
              await governorEnv.sleep(0)
            }
          }
          governorEnv.log(
            `io[${ticket.direction.label}] copy ${src} → ${dst} ${(bytes / (1024 * 1024)).toFixed(1)}MB in ${governorEnv.clock() - ticket.acquiredAt}ms`,
          )
          return { bytes, direction: ticket.direction }
        } finally {
          await output.close()
        }
      } finally {
        await input.close()
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export function ioGovernorStatus(): Promise<IoGovernorStatus> {
  return sampleIoPressure().then((pressure) => ({
    disabled: ioGovernorDisabled(),
    pressure,
    laneLimits: { ...BASE_LANE_LIMITS },
    lanes: [...lanes.entries()].map(([slotKey, record]) => ({
      lane: record.lane,
      slotKey,
      active: record.active,
      queued: record.queued,
      limit: record.limit,
      lastLabel: record.lastLabel,
      lastDurationMs: record.lastDurationMs,
      lastDirection: record.lastDirection,
      completed: record.completed,
    })),
  }))
}

const unknownInfo = (p: string): StorageInfo => ({
  path: p,
  device: undefined,
  major: undefined,
  minor: undefined,
  fsType: undefined,
  class: "unknown",
})

// Tiny path helpers.
const path_basename = (p: string) => path.basename(p)
const path_dirname = (p: string) => path.dirname(p)

// Test seams re-exported for convenience.
export { primeIoPressure, clearIoPressureCache }
