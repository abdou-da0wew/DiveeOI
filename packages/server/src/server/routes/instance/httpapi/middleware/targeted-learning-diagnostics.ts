import { Cause, Effect, Exit } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { startDiagnosticOperation } from "@diveeoi/learning/diagnostics"

const isTargetedLearningPath = (path: string) => path === "/targeted-learning" || path.startsWith("/targeted-learning/")

export const targetedLearningDiagnosticsLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    if (!isTargetedLearningPath(url.pathname)) return yield* effect

    // Never log headers, query strings, or request bodies here. This catches
    // every Targeted Learning API interaction, including auth/validation errors.
    const operation = startDiagnosticOperation("http", "request", {
      method: request.method,
      path: url.pathname,
    })
    return yield* effect.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isSuccess(exit)) {
            const response = exit.value as { status?: unknown }
            operation.complete({ status: response?.status })
          } else {
            operation.fail(Cause.pretty(exit.cause))
          }
        }),
      ),
    )
  }),
).layer
