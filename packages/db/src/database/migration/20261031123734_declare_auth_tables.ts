import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261031123734_declare_auth_tables",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`auth_refresh_token\` (
          \`jti\` text PRIMARY KEY,
          \`user_id\` text NOT NULL,
          \`expires_at\` integer NOT NULL,
          \`created_at\` integer NOT NULL,
          \`revoked_at\` integer,
          CONSTRAINT \`fk_auth_refresh_token_user_id_user_id_fk\` FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`user\` (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL UNIQUE,
          \`password_hash\` text NOT NULL,
          \`role\` text DEFAULT 'user' NOT NULL,
          \`verified\` integer DEFAULT 0 NOT NULL,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          \`username\` text DEFAULT '' NOT NULL,
          \`message_count\` integer DEFAULT 0 NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`verification_token\` (
          \`id\` text PRIMARY KEY,
          \`user_id\` text NOT NULL,
          \`token\` text NOT NULL UNIQUE,
          \`type\` text NOT NULL,
          \`expires_at\` integer NOT NULL,
          \`used\` integer DEFAULT 0 NOT NULL,
          CONSTRAINT \`fk_verification_token_user_id_user_id_fk\` FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`auth_refresh_user_idx\` ON \`auth_refresh_token\` (\`user_id\`,\`revoked_at\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`auth_refresh_expiry_idx\` ON \`auth_refresh_token\` (\`expires_at\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
