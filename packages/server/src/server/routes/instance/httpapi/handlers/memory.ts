import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { SessionMemoryIntegration } from "@/session/memory"
import { MemoryScheduler } from "@/session/memory-scheduler"
import { ServerAuth } from "@/server/auth"
import { authorizationRouterMiddleware } from "../middleware/authorization"

const sessionIdParam = "/:sessionID/memory-extract"

const memoryExtractRouteBase = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const sessionMemory = yield* SessionMemoryIntegration.Service
    const scheduler = yield* MemoryScheduler.Service

    return router.add("POST", `/api/session${sessionIdParam}`, (request) =>
      Effect.gen(function* () {
        const sessionID = request.url.pathname
          .replace(/^\/api\/session\//, "")
          .replace(/\/memory-extract$/, "")

        let body: { all?: boolean } = {}
        const raw = yield* request.text
        if (raw && raw.length > 0) {
          try {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === "object") {
              body = parsed as { all?: boolean }
            }
          } catch {}
        }

        if (body.all) {
          yield* scheduler.extractNow
        } else if (sessionID) {
          yield* sessionMemory.extractSessionMemory(sessionID, [])
        }
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
  }),
).pipe(
  Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))),
)

export const memoryExtractRoute = memoryExtractRouteBase.pipe(
  Layer.provide(MemoryScheduler.node),
)
