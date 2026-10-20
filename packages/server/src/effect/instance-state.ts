import { Effect, ScopedCache, Scope } from "effect"
import { StartupSettings } from "@diveeoi/db/startup-settings"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceRef, WorkspaceRef } from "./instance-ref"
import { registerDisposer } from "./instance-registry"
import { WorkspaceContext } from "@/control-plane/workspace-context"

const TypeId = "~opencode/InstanceState"

export interface InstanceState<A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly cache: ScopedCache.ScopedCache<string, A, E, R>
}

export const context = Effect.gen(function* () {
  const ctx = yield* InstanceRef
  if (!ctx) {
    yield* Effect.logWarning("InstanceState.context called without InstanceRef")
    return { directory: process.cwd(), worktree: process.cwd(), project: { id: "startup" as any, worktree: process.cwd(), time: { created: 0, updated: 0 }, sandboxes: [] }, remote: undefined } as InstanceContext
  }
  return ctx
})

export const workspaceID = Effect.gen(function* () {
  return (yield* WorkspaceRef) ?? WorkspaceContext.workspaceID
})

export const directory = Effect.map(context, (ctx) => ctx.directory)

// Per-directory state is expensive to build (plugins, references, provider
// projections) but cheap to rebuild on demand. Effect's ScopedCache evicts the
// least recently used entry past this capacity, so a small number keeps recent
// projects hot while bounding RSS. 100 entries could retain several GB after a
// long session of switching projects. `performance.keep_projects_warm` restores
// the larger cache for users who prefer warm switching over lower RSS.
const INSTANCE_STATE_CAPACITY = StartupSettings.instanceStateCapacity

export const make = <A, E = never, R = never>(
  init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>,
): Effect.Effect<InstanceState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const cache = yield* ScopedCache.make<string, A, E, R>({
      capacity: INSTANCE_STATE_CAPACITY,
      lookup: () =>
        Effect.gen(function* () {
          return yield* init(yield* context)
        }),
    })

    const off = registerDisposer((directory) => Effect.runPromise(ScopedCache.invalidate(cache, directory)))
    yield* Effect.addFinalizer(() => Effect.sync(off))

    return {
      [TypeId]: TypeId,
      cache,
    }
  })

export const get = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.get(self.cache, yield* directory)
  })

export const use = <A, E, R, B>(self: InstanceState<A, E, R>, select: (value: A) => B) => Effect.map(get(self), select)

export const useEffect = <A, E, R, B, E2, R2>(
  self: InstanceState<A, E, R>,
  select: (value: A) => Effect.Effect<B, E2, R2>,
) => Effect.flatMap(get(self), select)

export const has = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.has(self.cache, yield* directory)
  })

export const invalidate = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.invalidate(self.cache, yield* directory)
  })

export * as InstanceState from "./instance-state"
