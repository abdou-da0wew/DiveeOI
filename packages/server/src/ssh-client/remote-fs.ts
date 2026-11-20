import { Effect, Layer } from "effect"
import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { FSUtil } from "@diveeoi/db/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { RemoteSession } from "./index"
import { makeSftpFs } from "./sftp-fs"

export const layer = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const local = yield* FSUtil.Service
    const remote = yield* RemoteSession.Service
    const state = yield* InstanceState.make((ctx) => {
      const remoteConfig = ctx.remote
      if (!remoteConfig) return Effect.succeed(local)
      return Effect.gen(function* () {
        const connection = yield* remote.acquire(remoteConfig)
        const sftp = yield* connection.sftp()
        return makeSftpFs(sftp, remoteConfig.platform ?? "linux", remoteConfig.workingDirectory ?? ctx.directory)
      })
    })

    const filesystem = new Proxy(local, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (property === "globMatch" || typeof value !== "function") return value
        return (...args: unknown[]) =>
          InstanceState.useEffect(state, (active) => {
            const method = Reflect.get(active, property)
            if (typeof method !== "function") {
              return Effect.fail(new Error(`Filesystem method ${String(property)} is unavailable`))
            }
            return method(...args)
          })
      },
    }) as FSUtil.Interface

    return FSUtil.Service.of(filesystem)
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provideMerge(Layer.mergeAll(FSUtil.defaultLayer, RemoteSession.defaultLayer)),
)

export const node = LayerNode.make(layer, [FSUtil.node, RemoteSession.node])

export * as RemoteFS from "./remote-fs"
