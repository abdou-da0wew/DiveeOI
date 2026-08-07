export * as Database from "./database"

import { EffectDrizzleSqlite } from "@diveeoi/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "./sqlite.bun"
import { Cause, Context, Duration, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { LayerNode } from "../effect/layer-node"
import { makeAdaptiveLayer, useAdaptiveTargets } from "../adaptive/hooks"
import { node as AdaptiveResourceNode } from "../adaptive/service"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

export const layer = makeAdaptiveLayer((targets) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const db = yield* makeDatabase

      yield* db.run("PRAGMA journal_mode = WAL")
      yield* db.run("PRAGMA synchronous = NORMAL")
      yield* db.run("PRAGMA busy_timeout = 5000")
      yield* db.run(`PRAGMA cache_size = -${targets.sqliteCacheMB * 1000}`)
      yield* db.run(`PRAGMA mmap_size = ${targets.sqliteCacheMB * 2 * 1024 * 1024}`)
      yield* db.run("PRAGMA foreign_keys = ON")
      yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
      yield* DatabaseMigration.apply(db)

      return { db }
    }).pipe(Effect.orDie),
  ),
)

// Fails with Error("DB query timeout") when the effect exceeds the adaptive query timeout.
export const withDbQueryTimeout = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
  useAdaptiveTargets((targets) =>
    Effect.timeout(Duration.millis(targets.dbQueryTimeoutMs))(eff).pipe(
      Effect.mapError((error) => (Cause.isTimeoutError(error) ? new Error("DB query timeout") : error)),
    ),
  )

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, "opencode.db")
  return join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const defaultLayer = Layer.unwrap(
  Effect.gen(function* () {
    return layerFromPath(path())
  }),
).pipe(Layer.provide(Global.defaultLayer))

export const node = LayerNode.make(layerFromPath(path()), [AdaptiveResourceNode])
