import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { DatabaseMigration } from "../migration"

// A task records who made it: "user" (from the tasks tab) or "agent" (an agent
// created it inside a session, with `creator_agent` naming which one).
export default {
  id: "20261020000003_agent_task_source",
  up(tx) {
    return Effect.gen(function* () {
      const info = yield* tx.all<{ name: string }>(sql`PRAGMA table_info('agent_task')`)
      const existing = new Set((info ?? []).map((column) => column.name))
      if (!existing.has("source")) {
        yield* tx.run(sql.raw(`ALTER TABLE \`agent_task\` ADD COLUMN \`source\` text NOT NULL DEFAULT 'user'`))
      }
      if (!existing.has("creator_agent")) {
        yield* tx.run(sql.raw(`ALTER TABLE \`agent_task\` ADD COLUMN \`creator_agent\` text`))
      }
    })
  },
} satisfies DatabaseMigration.Migration
