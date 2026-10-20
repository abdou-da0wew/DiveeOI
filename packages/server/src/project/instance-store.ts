import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { StartupSettings } from "@diveeoi/db/startup-settings"
import { GlobalBus } from "@/bus/global"
import { serviceUse } from "@diveeoi/db/effect/service-use"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { InstanceRef } from "@/effect/instance-ref"
import { disposeInstance as runDisposers } from "@/effect/instance-registry"
import { FSUtil } from "@diveeoi/db/fs-util"
import { Context, Deferred, Duration, Effect, Exit, Layer, Scope } from "effect"
import { type InstanceContext } from "./instance-context"
import { InstanceBootstrap } from "./bootstrap-service"
import { InstanceBootstrap as InstanceBootstrapGraph } from "./bootstrap"
import * as Project from "./project"

export interface LoadInput {
  directory: string
  worktree?: string
  project?: Project.Info
  /** Remote session config — when present, boot uses the remote context. */
  remote?: import("@/ssh-client").RemoteConfig
}

export interface Interface {
  readonly load: (input: LoadInput) => Effect.Effect<InstanceContext>
  readonly reload: (input: LoadInput) => Effect.Effect<InstanceContext>
  readonly dispose: (ctx: InstanceContext) => Effect.Effect<void>
  readonly disposeDirectory: (directory: string) => Effect.Effect<void>
  readonly disposeAll: () => Effect.Effect<void>
  readonly provide: <A, E, R>(input: LoadInput, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstanceStore") {}

export const use = serviceUse(Service)

interface Entry {
  readonly deferred: Deferred.Deferred<InstanceContext>
  /** In-flight `load` callers; an entry with refs > 0 must never be reaped. */
  refs: number
  /** Last time the entry was used, for LRU eviction. */
  lastUsed: number
}

// Every directory the UI touches boots an instance that retains tens of MB of
// per-instance state. Nothing used to release them, so RSS climbed with the
// number of projects visited. Reap idle instances and cap the total; users can
// opt into warmer, larger retention with `performance.keep_projects_warm`.
const INSTANCE_IDLE_MS = StartupSettings.instanceIdleMs
const INSTANCE_MAX = StartupSettings.instanceMax

export const layer: Layer.Layer<Service, never, Project.Service | InstanceBootstrap.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const project = yield* Project.Service
    const bootstrap = yield* InstanceBootstrap.Service
    const scope = yield* Scope.Scope
    const cache = new Map<string, Entry>()

    // Remote sessions get a composite cache key so two remotes with the same
    // path on different hosts don't collide.
    const cacheKey = (input: { directory: string; remote?: import("@/ssh-client").RemoteConfig }) =>
      input.remote ? `remote:${input.remote.host}:${input.remote.port}:${input.directory}` : input.directory

    const boot = (input: LoadInput & { directory: string }) =>
      Effect.gen(function* () {
        // Remote session: construct an InstanceContext from the remote config
        // instead of reading the local filesystem. directory/worktree are the
        // remote paths; project is synthetic.
        const ctx: InstanceContext = input.remote
          ? {
              directory: input.directory,
              worktree: input.directory,
              project: {
                id: `remote:${input.remote.host}:${input.remote.port}` as any,
                worktree: input.directory,
                time: { created: 0, updated: 0 },
                sandboxes: [],
              },
              remote: input.remote,
            }
          : input.project && input.worktree
            ? {
                directory: input.directory,
                worktree: input.worktree,
                project: input.project,
              }
            : yield* project.fromDirectory(input.directory).pipe(
                Effect.map((result) => ({
                  directory: input.directory,
                  worktree: result.sandbox,
                  project: result.project,
                })),
              )
        yield* bootstrap.run.pipe(Effect.provideService(InstanceRef, ctx))
        return ctx
      }).pipe(Effect.withSpan("InstanceStore.boot"))

    const removeEntry = (directory: string, entry: Entry) =>
      Effect.sync(() => {
        if (cache.get(directory) !== entry) return false
        cache.delete(directory)
        return true
      })

    const completeLoad = (directory: string, input: LoadInput, entry: Entry) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(boot({ ...input, directory }))
        if (Exit.isFailure(exit)) yield* removeEntry(directory, entry)
        yield* Deferred.done(entry.deferred, exit).pipe(Effect.asVoid)
      })

    const emitDisposed = (input: { directory: string; project?: string }) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: input.directory,
          project: input.project,
          workspace: WorkspaceContext.workspaceID,
          payload: {
            type: "server.instance.disposed",
            properties: {
              directory: input.directory,
            },
          },
        }),
      )

    const disposeContext = Effect.fn("InstanceStore.disposeContext")(function* (ctx: InstanceContext) {
      yield* Effect.logInfo("disposing instance", { directory: ctx.directory })
      yield* Effect.promise(() => runDisposers(ctx.directory))
      yield* emitDisposed({ directory: ctx.directory, project: ctx.project.id })
    })

    const disposeEntry = Effect.fnUntraced(function* (directory: string, entry: Entry, ctx: InstanceContext) {
      if (cache.get(directory) !== entry) return false
      yield* disposeContext(ctx)
      if (cache.get(directory) !== entry) return false
      cache.delete(directory)
      return true
    })

    const load = (input: LoadInput): Effect.Effect<InstanceContext> => {
      const directory = FSUtil.resolve(input.directory)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const existing = cache.get(directory)
          if (existing) {
            existing.lastUsed = Date.now()
            existing.refs++
            return yield* restore(Deferred.await(existing.deferred)).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  existing.refs--
                  existing.lastUsed = Date.now()
                }),
              ),
            )
          }

          const entry: Entry = { deferred: Deferred.makeUnsafe<InstanceContext>(), refs: 1, lastUsed: Date.now() }
          cache.set(directory, entry)
          yield* Effect.gen(function* () {
            yield* Effect.logInfo("creating instance", { directory: directory })
            yield* completeLoad(directory, input, entry)
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
          return yield* restore(Deferred.await(entry.deferred)).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                entry.refs--
                entry.lastUsed = Date.now()
              }),
            ),
          )
        }),
      ).pipe(Effect.withSpan("InstanceStore.load"))
    }

    const reload = (input: LoadInput): Effect.Effect<InstanceContext> => {
      const directory = FSUtil.resolve(input.directory)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const previous = cache.get(directory)
          const entry: Entry = { deferred: Deferred.makeUnsafe<InstanceContext>(), refs: 1, lastUsed: Date.now() }
          cache.set(directory, entry)
          yield* Effect.gen(function* () {
            yield* Effect.logInfo("reloading instance", { directory: directory })
            if (previous) {
              yield* Deferred.await(previous.deferred).pipe(Effect.ignore)
              yield* Effect.promise(() => runDisposers(directory))
              yield* emitDisposed({ directory, project: input.project?.id })
            }
            yield* completeLoad(directory, input, entry)
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
          return yield* restore(Deferred.await(entry.deferred)).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                entry.refs--
                entry.lastUsed = Date.now()
              }),
            ),
          )
        }),
      ).pipe(Effect.withSpan("InstanceStore.reload"))
    }

    const dispose = Effect.fn("InstanceStore.dispose")(function* (ctx: InstanceContext) {
      const entry = cache.get(ctx.directory)
      if (!entry) return yield* disposeContext(ctx)

      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return yield* removeEntry(ctx.directory, entry).pipe(Effect.asVoid)
      if (exit.value !== ctx) return
      yield* disposeEntry(ctx.directory, entry, ctx).pipe(Effect.asVoid)
    })

    const disposeDirectory = Effect.fn("InstanceStore.disposeDirectory")(function* (input: string) {
      const directory = FSUtil.resolve(input)
      const entry = cache.get(directory)
      if (!entry) return
      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return yield* removeEntry(directory, entry).pipe(Effect.asVoid)
      yield* disposeEntry(directory, entry, exit.value).pipe(Effect.asVoid)
    })

    const disposeAllOnce = Effect.fnUntraced(function* () {
      yield* Effect.logInfo("disposing all instances")
      yield* Effect.forEach(
        [...cache.entries()],
        (item) =>
          Effect.gen(function* () {
            const exit = yield* Deferred.await(item[1].deferred).pipe(Effect.exit)
            if (Exit.isFailure(exit)) {
              yield* Effect.logWarning("instance dispose failed", { key: item[0], cause: exit.cause })
              yield* removeEntry(item[0], item[1])
              return
            }
            yield* disposeEntry(item[0], item[1], exit.value)
          }),
        { discard: true },
      )
    })

    const cachedDisposeAll = yield* Effect.cachedWithTTL(disposeAllOnce(), Duration.zero)
    const disposeAll = Effect.fn("InstanceStore.disposeAll")(function* () {
      return yield* cachedDisposeAll
    })

    // Reap idle instances so RSS tracks the projects actually in use instead of
    // every project the UI has ever visited. Never touch an entry with in-flight
    // loads; overflow eviction is LRU among idle entries.
    const reap = Effect.fnUntraced(function* () {
      const now = Date.now()
      const idle = [...cache.entries()]
        .filter(([, entry]) => entry.refs === 0)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

      const stale = idle.filter(([, entry]) => now - entry.lastUsed > INSTANCE_IDLE_MS)
      const overflow = idle.slice(0, Math.max(0, cache.size - INSTANCE_MAX))
      const targets = new Set([...stale, ...overflow])

      for (const [directory, entry] of targets) {
        if (cache.get(directory) !== entry || entry.refs > 0) continue
        const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
        if (Exit.isFailure(exit)) {
          yield* removeEntry(directory, entry).pipe(Effect.asVoid)
          continue
        }
        yield* disposeEntry(directory, entry, exit.value).pipe(Effect.ignore)
      }
    })

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep("60 seconds")
          yield* reap().pipe(Effect.catchCause((cause) => Effect.logWarning("instance reap failed", { cause })))
        }
      }),
    )

    const provide = <A, E, R>(input: LoadInput, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      load(input).pipe(Effect.flatMap((ctx) => effect.pipe(Effect.provideService(InstanceRef, ctx))))

    yield* Effect.addFinalizer(() => disposeAll().pipe(Effect.ignore))

    return Service.of({
      load,
      reload,
      dispose,
      disposeDirectory,
      disposeAll,
      provide,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Project.defaultLayer))

export const node = LayerNode.make(layer, [Project.node, InstanceBootstrapGraph.node])

export * as InstanceStore from "./instance-store"
