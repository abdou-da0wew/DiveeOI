import { Server } from "./server/server"
import { DevMonitor } from "./dev/monitor"

const port = parseInt(process.env.PORT || "4097", 10)
const host = process.env.HOST || "0.0.0.0"

try {
  const server = await Server.listen({ port, hostname: host })
  console.log(`DiveeOI server listening on http://${server.hostname}:${server.port}`)
  DevMonitor.start()

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
