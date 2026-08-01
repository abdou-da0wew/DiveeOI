import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { SessionID } from "./schema"
import { Effect, Layer, Context, Schema } from "effect"
import { Database } from "@diveeoi/db/database/database"
import { eq } from "drizzle-orm"
import { desc } from "drizzle-orm"
import { ReminderTable } from "@diveeoi/db/session/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@diveeoi/db/event"
import type { BudgetTier } from "./context-budget"
import crypto from "node:crypto"

export const Info = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  createdBy: Schema.String,
  priority: Schema.String,
  tags: Schema.Array(Schema.String),
  done: Schema.Boolean,
  createdAt: Schema.Number,
})
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Updated: EventV2.define({
    type: "reminder.updated",
    schema: {
      sessionID: SessionID,
      reminders: Schema.Array(Info),
    },
  }),
}

export interface Interface {
  readonly add: (input: {
    sessionID: SessionID
    text: string
    createdBy: string
    priority: string
    tags: string[]
  }) => Effect.Effect<Info>
  readonly list: (sessionID: SessionID) => Effect.Effect<ReadonlyArray<Info>>
  readonly markDone: (id: string) => Effect.Effect<void>
  readonly remove: (id: string) => Effect.Effect<void>
  readonly format: (reminders: ReadonlyArray<Info>, tier: BudgetTier) => string
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/SessionReminder") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service

    const add = Effect.fn("SessionReminder.add")(function* (input: {
      sessionID: SessionID
      text: string
      createdBy: string
      priority: string
      tags: string[]
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
      const reminders = yield* list(input.sessionID)
      yield* events.publish(Event.Updated, { sessionID: input.sessionID, reminders })
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

    const list = Effect.fn("SessionReminder.list")(function* (sessionID: SessionID) {
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

    const format = (reminders: ReadonlyArray<Info>, tier: BudgetTier): string => {
      switch (tier) {
        case "critically-limited":
          return ""
        case "tight": {
          const high = reminders.filter((r) => !r.done && r.priority === "high")
          if (high.length === 0) return ""
          return `<reminders>HIGH PRIORITY: ${high.map((r) => r.text).join("; ")}</reminders>`
        }
        case "normal": {
          const active = reminders.filter((r) => !r.done)
          if (active.length === 0) return ""
          const items = active.map(
            (r) => `  <item id="${r.id}" priority="${r.priority}">${r.text}</item>`,
          )
          return `<reminders>\n${items.join("\n")}\n</reminders>`
        }
        default: {
          if (reminders.length === 0) return ""
          const items = reminders.map((r) => {
            const doneAttr = r.done ? ` done="true"` : ""
            return `  <item id="${r.id}" priority="${r.priority}"${doneAttr}>${r.text}</item>`
          })
          return `<reminders>\n${items.join("\n")}\n</reminders>`
        }
      }
    }

    return Service.of({ add, list, markDone, remove, format })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer), Layer.provide(Database.defaultLayer))

export const node = LayerNode.make(layer, [EventV2Bridge.node, Database.node])

export * as Reminders from "./reminders"
