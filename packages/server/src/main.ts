import { Effect } from "effect"
import { Server } from "./server/server"
import { DevMonitor } from "./dev/monitor"
import { checkCtx7Update } from "./setup/ctx7"

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
