import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260729000001_add_users",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`user\` (
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
        CREATE TABLE \`verification_token\` (
          \`id\` text PRIMARY KEY,
          \`user_id\` text NOT NULL REFERENCES \`user\`(\`id\`) ON DELETE CASCADE,
          \`token\` text NOT NULL UNIQUE,
          \`type\` text NOT NULL,
          \`expires_at\` integer NOT NULL,
          \`used\` integer NOT NULL DEFAULT 0
        );
      `)
      yield* tx.run(`CREATE INDEX \`idx_user_email\` ON \`user\` (\`email\`);`)
      yield* tx.run(`CREATE INDEX \`idx_verification_token_token\` ON \`verification_token\` (\`token\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
