import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const PreferenceTable = sqliteTable("preference", {
  scope: text().notNull(),
  name: text().notNull(),
  value: text().notNull(),
  time_created: integer().notNull().$default(() => Date.now()),
  time_updated: integer().notNull().$onUpdate(() => Date.now()),
})
