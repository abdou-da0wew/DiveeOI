import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260711000001_add_reminders",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`reminder\` (
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
      yield* tx.run(`CREATE INDEX \`reminder_session_idx\` ON \`reminder\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`reminder_done_idx\` ON \`reminder\` (\`done\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
