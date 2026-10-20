import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { DatabaseMigration } from "../migration"

// Tasks became real: a task is executed by the runner, and a task can carry
// its own schedule so it re-runs on a cron expression without anybody
// re-triggering it. The columns here back the schedule, the model pair
// (big model for the work, small model for the cheap side-channel work) and
// the agent that runs it.
//
// SQLite has no "ADD COLUMN IF NOT EXISTS", so each column is added only when
// the table does not have it yet.
export default {
  id: "20261020000001_agent_task_scheduling",
  up(tx) {
    return Effect.gen(function* () {
      const columns = [
        "agent",
        "directory",
        "big_prompt",
        "small_prompt",
        "small_provider_id",
        "small_model_id",
        "schedule",
        "next_run_at",
        "last_run_at",
        "run_count",
      ] as const

      const info = yield* tx.all<{ name: string }>(sql`PRAGMA table_info('agent_task')`)
      const existing = new Set((info ?? []).map((column) => column.name))

      for (const column of columns) {
        if (existing.has(column)) continue
        const definition =
          column === "agent"
            ? "text NOT NULL DEFAULT 'build'"
            : column === "run_count"
              ? "integer NOT NULL DEFAULT 0"
              : column === "directory" || column === "schedule" || column.startsWith("prompt")
                ? "text"
                : "integer"
        yield* tx.run(sql.raw(`ALTER TABLE \`agent_task\` ADD COLUMN \`${column}\` ${definition}`))
      }

      yield* tx.run(
        sql.raw(`CREATE INDEX IF NOT EXISTS \`agent_task_schedule_idx\` ON \`agent_task\` (\`next_run_at\`)`),
      )
    })
  },
} satisfies DatabaseMigration.Migration
