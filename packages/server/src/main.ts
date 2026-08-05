import { Effect, ManagedRuntime } from "effect"
import { AdaptiveResourceService } from "@diveeoi/db/adaptive"
import { handleCLI } from "./cli/index"
import { Server } from "./server/server"
import { DevMonitor } from "./dev/monitor"
import { checkCtx7Update } from "./setup/ctx7"

const handled = await handleCLI(process.argv.slice(2))
if (handled) process.exit(0)

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

  // Adaptive GC scheduler: triggers Bun.gc(true) on the interval computed
  // from the current resource profile. Runs in its own runtime so it does
  // not depend on the server's AppLayer lifecycle.
  const adaptiveRuntime = ManagedRuntime.make(AdaptiveResourceService.defaultLayer)
  adaptiveRuntime.runFork(
    Effect.gen(function* () {
      const adaptive = yield* AdaptiveResourceService
      while (true) {
        const { gcIntervalMs } = yield* adaptive.getCurrentTargets()
        yield* Effect.sleep(gcIntervalMs)
        if (typeof Bun !== "undefined" && Bun.gc) {
          Bun.gc(true)
          yield* Effect.logDebug("Adaptive GC", { interval: gcIntervalMs })
        }
      }
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
