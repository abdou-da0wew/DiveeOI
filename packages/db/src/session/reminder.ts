import { desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import crypto from "node:crypto"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { ReminderTable } from "./sql"

export const Info = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  createdBy: Schema.String,
  priority: Schema.String,
  tags: Schema.Array(Schema.String),
  done: Schema.Boolean,
  createdAt: Schema.Number,
})
export type Info = typeof Info.Type

export const Event = {
  Updated: EventV2.define({
    type: "reminder.updated",
    schema: {
      sessionID: SessionSchema.ID,
      reminders: Schema.Array(Info),
    },
  }),
}

export interface Interface {
  readonly add: (input: {
    readonly sessionID: SessionSchema.ID
    readonly text: string
    readonly createdBy: string
    readonly priority: string
    readonly tags: string[]
  }) => Effect.Effect<Info>
  readonly list: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
  readonly markDone: (id: string) => Effect.Effect<void>
  readonly remove: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/v2/SessionReminder") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const add = Effect.fn("SessionReminder.add")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly text: string
      readonly createdBy: string
      readonly priority: string
      readonly tags: string[]
    }) {
      const id = crypto.randomUUID()
      const createdAt = Date.now()
      yield* db
        .insert(ReminderTable)
        .values({
          id,
          session_id: input.sessionID,
          text: input.text,
          created_by: input.createdBy,
          priority: input.priority,
          tags: input.tags,
          done: 0,
          time_created: createdAt,
        })
        .run()
        .pipe(Effect.orDie)
      yield* events.publish(Event.Updated, {
        sessionID: input.sessionID,
        reminders: yield* list(input.sessionID),
      })
      return {
        id,
        text: input.text,
        createdBy: input.createdBy,
        priority: input.priority,
        tags: input.tags,
        done: false,
        createdAt,
      } as Info
    })

    const list = Effect.fn("SessionReminder.list")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .select()
        .from(ReminderTable)
        .where(eq(ReminderTable.session_id, sessionID))
        .orderBy(desc(ReminderTable.time_created))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => ({
        id: row.id,
        text: row.text,
        createdBy: row.created_by,
        priority: row.priority,
        tags: row.tags ?? [],
        done: row.done === 1,
        createdAt: row.time_created,
      }))
    })

    const markDone = Effect.fn("SessionReminder.markDone")(function* (id: string) {
      yield* db
        .update(ReminderTable)
        .set({ done: 1 })
        .where(eq(ReminderTable.id, id))
        .run()
        .pipe(Effect.orDie)
    })

    const remove = Effect.fn("SessionReminder.remove")(function* (id: string) {
      yield* db
        .delete(ReminderTable)
        .where(eq(ReminderTable.id, id))
        .run()
        .pipe(Effect.orDie)
    })

    return Service.of({ add, list, markDone, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))

export * as SessionReminder from "./reminder"
