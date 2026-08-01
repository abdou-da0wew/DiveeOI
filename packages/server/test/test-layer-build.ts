// Minimal reproduction: just building the routes layer
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpApiApp } from "../src/server/routes/instance/httpapi/server"

async function main() {
  console.log("Creating served routes...")
  const servedRoutes: Layer.Layer<never, any, HttpServer.HttpServer> = HttpRouter.serve(
    HttpApiApp.routes,
    { disableListenLog: true, disableLogger: true },
  )

  console.log("Building httpApiLayer...")
  const httpApiLayer = servedRoutes.pipe(
    Layer.provide(layerWebSocketConstructorGlobal),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(NodeServices.layer),
  )

  console.log("Building layer...")
  const result = await Effect.runPromise(
    Layer.build(httpApiLayer).pipe(Effect.scoped, Effect.either),
  )
  if (result._tag === "Left") {
    console.error("FAILED:", result.left)
    process.exit(1)
  }
  console.log("SUCCESS: Layer built OK")
  process.exit(0)
}

main().catch((e) => {
  console.error("CRASH:", e)
  process.exit(1)
})
