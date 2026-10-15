// packages/server/src/server/routes/instance/httpapi/handlers/remote.ts
// Remote session probe endpoint (draft-10 remote sessions).
//
// POST /api/v1/remote/probe — tests an SSH connection without committing
// it to a session. The frontend's DialogSessionRemote calls this when the
// user clicks "Test connection" to give immediate feedback before saving.

import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { RemoteSession } from "@/ssh-client"
import { ServerAuth } from "@/server/auth"
import { authorizationRouterMiddleware } from "../middleware/authorization"

export const remoteProbeRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    return router.add("POST", "/api/v1/remote/probe", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const bodyText = yield* request.text
        const config = JSON.parse(bodyText) as {
          host: string
          port: number
          user: string
          auth: any
          workingDirectory?: string
        }
        const svc = yield* RemoteSession.Service
        const result = yield* svc.probe({
          host: config.host,
          port: config.port,
          user: config.user,
          auth: config.auth,
          workingDirectory: config.workingDirectory ?? "/",
        })
        return HttpServerResponse.jsonUnsafe(result)
      }).pipe(
        Effect.provide(RemoteSession.defaultLayer),
        Effect.catch((err) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe({ ok: false, reason: String(err) }, { status: 500 }),
          ),
        ),
      ),
    )
  }),
).pipe(
  Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))),
)
