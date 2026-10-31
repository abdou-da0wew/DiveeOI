import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Auth tables were introduced by hand-written migrations (20260729000001_add_users and
 * friends) before being declared here. Declare them so `bun script/migration.ts` keeps them
 * in the generated fresh-install schema instead of silently dropping them.
 *
 * The UNIQUE constraints on user.email and verification_token.token are column-level and
 * intentionally not re-declared as indexes: drizzle-kit 1.0.0-rc.2 silently swallows an
 * inline UNIQUE when a manual index() covers the same column, and the legacy
 * idx_user_email / idx_verification_token_token indexes are redundant beside the UNIQUE
 * auto-indexes existing databases already carry.
 */
export const UserTable = sqliteTable("user", {
  id: text().primaryKey(),
  email: text().notNull().unique(),
  password_hash: text().notNull(),
  role: text().notNull().default("user"),
  verified: integer().notNull().default(0),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
  username: text().notNull().default(""),
  message_count: integer().notNull().default(0),
})

export const VerificationTokenTable = sqliteTable("verification_token", {
  id: text().primaryKey(),
  user_id: text()
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  token: text().notNull().unique(),
  type: text().notNull(),
  expires_at: integer().notNull(),
  used: integer().notNull().default(0),
})

export const AuthRefreshTokenTable = sqliteTable(
  "auth_refresh_token",
  {
    jti: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    expires_at: integer().notNull(),
    created_at: integer().notNull(),
    revoked_at: integer(),
  },
  (table) => [
    index("auth_refresh_user_idx").on(table.user_id, table.revoked_at),
    index("auth_refresh_expiry_idx").on(table.expires_at),
  ],
)

export const queries = {
  createUser: sql`INSERT INTO "user" (id, email, password_hash, role, verified, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
  findByEmail: sql`SELECT * FROM "user" WHERE email = ?`,
  findById: sql`SELECT * FROM "user" WHERE id = ?`,
  verifyEmail: sql`UPDATE "user" SET verified = 1, updated_at = ? WHERE id = ?`,
  setPasswordHash: sql`UPDATE "user" SET password_hash = ?, updated_at = ? WHERE id = ?`,
  countByRole: sql`SELECT COUNT(*) as count FROM "user" WHERE role = ?`,
  createVerificationToken: sql`INSERT INTO "verification_token" (id, user_id, token, type, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)`,
  consumeToken: sql`UPDATE "verification_token" SET used = 1 WHERE token = ? AND type = ? AND used = 0 AND expires_at > ?`,
  getToken: sql`SELECT * FROM "verification_token" WHERE token = ? AND type = ?`,
}
