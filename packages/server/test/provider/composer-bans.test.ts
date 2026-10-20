import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@diveeoi/db/database/database"
import { Prefs } from "@diveeoi/db/prefs"
import { Composer } from "../../src/provider/composer"
import { ComposerBans } from "../../src/provider/composer-bans"

const layer = Layer.mergeAll(
  ComposerBans.layer.pipe(Layer.provide(Database.layerFromPath(":memory:"))),
)

describe("ComposerBans", () => {
  it("reads the bans back after a restart", () =>
    Effect.gen(function* () {
      Composer.reset()
      const until = Date.now() + Composer.BAN_MS
      // A ban that a previous process wrote.
      yield* Prefs.Service.set("composer", "banned-models", JSON.stringify({ "opencode/big-pickle": until }))

      yield* ComposerBans.load

      expect(Composer.isBanned("opencode", "big-pickle")).toBe(true)
      Composer.reset()
    }).pipe(Effect.provide(layer)),
  )

  it("writes a ban to the database", () =>
    Effect.gen(function* () {
      Composer.reset()
      const prefs = yield* Prefs.Service

      Composer.recordFailure("opencode", "big-pickle")
      // The listener writes through a forked effect; give it a turn.
      yield* Effect.sleep("50 millis")

      const stored = yield* prefs.get("composer", "banned-models")
      expect(stored).toBeDefined()
      expect(stored).toContain("opencode/big-pickle")
      Composer.reset()
    }).pipe(Effect.provide(layer)),
  )
})
