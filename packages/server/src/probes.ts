import { Effect } from "effect"
import { createRequire } from "node:module"

/**
 * Boot probes for optional subsystems (draft-10 P0).
 *
 * Each probe runs once at server startup and reports whether the underlying
 * capability is actually available in THIS runtime — before anything builds on
 * it. Results surface via `GET /global/features` (`probes`) and gate graceful
 * degradation:
 *   - fts5 unavailable -> P1 `search_memory` falls back to LIKE search.
 *   - ssh2 unavailable -> P7 skips binding; curl remains the guaranteed surface.
 */

export type ProbeStatus = "ok" | "unavailable"

export interface Probes {
  readonly fts5: ProbeStatus
  readonly ssh2: ProbeStatus
}

const probeFts5 = Effect.sync((): ProbeStatus => {
  // Match the db package's runtime conditional (#sqlite): bun:sqlite under Bun,
  // node:sqlite (DatabaseSync) under Node. Both bundle FTS5 when enabled.
  try {
    if (typeof Bun !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Database } = require("bun:sqlite") as typeof import("bun:sqlite")
      const db = new Database(":memory:", { create: true })
      try {
        db.run("CREATE VIRTUAL TABLE temp.probe_fts5 USING fts5(x)")
        return "ok"
      } finally {
        db.close()
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite")
    const db = new DatabaseSync(":memory:")
    try {
      db.exec("CREATE VIRTUAL TABLE temp.probe_fts5 USING fts5(x)")
      return "ok"
    } finally {
      db.close()
    }
  } catch {
    return "unavailable"
  }
})

const probeSsh2 = Effect.promise(async (): Promise<ProbeStatus> => {
  // ssh2 is an optional dependency (P7). Until it is installed the probe
  // reports unavailable and the SSH surface degrades to curl.
  try {
    const req = createRequire(import.meta.url)
    await import(req.resolve("ssh2"))
    return "ok"
  } catch {
    return "unavailable"
  }
})

export const detect: Effect.Effect<Probes> = Effect.gen(function* () {
  const [fts5, ssh2] = yield* Effect.all([probeFts5, probeSsh2], { concurrency: "unbounded" })
  return { fts5, ssh2 }
})

export const probes: Probes = await Effect.runPromise(detect).pipe(
  Effect.catch(() => Effect.succeed<Probes>({ fts5: "unavailable", ssh2: "unavailable" })),
)

export * as Probes from "./probes"
