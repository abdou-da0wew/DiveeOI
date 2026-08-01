export * as UserService from "./user"

import { Database } from "../database/database"
import { Context, Effect, Layer, Option } from "effect"
import { sql } from "drizzle-orm"
import { hash, compare } from "bcryptjs"

function dieOnError<A, E>(eff: Effect.Effect<A, E, never>): Effect.Effect<A, never, never> {
  return eff.pipe(Effect.orDie)
}

export interface User {
  id: string
  email: string
  username: string
  password_hash: string
  role: string
  verified: number
  message_count: number
  created_at: number
  updated_at: number
}

export interface VerificationToken {
  id: string
  user_id: string
  token: string
  type: string
  expires_at: number
  used: number
}

export interface Interface {
  readonly create: (email: string, passwordHash: string, role?: string, username?: string) => Effect.Effect<User>
  readonly findByEmail: (email: string) => Effect.Effect<Option.Option<User>>
  readonly findById: (id: string) => Effect.Effect<Option.Option<User>>
  readonly verifyEmail: (userId: string) => Effect.Effect<void>
  readonly setPasswordHash: (userId: string, hash: string) => Effect.Effect<void>
  readonly createVerificationToken: (userId: string, type: "verify_email" | "password_reset", expiresAt: number) => Effect.Effect<string>
  readonly consumeVerificationToken: (token: string, type: "verify_email" | "password_reset") => Effect.Effect<Option.Option<string>>
  readonly countByRole: (role: string) => Effect.Effect<number>
  readonly hashPassword: (password: string) => Effect.Effect<string>
  readonly verifyPassword: (password: string, hash: string) => Effect.Effect<boolean>
  readonly updateProfile: (userId: string, data: { username?: string; email?: string; password_hash?: string }) => Effect.Effect<User>
  readonly getMessageCount: (userId: string) => Effect.Effect<number>
  readonly incrementMessageCount: (userId: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/UserService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    return Service.of({
      create: (email: string, passwordHash: string, role = "user", username = "") =>
        dieOnError(Effect.gen(function* () {
          const now = Date.now()
          const id = crypto.randomUUID()
          yield* db.run(sql`INSERT INTO "user" (id, email, password_hash, role, verified, message_count, username, created_at, updated_at) VALUES (${id}, ${email}, ${passwordHash}, ${role}, 0, 0, ${username}, ${now}, ${now})`)
          return { id, email, username, password_hash: passwordHash, role, verified: 0, message_count: 0, created_at: now, updated_at: now }
        })),

      findByEmail: (email: string) =>
        dieOnError(Effect.gen(function* () {
          const rows = yield* db.all<User>(sql`SELECT * FROM "user" WHERE email = ${email} LIMIT 1`)
          return rows.length > 0 ? Option.some(rows[0]) : Option.none()
        })),

      findById: (id: string) =>
        dieOnError(Effect.gen(function* () {
          const rows = yield* db.all<User>(sql`SELECT * FROM "user" WHERE id = ${id} LIMIT 1`)
          return rows.length > 0 ? Option.some(rows[0]) : Option.none()
        })),

      verifyEmail: (userId: string) =>
        dieOnError(Effect.gen(function* () {
          yield* db.run(sql`UPDATE "user" SET verified = 1, updated_at = ${Date.now()} WHERE id = ${userId}`)
        })),

      setPasswordHash: (userId: string, newHash: string) =>
        dieOnError(Effect.gen(function* () {
          yield* db.run(sql`UPDATE "user" SET password_hash = ${newHash}, updated_at = ${Date.now()} WHERE id = ${userId}`)
        })),

      createVerificationToken: (userId: string, type: "verify_email" | "password_reset", expiresAt: number) =>
        dieOnError(Effect.gen(function* () {
          const id = crypto.randomUUID()
          const token = crypto.randomUUID()
          yield* db.run(
            sql`INSERT INTO "verification_token" (id, user_id, token, type, expires_at, used) VALUES (${id}, ${userId}, ${token}, ${type}, ${expiresAt}, 0)`,
          )
          return token
        })),

      consumeVerificationToken: (token: string, type: "verify_email" | "password_reset") =>
        dieOnError(Effect.gen(function* () {
          const now = Date.now()
          const rows = yield* db.all<VerificationToken>(
            sql`SELECT * FROM "verification_token" WHERE token = ${token} AND type = ${type} AND used = 0 AND expires_at > ${now} LIMIT 1`,
          )
          if (rows.length === 0) return Option.none() as Option.Option<string>
          yield* db.run(sql`UPDATE "verification_token" SET used = 1 WHERE id = ${rows[0].id}`)
          return Option.some(rows[0].user_id)
        })),

      countByRole: (role: string) =>
        dieOnError(Effect.gen(function* () {
          const result = yield* db.get<{ count: number }>(sql`SELECT COUNT(*) as count FROM "user" WHERE role = ${role}`)
          return result?.count ?? 0
        })),

      hashPassword: (password: string) =>
        dieOnError(
          Effect.tryPromise({
            try: () => hash(password, 12),
            catch: (err) => new Error(`Failed to hash password: ${String(err)}`),
          }),
        ),

      verifyPassword: (password: string, hashStr: string) =>
        dieOnError(
          Effect.tryPromise({
            try: () => compare(password, hashStr),
            catch: (err) => new Error(`Failed to verify password: ${String(err)}`),
          }),
        ),

      updateProfile: (userId: string, data: { username?: string; email?: string; password_hash?: string }) =>
        dieOnError(Effect.gen(function* () {
          const now = Date.now()
          const setClauses: any[] = []

          if (data.username !== undefined) {
            setClauses.push(sql`username = ${data.username}`)
          }
          if (data.email !== undefined) {
            setClauses.push(sql`email = ${data.email}`)
            setClauses.push(sql`verified = 0`)
          }
          if (data.password_hash !== undefined) {
            setClauses.push(sql`password_hash = ${data.password_hash}`)
          }
          setClauses.push(sql`updated_at = ${now}`)

          yield* db.run(
            sql`UPDATE "user" SET ${sql.join(setClauses, sql.raw(", "))} WHERE id = ${userId}`,
          )
          const rows = yield* db.all<User>(sql`SELECT * FROM "user" WHERE id = ${userId} LIMIT 1`)
          return rows[0]
        })),

      getMessageCount: (userId: string) =>
        dieOnError(Effect.gen(function* () {
          const result = yield* db.get<{ message_count: number }>(
            sql`SELECT message_count FROM "user" WHERE id = ${userId}`,
          )
          return result?.message_count ?? 0
        })),

      incrementMessageCount: (userId: string) =>
        dieOnError(Effect.gen(function* () {
          const now = Date.now()
          yield* db.run(
            sql`UPDATE "user" SET message_count = message_count + 1, updated_at = ${now} WHERE id = ${userId}`,
          )
        })),
    })
  }),
)