import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261103001500_bootstrap_anchor_content_fts",
  bootstrap: true,
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS \`session_content_fts\` USING fts5(
          session_id UNINDEXED, ref UNINDEXED, text,
          tokenize = 'unicode61 remove_diacritics 2'
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
