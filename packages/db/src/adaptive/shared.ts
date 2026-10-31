// packages/db/src/adaptive/shared.ts
//
// One process-wide AdaptiveResourceService. Every `Effect.provide(defaultLayer)` builds a NEW
// instance with its own 90-second updater fiber (the server log showed two "Adaptive targets updated"
// lines per tick), so hooks use this shared instance instead. If a caller already provides the
// service (tests, ManagedRuntime) that one wins.

import { Context, Effect, Layer, Option, Scope } from "effect"
import { AdaptiveResourceService, layer } from "./service"

let shared: Promise<AdaptiveResourceService> | undefined

const buildShared = (): Promise<AdaptiveResourceService> =>
  (shared ??= Effect.runPromise(
    Layer.buildWithScope(layer, Scope.makeUnsafe()).pipe(Effect.map((ctx) => Context.get(ctx, AdaptiveResourceService))),
  ))

export const sharedAdaptive: Effect.Effect<AdaptiveResourceService> = Effect.gen(function* () {
  const provided = yield* Effect.serviceOption(AdaptiveResourceService)
  if (Option.isSome(provided)) return provided.value
  return yield* Effect.promise(buildShared)
})
