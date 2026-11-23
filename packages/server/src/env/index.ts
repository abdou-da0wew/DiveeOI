import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { serviceUse } from "@diveeoi/db/effect/service-use"

type State = Record<string, string | undefined>

export interface Interface {
  readonly get: (key: string) => Effect.Effect<string | undefined>
  readonly all: () => Effect.Effect<State>
  readonly set: (key: string, value: string) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/Env") {}

export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const get = Effect.fn("Env.get")((key: string) => Effect.sync(() => process.env[key]))
    const all = Effect.fn("Env.all")(() => Effect.sync(() => ({ ...process.env })))
    // Runtime contract: Env mutates the real process.env. (The first Env
    // implementation worked on a shallow copy, which is why provider loaders
    // historically reached around this service — with the real contract the
    // service is the single sanctioned mutation seam.) The Effects are yielded
    // so the mutation actually runs; an earlier revision built Effect.sync
    // without yielding, making set/remove silent no-ops.
    const set = Effect.fn("Env.set")(function* (key: string, value: string) {
      yield* Effect.sync(() => {
        process.env[key] = value
      })
    })
    const remove = Effect.fn("Env.remove")(function* (key: string) {
      yield* Effect.sync(() => {
        delete process.env[key]
      })
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as Env from "."
