import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260922000001_agent_foundations",
  up(tx) {
    return Effect.gen(function* () {
      // P1 — linktree anchors: the compact index; original messages are never deleted.
      yield* tx.run(`
        CREATE TABLE \`session_anchor\` (
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
      yield* tx.run(`CREATE INDEX \`session_anchor_session_idx\` ON \`session_anchor\` (\`session_id\`, \`epoch\` DESC);`)
      yield* tx.run(`
        CREATE TABLE \`session_anchor_ref\` (
          \`anchor_id\` text NOT NULL,
          \`ref\` text NOT NULL,
          \`section\` text NOT NULL,
          \`label\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          CONSTRAINT \`fk_session_anchor_ref_anchor_id_session_anchor_id_fk\` FOREIGN KEY (\`anchor_id\`) REFERENCES \`session_anchor\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_anchor_ref_anchor_idx\` ON \`session_anchor_ref\` (\`anchor_id\`);`)
      // P1 — retrieval: unicode61 (porter mangles identifiers); identifier boundary-splitting
      // is done in JS at index time (raw + camelCase-split copies).
      yield* tx.run(`
        CREATE VIRTUAL TABLE \`session_content_fts\` USING fts5(
          session_id UNINDEXED, ref UNINDEXED, text,
          tokenize = 'unicode61 remove_diacritics 2'
        );
      `)
      // P4 — crash-safe replay: committed tool calls are never re-executed on resume.
      yield* tx.run(`
        CREATE TABLE \`agent_task_call\` (
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
      // P4 — persisted, restartable agent tasks.
      yield* tx.run(`
        CREATE TABLE \`agent_task\` (
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
      yield* tx.run(`CREATE INDEX \`agent_task_status_idx\` ON \`agent_task\` (\`status\`, \`auto_run\`);`)
      yield* tx.run(`
        CREATE TABLE \`agent_task_event\` (
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
      yield* tx.run(`CREATE INDEX \`agent_task_event_task_idx\` ON \`agent_task_event\` (\`task_id\`, \`fired_at\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
