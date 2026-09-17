import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

// schema.gen.ts (the fresh-install snapshot used to create a brand new
// database in one shot) never had the `preference` table added when
// 20260711000002_add_preferences was written. Fresh installs since then
// got every migration marked as "completed" in the tracking table without
// the table actually being created, so 20260711000002 permanently looks
// done even though it never ran. This migration is idempotent so it heals
// those installs and is a harmless no-op for anyone whose table already
// exists.
export default {
  id: "20260918000001_heal_preference_table",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`preference\` (
          \`scope\` text NOT NULL,
          \`name\` text NOT NULL,
          \`value\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          PRIMARY KEY (\`scope\`, \`name\`)
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`preference_scope_idx\` ON \`preference\` (\`scope\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
