// packages/db/src/adaptive/service.ts
import { Context, Effect, Layer, Ref } from "effect"
import { LayerNode } from "../effect/layer-node"
import { detectSystemResources } from "./detect"
import type { SystemResources } from "./detect"
import { computeProfile, computeTargets, interpolateTargets } from "./profiles"
import type { AdaptiveTargets, ResourceProfile } from "./profiles"

export interface AdaptiveResourceService {
  readonly targets: Ref.Ref<AdaptiveTargets>
  readonly profile: Ref.Ref<ResourceProfile>
  readonly lastSystem: Ref.Ref<SystemResources | null>
  readonly getCurrentTargets: () => Effect.Effect<AdaptiveTargets>
  readonly getCurrentProfile: () => Effect.Effect<ResourceProfile>
  readonly subscribe: (fn: (targets: AdaptiveTargets) => void) => Effect.Effect<() => void>
}

export const AdaptiveResourceService = Context.Service<AdaptiveResourceService, AdaptiveResourceService>()("@diveeoi/AdaptiveResource")

export const layer = Layer.effect(AdaptiveResourceService, Effect.gen(function* () {
  const initial = yield* detectSystemResources
  const targetsRef = yield* Ref.make(computeTargets(initial))
  const profileRef = yield* Ref.make(computeProfile(initial))
  const lastSystemRef = yield* Ref.make<SystemResources | null>(initial)

  const subscribers = new Set<(t: AdaptiveTargets) => void>()
  const notify = (t: AdaptiveTargets) => { for (const fn of subscribers) fn(t) }

  const updater = Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep("90 seconds")
      const sys = yield* detectSystemResources
      const freshProfile = computeProfile(sys)
      const prevProfile = yield* Ref.get(profileRef)
      const prevTargets = yield* Ref.get(targetsRef)
      const freshTargets = computeTargets(sys)
      // Smooth interpolation when profile is unchanged; snap when it flips
      const target = freshProfile === prevProfile
        ? interpolateTargets(prevTargets, freshTargets, 0.3)
        : freshTargets
      yield* Ref.set(lastSystemRef, sys)
      yield* Ref.set(profileRef, freshProfile)
      yield* Ref.set(targetsRef, target)
      yield* Effect.sync(() => notify(target))
      yield* Effect.logInfo("Adaptive targets updated", { profile: freshProfile, rssTargetMB: target.rssTargetMB, heapTargetMB: target.heapTargetMB, gcIntervalMs: target.gcIntervalMs })
    }
  }).pipe(
    Effect.catchCause((cause) => Effect.logError("Adaptive updater error", { cause })),
    Effect.forever,
  )

  yield* Effect.forkScoped(updater)

  return {
    targets: targetsRef,
    profile: profileRef,
    lastSystem: lastSystemRef,
    getCurrentTargets: () => Ref.get(targetsRef),
    getCurrentProfile: () => Ref.get(profileRef),
    subscribe: (fn) => Effect.sync(() => {
      subscribers.add(fn)
      return () => { subscribers.delete(fn) }
    }),
  }
}))

export const defaultLayer = layer
export const node = LayerNode.make(layer, [])
