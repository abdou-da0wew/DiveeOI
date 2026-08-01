export * as Prefs from "./prefs"

import { eq, and } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "./database/database"
import { PreferenceTable } from "./prefs/sql"

export interface Interface {
  /** Get a preference value by scope and name. Returns undefined if not found. */
  readonly get: (scope: string, name: string) => Effect.Effect<string | undefined>
  /** Set a preference value (upsert). */
  readonly set: (scope: string, name: string, value: string) => Effect.Effect<void>
  /** List all preferences for a scope. */
  readonly list: (scope: string) => Effect.Effect<Array<{ name: string; value: string }>>
  /** Delete a single preference. */
  readonly delete: (scope: string, name: string) => Effect.Effect<void>
  /** Delete all preferences for a scope. */
  readonly deleteScope: (scope: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Prefs") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    return Service.of({
      get: Effect.fn("Prefs.get")(function* (scope, name) {
        const row = yield* db
          .select()
          .from(PreferenceTable)
          .where(and(eq(PreferenceTable.scope, scope), eq(PreferenceTable.name, name)))
          .get()
          .pipe(Effect.orDie)
        return row?.value ?? undefined
      }),

      set: Effect.fn("Prefs.set")(function* (scope, name, value) {
        yield* db
          .insert(PreferenceTable)
          .values({ scope, name, value })
          .onConflictDoUpdate({ target: [PreferenceTable.scope, PreferenceTable.name], set: { value } })
          .run()
          .pipe(Effect.orDie)
      }),

      list: Effect.fn("Prefs.list")(function* (scope) {
        const rows = yield* db
          .select()
          .from(PreferenceTable)
          .where(eq(PreferenceTable.scope, scope))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => ({ name: row.name, value: row.value }))
      }),

      delete: Effect.fn("Prefs.delete")(function* (scope, name) {
        yield* db
          .delete(PreferenceTable)
          .where(and(eq(PreferenceTable.scope, scope), eq(PreferenceTable.name, name)))
          .run()
          .pipe(Effect.orDie)
      }),

      deleteScope: Effect.fn("Prefs.deleteScope")(function* (scope) {
        yield* db.delete(PreferenceTable).where(eq(PreferenceTable.scope, scope)).run().pipe(Effect.orDie)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
