import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260711000002_add_preferences",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`preference\` (
          \`scope\` text NOT NULL,
          \`name\` text NOT NULL,
          \`value\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          PRIMARY KEY (\`scope\`, \`name\`)
        );
      `)
      yield* tx.run(`CREATE INDEX \`preference_scope_idx\` ON \`preference\` (\`scope\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
