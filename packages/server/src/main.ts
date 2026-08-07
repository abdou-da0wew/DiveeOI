import "@diveeoi/profiler"
import { Effect, ManagedRuntime } from "effect"
import { AdaptiveResourceService, defaultLayer as AdaptiveResourceDefaultLayer } from "@diveeoi/db/adaptive"
import { handleCLI } from "./cli/index"
import { Server } from "./server/server"
import { DevMonitor } from "./dev/monitor"
import { checkCtx7Update } from "./setup/ctx7"

const handled = await handleCLI(process.argv.slice(2))
if (handled) process.exit(0)

const port = parseInt(process.env.PORT || "4097", 10)
const host = process.env.HOST || "0.0.0.0"
const cors = process.env.CORS ? process.env.CORS.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined

// Emergency GC threshold as a multiple of the adaptive profile RSS target.
const EMERGENCY_RSS_MULTIPLIER = 1.5

try {
  const server = await Server.listen({ port, hostname: host, cors })
  console.log(`DiveeOI server listening on http://${server.hostname}:${server.port}`)
  DevMonitor.start()

  // Background ctx7 update check (non-blocking)
  Effect.runFork(
    Effect.catchCause(checkCtx7Update(), (cause) => Effect.logWarning("ctx7 update check failed", { cause })),
  )

  // Adaptive GC scheduler: triggers Bun.gc(true) on the interval computed
  // from the current resource profile. Runs in its own runtime so it does
  // not depend on the server's AppLayer lifecycle.
  const adaptiveRuntime = ManagedRuntime.make(AdaptiveResourceDefaultLayer)
  adaptiveRuntime.runFork(
    Effect.gen(function* () {
      const adaptive = yield* AdaptiveResourceService
      yield* Effect.forever(
        Effect.gen(function* () {
          const { gcIntervalMs, rssTargetMB } = yield* adaptive.getCurrentTargets()
          yield* Effect.sleep(gcIntervalMs)
          // Emergency GC: if RSS exceeds 1.5x the profile target, force a full
          // collection immediately to relieve OOM pressure.
          const usage = process.memoryUsage()
          if (usage.rss > rssTargetMB * EMERGENCY_RSS_MULTIPLIER * 1024 * 1024) {
            if (typeof Bun !== "undefined" && Bun.gc) {
              Bun.gc(true)
            }
            yield* Effect.logWarning("Emergency GC", { rss: usage.rss, target: rssTargetMB })
          }
          // Observation signal only: actual HTTP backpressure under the critical
          // profile is not yet implemented (see OPTIMIZATION_PLAN.md 7.2).
          if ((yield* adaptive.getCurrentProfile()) === "critical") {
            yield* Effect.logWarning("Adaptive profile critical, degraded mode", { rss: usage.rss, rssTargetMB })
          }
          if (typeof Bun !== "undefined" && Bun.gc) {
            Bun.gc(true)
            yield* Effect.logDebug("Adaptive GC", { interval: gcIntervalMs })
          }
        }).pipe(Effect.catchCause((cause) => Effect.logWarning("Adaptive GC iteration failed", { cause }))),
      )
    }),
  )

  const shutdown = async () => {
    console.log("\nShutting down...")
    await server.stop(true)
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
} catch (err) {
  console.error("Failed to start server:", err)
  process.exit(1)
}
