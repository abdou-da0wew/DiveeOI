import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261115145554_diveeoi_exam_assessments",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`diveeoi_exam_attempt\` (
          \`id\` text PRIMARY KEY,
          \`exam_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`attempt_number\` integer NOT NULL,
          \`difficulty\` integer DEFAULT 3 NOT NULL,
          \`answers_json\` text NOT NULL,
          \`interaction_json\` text,
          \`grade_json\` text NOT NULL,
          \`score\` real DEFAULT 0 NOT NULL,
          \`max_score\` real DEFAULT 0 NOT NULL,
          \`percentage\` real,
          \`needs_review\` integer DEFAULT 0 NOT NULL,
          \`elapsed_ms\` integer DEFAULT 0 NOT NULL,
          \`submitted_at\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_diveeoi_exam_attempt_exam_id_diveeoi_exam_id_fk\` FOREIGN KEY (\`exam_id\`) REFERENCES \`diveeoi_exam\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_diveeoi_exam_attempt_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`diveeoi_exam\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`spec_json\` text NOT NULL,
          \`secret_ciphertext\` text NOT NULL,
          \`secret_iv\` text NOT NULL,
          \`secret_auth_tag\` text NOT NULL,
          \`grading_json\` text NOT NULL,
          \`adaptive_difficulty\` integer DEFAULT 3 NOT NULL,
          \`attempts_allowed\` integer DEFAULT 1 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_diveeoi_exam_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`diveeoi_exam_attempt_number_idx\` ON \`diveeoi_exam_attempt\` (\`exam_id\`,\`attempt_number\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`diveeoi_exam_attempt_session_idx\` ON \`diveeoi_exam_attempt\` (\`session_id\`,\`submitted_at\`);`,
      )
      yield* tx.run(`CREATE INDEX \`diveeoi_exam_session_idx\` ON \`diveeoi_exam\` (\`session_id\`,\`time_created\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
