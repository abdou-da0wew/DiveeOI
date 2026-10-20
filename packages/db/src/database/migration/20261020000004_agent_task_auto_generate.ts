import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { DatabaseMigration } from "../migration"

// A task can ask the generator agent to write its own spec before it runs.
// The flag is stored so the runner can pick the task up and generate it, even
// when the task was created from outside a request (by an agent, through the
// task tools). The generator clears it once it has written the spec.
export default {
  id: "20261020000004_agent_task_auto_generate",
  up(tx) {
    return Effect.gen(function* () {
      const info = yield* tx.all<{ name: string }>(sql`PRAGMA table_info('agent_task')`)
      const existing = new Set((info ?? []).map((column) => column.name))
      if (!existing.has("auto_generate")) {
        yield* tx.run(sql.raw(`ALTER TABLE \`agent_task\` ADD COLUMN \`auto_generate\` integer NOT NULL DEFAULT 0`))
      }
    })
  },
} satisfies DatabaseMigration.Migration
