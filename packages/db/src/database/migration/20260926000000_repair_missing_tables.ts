import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { DatabaseMigration } from "../migration"

/**
 * Repair migration.
 *
 * Several tables that the runtime reads and writes were only ever declared in their own
 * migration files and never made it into the generated fresh-install schema
 * (`schema.gen.ts`). `DatabaseMigration.apply` marks every migration as applied when it
 * bootstraps an empty database (`schema.up()` + journal seed), so on any fresh install —
 * and on every install created before those migrations existed — these tables were never
 * created while being marked as done. Symptoms: `no such table: reminder` when a prompt
 * builds its system block, `no such table: user` in auth, missing agent-task/anchor tables.
 *
 * Every statement is `IF NOT EXISTS`, so this is a no-op on a healthy database and a repair
 * on a broken one. The same DDL is mirrored into `schema.gen.ts` so new installs are correct
 * from the start.
 */
export default {
  id: "20260926000000_repair_missing_tables",
  up(tx) {
    return Effect.gen(function* () {
      // 20260711000001_add_reminders
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`reminder\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`text\` text NOT NULL,
          \`created_by\` text NOT NULL DEFAULT 'agent',
          \`priority\` text NOT NULL DEFAULT 'medium',
          \`tags\` text,
          \`done\` integer NOT NULL DEFAULT 0,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_reminder_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`reminder_session_idx\` ON \`reminder\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`reminder_done_idx\` ON \`reminder\` (\`done\`);`)

      // 20260729000001_add_users
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`user\` (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL UNIQUE,
          \`password_hash\` text NOT NULL,
          \`role\` text NOT NULL DEFAULT 'user',
          \`verified\` integer NOT NULL DEFAULT 0,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`verification_token\` (
          \`id\` text PRIMARY KEY,
          \`user_id\` text NOT NULL REFERENCES \`user\`(\`id\`) ON DELETE CASCADE,
          \`token\` text NOT NULL UNIQUE,
          \`type\` text NOT NULL,
          \`expires_at\` integer NOT NULL,
          \`used\` integer NOT NULL DEFAULT 0
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`idx_user_email\` ON \`user\` (\`email\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`idx_verification_token_token\` ON \`verification_token\` (\`token\`);`)

      // 20260729000002_add_username_message_count: additive columns. `ADD COLUMN` has no
      // IF NOT EXISTS form in SQLite, so only issue the ones actually missing.
      for (const [column, ddl] of [
        ["username", `ALTER TABLE \`user\` ADD COLUMN \`username\` text NOT NULL DEFAULT '';`],
        ["message_count", `ALTER TABLE \`user\` ADD COLUMN \`message_count\` integer NOT NULL DEFAULT 0;`],
      ] as const) {
        const existing = yield* tx
          .all<{ name: string }>(sql`SELECT name FROM pragma_table_info('user')`)
          .pipe(Effect.map((rows) => rows.map((row) => row.name)))
        if (existing.includes(column)) continue
        yield* tx.run(ddl)
      }

      // 20260922000001_agent_foundations
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`session_anchor\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`epoch\` integer NOT NULL,
          \`root_ref\` text NOT NULL,
          \`tree_json\` text NOT NULL,
          \`token_estimate\` integer,
          \`degraded\` integer NOT NULL DEFAULT 0,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_anchor_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`session_anchor_session_idx\` ON \`session_anchor\` (\`session_id\`, \`epoch\` DESC);`,
      )
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`session_anchor_ref\` (
          \`anchor_id\` text NOT NULL,
          \`ref\` text NOT NULL,
          \`section\` text NOT NULL,
          \`label\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          CONSTRAINT \`fk_session_anchor_ref_anchor_id_session_anchor_id_fk\` FOREIGN KEY (\`anchor_id\`) REFERENCES \`session_anchor\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`session_anchor_ref_anchor_idx\` ON \`session_anchor_ref\` (\`anchor_id\`);`)
      yield* tx.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS \`session_content_fts\` USING fts5(
          session_id UNINDEXED, ref UNINDEXED, text,
          tokenize = 'unicode61 remove_diacritics 2'
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`agent_task_call\` (
          \`task_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`tool\` text NOT NULL,
          \`args_hash\` text NOT NULL,
          \`status\` text NOT NULL,
          \`result_ref\` text,
          \`started_at\` integer,
          \`committed_at\` integer,
          PRIMARY KEY (\`task_id\`, \`seq\`),
          CONSTRAINT \`fk_agent_task_call_task_id_agent_task_id_fk\` FOREIGN KEY (\`task_id\`) REFERENCES \`agent_task\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`agent_task\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL UNIQUE,
          \`parent_session_id\` text,
          \`prompt\` text NOT NULL,
          \`provider_id\` text,
          \`model_id\` text,
          \`status\` text NOT NULL DEFAULT 'queued',
          \`auto_run\` integer NOT NULL DEFAULT 0,
          \`subagent_types\` text,
          \`event_hooks\` text,
          \`last_heartbeat\` integer,
          \`checkpoint_anchor_id\` text,
          \`worktree\` text,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_agent_task_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`agent_task_status_idx\` ON \`agent_task\` (\`status\`, \`auto_run\`);`)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`agent_task_event\` (
          \`id\` integer PRIMARY KEY AUTOINCREMENT,
          \`task_id\` text NOT NULL,
          \`trigger\` text NOT NULL,
          \`action\` text NOT NULL,
          \`payload\` text,
          \`status\` text,
          \`result\` text,
          \`fired_at\` integer NOT NULL,
          CONSTRAINT \`fk_agent_task_event_task_id_agent_task_id_fk\` FOREIGN KEY (\`task_id\`) REFERENCES \`agent_task\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`agent_task_event_task_idx\` ON \`agent_task_event\` (\`task_id\`, \`fired_at\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
