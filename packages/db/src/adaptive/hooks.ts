// packages/db/src/adaptive/hooks.ts
import { Effect, Layer } from "effect"
import { AdaptiveResourceService, defaultLayer as AdaptiveResourceDefaultLayer } from "./service"
import type { AdaptiveTargets } from "./profiles"

// Read current targets at decision point (for ephemeral resources)
export const useAdaptiveTargets = <A, E, R>(
  f: (targets: AdaptiveTargets) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | AdaptiveResourceService> =>
  Effect.gen(function* () {
    const { getCurrentTargets } = yield* AdaptiveResourceService
    const targets = yield* getCurrentTargets()
    return yield* f(targets)
  })

// Create resource with adaptive config (for caches, queues, semaphores created at runtime)
export const withAdaptiveConfig = <Config, A, E, R>(
  makeConfig: (targets: AdaptiveTargets) => Config,
  useResource: (config: Config) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | AdaptiveResourceService> =>
  useAdaptiveTargets(targets => useResource(makeConfig(targets)))

// For long-lived resources created at startup: read once at layer init.
// Self-contains the adaptive service so consumers see RIn = R, not R | AdaptiveResourceService.
export const makeAdaptiveLayer = <S, E, R>(
  makeLayer: (targets: AdaptiveTargets) => Layer.Layer<S, E, R>
): Layer.Layer<S, E, R> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { getCurrentTargets } = yield* AdaptiveResourceService
      const targets = yield* getCurrentTargets()
      return makeLayer(targets)
    })
  ).pipe(Layer.provide(AdaptiveResourceDefaultLayer))
