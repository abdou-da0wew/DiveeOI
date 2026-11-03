import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261102220154_20261102000002_preference_primary_key",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        CREATE TABLE \`__new_preference\` (
          \`scope\` text NOT NULL,
          \`name\` text NOT NULL,
          \`value\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`preference_pk\` PRIMARY KEY(\`scope\`, \`name\`)
        );
      `)
      // The prior fresh-install snapshot omitted this key, so those databases may have duplicate
      // (scope, name) rows. Keep the most recently updated value before enforcing uniqueness.
      yield* tx.run(`INSERT INTO \`__new_preference\`(\`scope\`, \`name\`, \`value\`, \`time_created\`, \`time_updated\`)
        SELECT source.\`scope\`, source.\`name\`, source.\`value\`, source.\`time_created\`, source.\`time_updated\`
        FROM \`preference\` AS source
        WHERE NOT EXISTS (
          SELECT 1 FROM \`preference\` AS newer
          WHERE newer.\`scope\` = source.\`scope\` AND newer.\`name\` = source.\`name\`
            AND (newer.\`time_updated\` > source.\`time_updated\` OR
              (newer.\`time_updated\` = source.\`time_updated\` AND newer.rowid > source.rowid))
        );`)
      yield* tx.run(`DROP TABLE \`preference\`;`)
      yield* tx.run(`ALTER TABLE \`__new_preference\` RENAME TO \`preference\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
    })
  },
} satisfies DatabaseMigration.Migration
