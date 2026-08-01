import { Prefs } from "@diveeoi/db/prefs"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const PrefsHandler = HttpApiBuilder.group(Api, "server.prefs", (handlers) =>
  handlers
    .handle(
      "prefs.list",
      Effect.fn(function* (ctx) {
        const items = yield* (yield* Prefs.Service).list(ctx.params.scope)
        return { data: items }
      }),
    )
    .handle(
      "prefs.set",
      Effect.fn(function* (ctx) {
        yield* (yield* Prefs.Service).set(ctx.params.scope, ctx.payload.name, ctx.payload.value)
        return { data: { name: ctx.payload.name, value: ctx.payload.value } }
      }),
    )
    .handle(
      "prefs.delete",
      Effect.fn(function* (ctx) {
        yield* (yield* Prefs.Service).delete(ctx.params.scope, ctx.params.name)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "prefs.deleteScope",
      Effect.fn(function* (ctx) {
        yield* (yield* Prefs.Service).deleteScope(ctx.params.scope)
        return HttpApiSchema.NoContent.make()
      }),
    ),
)
