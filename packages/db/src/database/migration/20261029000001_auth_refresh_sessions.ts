import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

/** Persist refresh-token revocation and rotation across server restarts. */
export default {
  id: "20261029000001_auth_refresh_sessions",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS "auth_refresh_token" (
          "jti" text PRIMARY KEY,
          "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
          "expires_at" integer NOT NULL,
          "created_at" integer NOT NULL,
          "revoked_at" integer
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS "auth_refresh_user_idx" ON "auth_refresh_token" ("user_id", "revoked_at");`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS "auth_refresh_expiry_idx" ON "auth_refresh_token" ("expires_at");`)
    })
  },
} satisfies DatabaseMigration.Migration
