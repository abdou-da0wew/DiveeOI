import { Effect, ManagedRuntime } from "effect"
import { Features } from "./features"
import { waitForParentExit } from "./server/restart"

// When spawned by an in-process restart, wait for the old process to release
// the listen port before anything tries to bind it.
await waitForParentExit()

// The profiler is a startup feature: its module (and writer fiber) is only
// loaded when enabled. Actual activation stays gated by DIVEEOI_PROFILER.
if (Features.flags.profiler) await import("@diveeoi/profiler")
import { AdaptiveResourceService, defaultLayer as AdaptiveResourceDefaultLayer } from "@diveeoi/db/adaptive"
import { handleCLI } from "./cli/index"
import { Server } from "./server/server"
import { DevMonitor } from "./dev/monitor"
import { checkCtx7Update } from "./setup/ctx7"
import { bootResume as taskBootResume, defaultLayer as AgentTaskDefaultLayer } from "./task/task"
import { maybeStart as sshMaybeStart, defaultLayer as SshDefaultLayer } from "./ssh"

// `handleCLI` returns the exit code when argv named a CLI command, or null when
// it didn't — null falls through to starting the server.
const cliExit = await handleCLI(process.argv.slice(2))
if (cliExit !== null) process.exit(cliExit)

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

  // P4 boot resume: scan for tasks left in running/queued state by a crashed
  // process. Stale-heartbeat rows get paused then resumed via journal replay.
  // Runs in its own runtime so it cannot block startup — a crash-looping task
  // is logged but the server still serves. The layer provides the adaptive
  // resource service (for maxConcurrentTasks) and AgentTask (the service
  // itself); both compose cleanly under the existing AdaptiveResource layer.
  Effect.runFork(
    taskBootResume().pipe(
      Effect.provide(AgentTaskDefaultLayer),
      Effect.provide(AdaptiveResourceDefaultLayer),
      Effect.catchCause((cause) => Effect.logWarning("Task boot resume failed", { cause })),
    ),
  )

  // P7 SSH server: start if DIVEEOI_SSH_HOST / DIVEEOI_SSH_PASSWORD are
  // configured and the ssh2 probe passed. No-op when unconfigured or
  // unavailable — curl via the TaskApi is the guaranteed surface.
  Effect.runFork(
    sshMaybeStart().pipe(
      Effect.provide(SshDefaultLayer),
      Effect.catchCause((cause) => Effect.logWarning("SSH server start failed", { cause })),
    ),
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
