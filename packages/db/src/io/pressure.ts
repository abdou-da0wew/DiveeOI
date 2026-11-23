// packages/db/src/io/pressure.ts
//
// Live I/O pressure sampling so the governor can calm down under load.
//
// Signals, best signal first, all optional and cached (~2s) so probes never
// add meaningful overhead:
//   1. PSI — /proc/pressure/io (Linux 4.20+): the kernel's own "tasks stalled
//      on I/O" percentages. The most direct signal of I/O pain.
//   2. diskstats — /proc/diskstats io_ticks delta per sample window: how busy
//      the device was (utilization %), per device.
//   3. loadavg — coarse system fallback.
// Every source can be absent (non-Linux, restricted containers): pressure then
// reports "none" and the governor keeps the static device-class limits.

import fsp from "node:fs/promises"
import { availableParallelism } from "node:os"

export type IoPressureLevel = "calm" | "busy" | "saturated"

export interface IoPressure {
  readonly level: IoPressureLevel
  /** PSI "some" 10s average (percent of time at least one task stalled). */
  readonly psiSome10: number | undefined
  /** PSI "full" 10s average (percent of time ALL non-idle tasks stalled). */
  readonly psiFull10: number | undefined
  /** Per-device utilization percent (diskstats io_ticks delta / window). */
  readonly utilizationPct: number | undefined
  readonly load1: number | undefined
  readonly source: "psi" | "diskstats" | "loadavg" | "none"
  readonly sampledAt: number
}

export interface IoPressureEnv {
  readonly readFile: (path: string) => Promise<string>
  readonly clock: () => number
  readonly cores: () => number
}

let pressureEnv: IoPressureEnv = {
  readFile: (p) => fsp.readFile(p, "utf8"),
  clock: () => Date.now(),
  cores: () => Math.max(1, availableParallelism()),
}

export const configurePressureEnv = (overrides: Partial<IoPressureEnv>): void => {
  pressureEnv = { ...pressureEnv, ...overrides }
}

export const resetPressureEnv = (): void => {
  pressureEnv = {
    readFile: (p) => fsp.readFile(p, "utf8"),
    clock: () => Date.now(),
    cores: () => Math.max(1, availableParallelism()),
  }
  cachedPressure = undefined
  diskstatsPrev.clear()
}

// ---------------------------------------------------------------------------
// Parsers (pure, unit-tested)
// ---------------------------------------------------------------------------

/** Parse /proc/pressure/io: "some avg10=0.00 avg60=0.00 avg300=0.00 total=0" ... */
export function parsePsi(text: string): { some: number; full: number } | undefined {
  let some: number | undefined
  let full: number | undefined
  for (const line of text.split("\n")) {
    const match = /^(some|full)\s+avg10=([\d.]+)/.exec(line.trim())
    if (!match) continue
    const value = Number(match[2])
    if (!Number.isFinite(value)) continue
    if (match[1] === "some") some = value
    if (match[1] === "full") full = value
  }
  if (some === undefined && full === undefined) return undefined
  return { some: some ?? 0, full: full ?? 0 }
}

export interface DiskstatsSample {
  readonly at: number
  /** device key "major:minor" → cumulative io_ticks in milliseconds (field 13). */
  readonly ioTicks: Map<string, number>
}

/** Parse /proc/diskstats into just what we need: per-device io_ticks (ms). */
export function parseDiskstats(text: string): Map<string, number> {
  const ticks = new Map<string, number>()
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/)
    // fields: major minor name reads ... io_ticks_ms (field index 12, 13th column)
    if (fields.length < 13) continue
    const major = Number(fields[0])
    const minor = Number(fields[1])
    const ioTicks = Number(fields[12])
    if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(ioTicks)) continue
    ticks.set(`${major}:${minor}`, ioTicks)
  }
  return ticks
}

/**
 * Utilization percent between two diskstats samples for one device:
 * io_ticks counts milliseconds the device spent with I/O in flight, so
 * delta/window is the classic iostat %util.
 */
export function diskstatsUtilization(prev: DiskstatsSample, next: DiskstatsSample, majorMinor: string): number | undefined {
  const before = prev.ioTicks.get(majorMinor)
  const after = next.ioTicks.get(majorMinor)
  if (before === undefined || after === undefined) return undefined
  const windowMs = Math.max(1, next.at - prev.at)
  const delta = Math.max(0, after - before)
  return Math.min(100, (delta / windowMs) * 100)
}

// ---------------------------------------------------------------------------
// Level thresholds
// ---------------------------------------------------------------------------

export function pressureLevel(input: {
  psiSome?: number
  psiFull?: number
  utilization?: number
  loadRatio?: number
}): IoPressureLevel {
  const { psiSome, psiFull, utilization, loadRatio } = input
  if (psiSome !== undefined) {
    if (psiSome >= 40 || (psiFull ?? 0) >= 10) return "saturated"
    if (psiSome >= 12 || (psiFull ?? 0) >= 3) return "busy"
    return "calm"
  }
  if (utilization !== undefined) {
    if (utilization >= 90) return "saturated"
    if (utilization >= 60) return "busy"
    return "calm"
  }
  if (loadRatio !== undefined) {
    if (loadRatio >= 1.5) return "saturated"
    if (loadRatio >= 0.7) return "busy"
    return "calm"
  }
  return "calm"
}

// ---------------------------------------------------------------------------
// Sampling (cached)
// ---------------------------------------------------------------------------

const SAMPLE_TTL_MS = 2_000
let cachedPressure: IoPressure | undefined
const diskstatsPrev = new Map<string, DiskstatsSample>()

async function sampleUncached(deviceMajorMinor: string | undefined): Promise<IoPressure> {
  const now = pressureEnv.clock()

  // 1) PSI — whole-system I/O pressure.
  try {
    const psiText = await pressureEnv.readFile("/proc/pressure/io")
    const psi = parsePsi(psiText)
    if (psi) {
      return {
        level: pressureLevel({ psiSome: psi.some, psiFull: psi.full }),
        psiSome10: psi.some,
        psiFull10: psi.full,
        utilizationPct: undefined,
        load1: undefined,
        source: "psi",
        sampledAt: now,
      }
    }
  } catch {
    // PSI unavailable — fall through.
  }

  // 2) diskstats — per-device utilization across the sample window.
  try {
    const text = await pressureEnv.readFile("/proc/diskstats")
    const ticks = parseDiskstats(text)
    const sample: DiskstatsSample = { at: now, ioTicks: ticks }
    const deviceKnown = deviceMajorMinor !== undefined && ticks.has(deviceMajorMinor)
    if (deviceKnown) {
      let utilization: number | undefined
      const prev = diskstatsPrev.get(deviceMajorMinor)
      if (prev) utilization = diskstatsUtilization(prev, sample, deviceMajorMinor)
      diskstatsPrev.set(deviceMajorMinor, sample)
      // First sample for this device has no delta yet — still report the
      // diskstats source (calm) rather than falling through to loadavg.
      return {
        level: utilization !== undefined ? pressureLevel({ utilization }) : "calm",
        psiSome10: undefined,
        psiFull10: undefined,
        utilizationPct: utilization,
        load1: undefined,
        source: "diskstats",
        sampledAt: now,
      }
    }
  } catch {
    // diskstats unavailable — fall through.
  }

  // 3) loadavg — the coarsest fallback.
  try {
    const loadText = await pressureEnv.readFile("/proc/loadavg")
    const load1 = Number(loadText.split(/\s+/)[0])
    if (Number.isFinite(load1)) {
      const ratio = load1 / pressureEnv.cores()
      return {
        level: pressureLevel({ loadRatio: ratio }),
        psiSome10: undefined,
        psiFull10: undefined,
        utilizationPct: undefined,
        load1,
        source: "loadavg",
        sampledAt: now,
      }
    }
  } catch {
    // No /proc at all.
  }

  return { level: "calm", psiSome10: undefined, psiFull10: undefined, utilizationPct: undefined, load1: undefined, source: "none", sampledAt: now }
}

/** Cached pressure sample (2s TTL). `deviceMajorMinor` refines the diskstats fallback. */
export async function sampleIoPressure(deviceMajorMinor?: string): Promise<IoPressure> {
  const now = pressureEnv.clock()
  if (cachedPressure && now - cachedPressure.sampledAt < SAMPLE_TTL_MS) return cachedPressure
  const sample = await sampleUncached(deviceMajorMinor)
  cachedPressure = sample
  return sample
}

/** Test seam: pin the next sample. */
export const primeIoPressure = (pressure: IoPressure): void => {
  cachedPressure = pressure
}

export const clearIoPressureCache = (): void => {
  cachedPressure = undefined
  diskstatsPrev.clear()
}
