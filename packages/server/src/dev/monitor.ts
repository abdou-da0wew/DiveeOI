// packages/server/src/dev/monitor.ts
import { Effect, ManagedRuntime } from "effect"
import { AdaptiveResourceService, defaultLayer as AdaptiveResourceDefaultLayer } from "@diveeoi/db/adaptive"
import type { ResourceProfile } from "@diveeoi/db/adaptive"

export interface MemoryMetrics {
  rssMB: number
  heapUsedMB: number
  externalMB: number
  gcAvailable: boolean
}

export interface AdaptiveMetrics {
  profile: ResourceProfile
  profileChanged: boolean
  rssTargetMB: number
  heapTargetMB: number
  gcIntervalMs: number
  rssDeviationPct: number
  heapDeviationPct: number
}

export interface DevMonitorSnapshot {
  ts: string
  uptimeS: number
  memory: MemoryMetrics
  adaptive: AdaptiveMetrics | null
}

export class DevMonitor {
  static #interval: ReturnType<typeof setInterval> | null = null
  static #runtime: ManagedRuntime.ManagedRuntime<AdaptiveResourceService, never> | null = null
  static #lastSnapshot: DevMonitorSnapshot | null = null

  static start() {
    if (process.env["NODE_ENV"] !== "development") return

    const log = (...args: unknown[]) => {
      const ts = new Date().toISOString().slice(11, 23)
      process.stderr.write(`[${ts}] [DevMonitor] ${args.join(" ")}\n`)
    }

    // Own runtime so snapshots can read adaptive profile/targets without
    // depending on the server's layer composition in main.ts.
    this.#runtime = ManagedRuntime.make(AdaptiveResourceDefaultLayer)

    const check = () => {
      const mem = process.memoryUsage()
      const rssMB = mem.rss / 1024 / 1024
      const heapMB = mem.heapUsed / 1024 / 1024
      log(`RSS ${rssMB.toFixed(1)} MB | heap ${heapMB.toFixed(1)} MB | uptime ${Math.floor(process.uptime())}s`)

      const base: DevMonitorSnapshot = {
        ts: new Date().toISOString(),
        uptimeS: Math.floor(process.uptime()),
        memory: {
          rssMB,
          heapUsedMB: heapMB,
          externalMB: (mem.external ?? 0) / 1024 / 1024,
          gcAvailable: typeof Bun !== "undefined" && typeof Bun.gc === "function",
        },
        adaptive: null,
      }
      this.#lastSnapshot = base

      const runtime = this.#runtime
      if (!runtime) return

      runtime.runPromise(
        Effect.gen(function* () {
          const { getCurrentProfile, getCurrentTargets } = yield* AdaptiveResourceService
          const [targets, profile] = yield* Effect.all([getCurrentTargets(), getCurrentProfile()])
          return { targets, profile }
        }),
      )
        .then(({ targets, profile }) => {
          const prevProfile = this.#lastSnapshot?.adaptive?.profile
          const snapshot: DevMonitorSnapshot = {
            ...base,
            adaptive: {
              profile,
              profileChanged: prevProfile !== undefined && prevProfile !== profile,
              rssTargetMB: targets.rssTargetMB,
              heapTargetMB: targets.heapTargetMB,
              gcIntervalMs: targets.gcIntervalMs,
              rssDeviationPct: deviationPct(mem.rss, targets.rssTargetMB * 1024 * 1024),
              heapDeviationPct: deviationPct(mem.heapUsed, targets.heapTargetMB * 1024 * 1024),
            },
          }
          this.#lastSnapshot = snapshot
          log(JSON.stringify(snapshot))
        })
        .catch((cause: unknown) => {
          log(`adaptive read failed: ${String(cause)}`)
        })
    }

    check()
    this.#interval = setInterval(check, 60_000)
    this.#interval.unref()

    log("DevMonitor started (60s interval)")
  }

  // Latest snapshot for UI/dev tooling: measured memory vs adaptive targets.
  static getSnapshot(): DevMonitorSnapshot | null {
    return this.#lastSnapshot
  }
}

// Signed deviation of measured bytes from the adaptive target, in percent.
const deviationPct = (actualBytes: number, targetBytes: number) =>
  targetBytes > 0 ? Math.round(((actualBytes - targetBytes) / targetBytes) * 10) / 10 : 0
