import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Database } from "@diveeoi/db/database/database"
import { Flag } from "@diveeoi/db/flag/flag"
import { sql } from "drizzle-orm"

export const Parameters = Schema.Struct({
  format: Schema.Literals(["json", "sql"]).pipe(Schema.withDecodingDefault(Effect.succeed("json" as const))),
  limit: Schema.optional(Schema.Number).annotate({ description: "Number of rows per table (1-200, default 50)" }),
})

type Metadata = {
  tableCount: number
  format: string
}

export const DbExportTool = Tool.define(
  "db-export",
  Effect.gen(function* () {
    const database = yield* Database.Service

    return {
      description: "Export the project database contents in JSON or SQL format. Gated behind OPENCODE_EXPERIMENTAL_DB_EXPORT=true.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          if (!Flag.experimentalDbExport) {
            return {
              title: "Database export (disabled)",
              output: "Database export is disabled. Set OPENCODE_EXPERIMENTAL_DB_EXPORT=true to enable.",
              metadata: { tableCount: 0, format: "" },
            }
          }

          const limit = params.limit ?? 50
          const db = database.db

          if (params.format === "sql") {
            const rows = yield* db.all<{ name: string; sql: string | null }>(
              sql`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
            )
            const schemas = rows.map((r) => `-- ${r.name}\n${r.sql ?? ""};`).join("\n\n")
            return {
              title: "Database schema export",
              output: schemas,
              metadata: { tableCount: rows.length, format: "sql" },
            }
          }

          const tables = yield* db.all<{ name: string }>(
            sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
          )

          const tableData: Record<string, unknown[]> = {}
          for (const { name } of tables) {
            const rows = yield* db.all<Record<string, unknown>>(
              sql`SELECT * FROM ${sql.identifier(name)} LIMIT ${limit}`,
            )
            tableData[name] = rows
          }

          const output = JSON.stringify(
            { exportedAt: new Date().toISOString(), tableCount: tables.length, tables: tableData },
            null,
            2,
          )

          return {
            title: `Database export (${tables.length} tables, up to ${limit} rows each)`,
            output,
            metadata: { tableCount: tables.length, format: "json" },
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
