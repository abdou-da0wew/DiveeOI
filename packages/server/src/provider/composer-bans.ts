// packages/server/src/provider/composer-bans.ts
// Persisted model bans for DiveeComposer.
//
// A model that errors, or answers with nothing, is not used again for a day. That has to
// survive a restart: a user who restarts the server after a broken model failed should not
// be sent straight back to it. The bans live in the preference table, the router keeps the
// same list in memory for the decisions it makes between restarts.

import { Effect, Layer } from "effect"
import { Database } from "@diveeoi/db/database/database"
import { Prefs } from "@diveeoi/db/prefs"
import { Composer } from "./composer"

const SCOPE = "composer"
const NAME = "banned-models"

export const layer = Prefs.layer.pipe(Layer.provide(Database.defaultLayer))

/** Read the bans back and hand them to the router. */
export const load = Effect.gen(function* () {
  const prefs = yield* Prefs.Service
  const raw = yield* prefs.get(SCOPE, NAME)
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as Record<string, number>
    Composer.restoreBans(parsed)
  } catch {
    // A corrupt list is not worth failing the boot over: the router simply starts fresh.
  }
})

/** Write the current bans back to the database. */
export const save = Effect.gen(function* () {
  const prefs = yield* Prefs.Service
  const bans = Composer.activeBans()
  if (Object.keys(bans).length === 0) {
    yield* prefs.delete(SCOPE, NAME)
    return
  }
  yield* prefs.set(SCOPE, NAME, JSON.stringify(bans))
})

/**
 * Read the bans at boot and persist every new one.
 *
 * The listener writes through a forked effect: the router bans a model in the middle of a
 * turn, and that turn should not wait for a database write.
 */
export const register = Effect.gen(function* () {
  yield* load
  Composer.onBan((model, until) => {
    void Effect.runFork(
      Effect.gen(function* () {
        const prefs = yield* Prefs.Service
        const bans = Composer.activeBans()
        bans[model] = until
        yield* prefs.set(SCOPE, NAME, JSON.stringify(bans))
      }).pipe(
        Effect.provide(layer),
        Effect.catchCause((cause) => Effect.logWarning("could not persist the model ban", { model, cause })),
      ),
    )
  })
})

export * as ComposerBans from "./composer-bans"
