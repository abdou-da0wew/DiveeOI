import { Database } from "@diveeoi/db/database/database"
import { EventV2 } from "@diveeoi/db/event"
import { LocationServiceMap } from "@diveeoi/db/location-layer"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http"
import { JwtAuth } from "./middleware/jwt"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { PtyEnvironment } from "./pty-environment"
import * as ApiWebSocketTracker from "./handlers/pty-ws-tracker"

export function createRoutes(password?: string) {
  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers),
    Layer.provide(PtyEnvironment.defaultLayer),
    // Graceful-shutdown WebSocket tracking for raw WS handlers (pty.connect):
    // tracks connections, enforces the adaptive maxWSConnections cap, and
    // refuses new upgrades with a 1001 close frame once closing begins. When a
    // host (e.g. the server package) mounts these routes it can instead bridge
    // its own tracker implementation to ApiWebSocketTracker.Service — the
    // handler contract is identical.
    Layer.provide(ApiWebSocketTracker.layer),
    Layer.provide(authorizationLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(
      password
        ? ServerAuth.Config.layer({ username: "opencode", password: Option.some(password), mode: "both" })
        : ServerAuth.Config.defaultLayer,
    ),
    Layer.provide(LocationServiceMap.layer),
    Layer.provide(Database.defaultLayer),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(JwtAuth.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
  )
}

export const routes = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(
    routes.pipe(
      Layer.provide(HttpServer.layerServices),
    ) as Layer.Layer<never, never, never>,
    { disableLogger: true },
  )
