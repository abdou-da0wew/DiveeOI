import { sql } from "drizzle-orm"

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
