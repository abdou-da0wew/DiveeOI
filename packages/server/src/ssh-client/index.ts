import { createHash } from "node:crypto"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { createConnection } from "./connection"
import type { Connection, Interface, RemoteConfig } from "./types"

export * from "./types"

export class Service extends Context.Service<Service, Interface>()("@diveeoi/RemoteSession") {}

const connectionKey = (config: RemoteConfig) => {
  const auth =
    config.auth.kind === "password"
      ? config.auth.password
      : config.auth.kind === "privateKey"
        ? `${config.auth.keyPath}:${config.auth.passphrase ?? ""}`
        : (config.auth.socketPath ?? process.env.SSH_AUTH_SOCK ?? "")
  const identity = createHash("sha256").update(auth).digest("hex")
  return [
    config.identity ?? "",
    config.host.toLowerCase(),
    config.port,
    config.user.toLowerCase(),
    config.auth.kind,
    identity,
  ].join(":")
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const pool = new Map<string, { connection: Connection; refCount: number }>()

    const acquire = (config: RemoteConfig) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const key = connectionKey(config)
          const current = pool.get(key)
          if (current) {
            current.refCount++
            return current.connection
          }
          const connection = yield* Effect.tryPromise({
            try: () => createConnection(config),
            catch: (error) => error as Error,
          })
          pool.set(key, { connection, refCount: 1 })
          return connection
        }),
        (connection) =>
          Effect.sync(() => {
            const key = connectionKey(connection.config)
            const current = pool.get(key)
            if (!current) return
            current.refCount--
            if (current.refCount <= 0) {
              pool.delete(key)
              void Effect.runPromise(connection.close().pipe(Effect.catch(() => Effect.void)))
            }
          }),
      )

    const has = (config: RemoteConfig) => Effect.sync(() => pool.has(connectionKey(config)))

    const probe: Interface["probe"] = (config) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => createConnection(config),
          catch: (error) => error as Error,
        }),
        (connection) =>
          Effect.gen(function* () {
            const homeDirectory = yield* connection.sftp().pipe(
              Effect.flatMap((sftp) => sftp.realpath(".")),
              Effect.catch(() => Effect.succeed("/")),
            )
            const result = yield* connection.exec("uname -s && uname -m", { cwd: "/" }).pipe(
              Effect.timeout("10 seconds"),
              Effect.catch(() => Effect.succeed(null)),
            )
            if (result?.exitCode !== 0) {
              return { ok: false as const, reason: result?.stderr || "Remote command failed" }
            }
            const platform: NodeJS.Platform = result.stdout.includes("Darwin") ? "darwin" : "linux"
            return { ok: true as const, platform, homeDirectory }
          }).pipe(Effect.catch((error) => Effect.succeed({ ok: false as const, reason: String(error) }))),
        (connection) => connection.close().pipe(Effect.catch(() => Effect.void)),
      ).pipe(Effect.catch((error) => Effect.succeed({ ok: false as const, reason: String(error) })))

    return Service.of({ acquire, has, probe })
  }),
)

export const defaultLayer = layer
export const node = LayerNode.make(layer, [])

export * as RemoteSession from "./index"
