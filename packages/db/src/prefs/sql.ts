import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core"

export const PreferenceTable = sqliteTable("preference", {
  scope: text().notNull(),
  name: text().notNull(),
  value: text().notNull(),
  time_created: integer().notNull().$default(() => Date.now()),
  time_updated: integer().notNull().$onUpdate(() => Date.now()),
}, (table) => [primaryKey({ columns: [table.scope, table.name] })])
