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
import { ProviderFreeTier } from "./free-tier"

const SCOPE = "composer"
const NAME = "banned-models"
const WORKING_NAME = "working-models"
const QUOTA_NAME = "provider-quota-cooldowns"

export const layer = Prefs.layer.pipe(Layer.provide(Database.defaultLayer))

/** Read the bans back and hand them to the router. */
export const load = Effect.gen(function* () {
  const prefs = yield* Prefs.Service
  const [rawBans, rawWorking, rawQuotas] = yield* Effect.all([
    prefs.get(SCOPE, NAME),
    prefs.get(SCOPE, WORKING_NAME),
    prefs.get(SCOPE, QUOTA_NAME),
  ])
  try {
    if (rawBans) Composer.restoreBans(JSON.parse(rawBans) as Record<string, number>)
  } catch {
    // A corrupt list is not worth failing the boot over: the router simply starts fresh.
  }
  try {
    if (rawWorking) {
      Composer.restoreWorkingModels(JSON.parse(rawWorking) as Record<string, { count: number; lastAt: number }>)
    }
  } catch {
    // Ignore corrupt health history and rebuild it from successful turns.
  }
  try {
    if (rawQuotas) ProviderFreeTier.restoreQuotaCooldowns(JSON.parse(rawQuotas) as Record<string, number>)
  } catch {
    // A bad quota cache should not block server startup.
  }
})

/** Write the current bans back to the database. */
export const save = Effect.gen(function* () {
  const prefs = yield* Prefs.Service
  const bans = Composer.activeBans()
  const working = Composer.workingModels()
  const quotas = ProviderFreeTier.quotaCooldowns()
  if (Object.keys(bans).length === 0) yield* prefs.delete(SCOPE, NAME)
  else yield* prefs.set(SCOPE, NAME, JSON.stringify(bans))
  if (Object.keys(working).length === 0) yield* prefs.delete(SCOPE, WORKING_NAME)
  else yield* prefs.set(SCOPE, WORKING_NAME, JSON.stringify(working))
  if (Object.keys(quotas).length === 0) yield* prefs.delete(SCOPE, QUOTA_NAME)
  else yield* prefs.set(SCOPE, QUOTA_NAME, JSON.stringify(quotas))
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
        const working = Composer.workingModels()
        if (Object.keys(working).length === 0) yield* prefs.delete(SCOPE, WORKING_NAME)
        else yield* prefs.set(SCOPE, WORKING_NAME, JSON.stringify(working))
      }).pipe(
        Effect.provide(layer),
        Effect.catchCause((cause) => Effect.logWarning("could not persist the model ban", { model, cause })),
      ),
    )
  })
  ProviderFreeTier.onQuotaCooldown((providerID, until) => {
    void Effect.runFork(
      Effect.gen(function* () {
        const prefs = yield* Prefs.Service
        const quotas = ProviderFreeTier.quotaCooldowns()
        quotas[providerID] = until
        yield* prefs.set(SCOPE, QUOTA_NAME, JSON.stringify(quotas))
      }).pipe(
        Effect.provide(layer),
        Effect.catchCause((cause) =>
          Effect.logWarning("could not persist free-provider quota cooldown", { providerID, cause }),
        ),
      ),
    )
  })
  Composer.onSuccess((model, record) => {
    void Effect.runFork(
      Effect.gen(function* () {
        const prefs = yield* Prefs.Service
        const working = Composer.workingModels()
        working[model] = record
        const entries = Object.entries(working)
          .sort((a, b) => b[1].lastAt - a[1].lastAt)
          .slice(0, 500)
        yield* prefs.set(SCOPE, WORKING_NAME, JSON.stringify(Object.fromEntries(entries)))
      }).pipe(
        Effect.provide(layer),
        Effect.catchCause((cause) => Effect.logWarning("could not persist Composer model health", { model, cause })),
      ),
    )
  })
})

export * as ComposerBans from "./composer-bans"
