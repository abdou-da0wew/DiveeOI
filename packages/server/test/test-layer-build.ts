// Minimal reproduction: just building the routes layer
import { Cause, Effect, Exit, Layer } from "effect"
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
  const exit = await Effect.runPromise(
    Layer.build(httpApiLayer).pipe(Effect.scoped, Effect.exit) as Effect.Effect<Exit.Exit<unknown, unknown>, never, never>,
  )
  if (Exit.isFailure(exit)) {
    console.error("FAILED:", Cause.prettyErrors(exit.cause))
    process.exit(1)
  }
  console.log("SUCCESS: Layer built OK")
  process.exit(0)
}

main().catch((e) => {
  console.error("CRASH:", e)
  process.exit(1)
})
