import { Effect, ManagedRuntime, Ref } from "effect"
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
import { ComposerBans } from "./provider/composer-bans"
import { maybeStart as sshMaybeStart, defaultLayer as SshDefaultLayer } from "./ssh"

// `handleCLI` returns the exit code when argv named a CLI command, or null when
// it didn't — null falls through to starting the server.
const cliExit = await handleCLI(process.argv.slice(2))
if (cliExit !== null) process.exit(cliExit)

const port = parseInt(process.env.PORT || "4097", 10)
const host = process.env.HOST || "0.0.0.0"
const cors = process.env.CORS ? process.env.CORS.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined

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

  // The router's model bans: read them back at boot so a restart does not send the user
  // back to a model that just failed, and persist every new one.
  Effect.runFork(
    ComposerBans.register.pipe(
      Effect.provide(ComposerBans.layer),
      Effect.catchCause((cause) => Effect.logWarning("model ban restore failed", { cause })),
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

  // Adaptive GC scheduler: only intervenes when the HOST is under memory
  // pressure. JSC collects on allocation pressure by itself, and `Bun.gc(true)`
  // is a synchronous full collection — running it unconditionally on a timer
  // produces periodic multi-millisecond event-loop stalls for no benefit.
  // Runs in its own runtime so it does not depend on the server's AppLayer
  // lifecycle.
  const adaptiveRuntime = ManagedRuntime.make(AdaptiveResourceDefaultLayer)
  adaptiveRuntime.runFork(
    Effect.gen(function* () {
      const adaptive = yield* AdaptiveResourceService
      let lastProfile: string | undefined

      yield* Effect.forever(
        Effect.gen(function* () {
          const { gcIntervalMs, rssTargetMB } = yield* adaptive.getCurrentTargets()
          yield* Effect.sleep(gcIntervalMs)

          const usage = process.memoryUsage()
          const rssMB = usage.rss / 1024 / 1024
          const profile = yield* adaptive.getCurrentProfile()
          const system = yield* Ref.get(adaptive.lastSystem)

          // Only force a full collection when the machine itself is short on
          // memory AND this process is a meaningful part of the pressure.
          const hostLow =
            system !== null &&
            system.availableMemoryMB < Math.max(512, system.totalMemoryMB * 0.1)
          if (hostLow && rssMB > rssTargetMB) {
            if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true)
            yield* Effect.logWarning("Emergency GC", { rssMB: Math.round(rssMB), target: rssTargetMB, profile })
          } else if (typeof Bun !== "undefined" && Bun.gc) {
            // Incremental (non-blocking) collection. `Bun.gc(true)` is a
            // synchronous full GC; doing that on a timer stalls the event loop.
            Bun.gc(false)
          }

          // Report the profile only when it actually changes.
          if (profile !== lastProfile) {
            lastProfile = profile
            yield* Effect.logInfo("Adaptive profile changed", { profile, rssMB: Math.round(rssMB), rssTargetMB })
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
