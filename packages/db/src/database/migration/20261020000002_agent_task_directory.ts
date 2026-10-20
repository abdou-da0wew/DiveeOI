import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { DatabaseMigration } from "../migration"

// The task needs to remember the project directory it belongs to: the runner
// executes the task outside any request, so it cannot ask the session for the
// directory once the request context is gone.
export default {
  id: "20261020000002_agent_task_directory",
  up(tx) {
    return Effect.gen(function* () {
      const info = yield* tx.all<{ name: string }>(sql`PRAGMA table_info('agent_task')`)
      const existing = new Set((info ?? []).map((column) => column.name))
      if (!existing.has("directory")) {
        yield* tx.run(sql.raw(`ALTER TABLE \`agent_task\` ADD COLUMN \`directory\` text`))
      }
      if (!existing.has("source")) {
        yield* tx.run(sql.raw(`ALTER TABLE \`agent_task\` ADD COLUMN \`source\` text NOT NULL DEFAULT 'user'`))
      }
      if (!existing.has("creator_agent")) {
        yield* tx.run(sql.raw(`ALTER TABLE \`agent_task\` ADD COLUMN \`creator_agent\` text`))
      }
    })
  },
} satisfies DatabaseMigration.Migration
