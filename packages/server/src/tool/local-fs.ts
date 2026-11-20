// LocalFS stays bound to the local machine even when a session uses SSH.
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { FSUtil } from "@diveeoi/db/fs-util"

export type LocalFSShape = FSUtil.Interface

export class Service extends Context.Service<Service, LocalFSShape>()("@diveeoi/LocalFS") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of(yield* FSUtil.Service)
  }),
).pipe(Layer.provide(FSUtil.defaultLayer))

export const node = LayerNode.make(layer, [FSUtil.node])

export * as LocalFS from "./local-fs"
