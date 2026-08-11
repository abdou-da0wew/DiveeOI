import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Effect, Layer, Scope, Context } from "effect"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ShareNext } from "./share-next"
import { SessionMemoryIntegration } from "@/session/memory"
import { MemoryError } from "@diveeoi/memory/schema"
import { MemoryConfig } from "@diveeoi/memory"
import { Memory } from "@diveeoi/memory"

export interface Interface {
  readonly create: (input?: Session.CreateInput) => Effect.Effect<Session.Info, MemoryError, MemoryConfig>
  readonly share: (sessionID: SessionID) => Effect.Effect<{ url: string }, unknown>
  readonly unshare: (sessionID: SessionID) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionShare") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const session = yield* Session.Service
    const shareNext = yield* ShareNext.Service
    const memory = yield* SessionMemoryIntegration.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service

    const share = Effect.fn("SessionShare.share")(function* (sessionID: SessionID) {
      const conf = yield* cfg.get()
      if (conf.share === "disabled") throw new Error("Sharing is disabled in configuration")
      const result = yield* shareNext.create(sessionID)
      yield* session.setShare({ sessionID, share: { url: result.url } })
      return result
    })

    const unshare = Effect.fn("SessionShare.unshare")(function* (sessionID: SessionID) {
      yield* shareNext.remove(sessionID)
      yield* session.setShare({ sessionID, share: undefined })
    })

    const create = Effect.fn("SessionShare.create")(function* (input?: Session.CreateInput) {
      const result = yield* session.create(input)
      if (result.parentID) return result
      const conf = yield* cfg.get()
      if (!(flags.autoShare || conf.share === "auto")) return result
      yield* share(result.id).pipe(Effect.ignore, Effect.forkIn(scope))
      return result
    })

    const createWithMemory: Interface["create"] = Effect.fn("SessionShare.createWithMemory")(function* (input?: Session.CreateInput) {
      const result = yield* session.create(input)
      if (result.parentID) return result
      // Initialize session memory
      yield* memory.initializeSessionMemory(result.id, result.title)
      const conf = yield* cfg.get()
      if (!(flags.autoShare || conf.share === "auto")) return result
      yield* share(result.id).pipe(Effect.ignore, Effect.forkIn(scope))
      return result
    })

    return Service.of({ create: createWithMemory, share, unshare })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(ShareNext.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
  Layer.provide(SessionMemoryIntegration.defaultLayer),
)

export const node = LayerNode.make(layer, [
  Config.node,
  Session.node,
  ShareNext.node,
  RuntimeFlags.node,
  Memory.node,
  SessionMemoryIntegration.node,
])

export * as SessionShare from "./session"
