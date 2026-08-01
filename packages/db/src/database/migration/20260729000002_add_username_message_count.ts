import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260729000002_add_username_message_count",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`user\` ADD COLUMN \`username\` text NOT NULL DEFAULT '';`)
      yield* tx.run(`ALTER TABLE \`user\` ADD COLUMN \`message_count\` integer NOT NULL DEFAULT 0;`)
    })
  },
} satisfies DatabaseMigration.Migration