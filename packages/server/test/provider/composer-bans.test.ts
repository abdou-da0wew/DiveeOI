import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@diveeoi/db/database/database"
import { Prefs } from "@diveeoi/db/prefs"
import { Composer } from "../../src/provider/composer"
import { ComposerBans } from "../../src/provider/composer-bans"
import { testEffect } from "../lib/effect"

// The preference service over an in-memory database: the ban list is persisted, and the
// test must not touch the user's own database.
const it = testEffect(
  Layer.mergeAll(Prefs.layer.pipe(Layer.provide(Database.layerFromPath(":memory:")))),
)

describe("ComposerBans", () => {
  it.effect("reads the bans back after a restart", () =>
    Effect.gen(function* () {
      Composer.reset()
      const prefs = yield* Prefs.Service
      const until = Date.now() + Composer.BAN_MS
      // A ban a previous process wrote.
      yield* prefs.set("composer", "banned-models", JSON.stringify({ "opencode/big-pickle": until }))

      yield* ComposerBans.load

      expect(Composer.isBanned("opencode", "big-pickle")).toBe(true)
      Composer.reset()
    }),
  )

  it.effect("writes the current bans to the database", () =>
    Effect.gen(function* () {
      Composer.reset()
      const prefs = yield* Prefs.Service

      Composer.recordFailure("opencode", "big-pickle")
      yield* ComposerBans.save

      const stored = yield* prefs.get("composer", "banned-models")
      expect(stored).toBeDefined()
      expect(stored).toContain("opencode/big-pickle")
      Composer.reset()
    }),
  )

  it.effect("tells the writer when a model is banned", () =>
    Effect.gen(function* () {
      Composer.reset()
      const seen: Array<string> = []
      Composer.onBan((model) => seen.push(model))

      Composer.recordFailure("opencode", "big-pickle")
      expect(seen).toEqual(["opencode/big-pickle"])
      Composer.reset()
    }),
  )
})
