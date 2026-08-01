import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "@diveeoi/db/database/database"
import { UserService } from "@diveeoi/db/auth-user/user"
import { testEffect } from "../lib/effect"

// schema.gen.ts doesn't include the `user` table (it was added in migration
// 20260729000001_add_users). For a fresh database, the migration system runs
// schema.up() and marks all migrations as completed — so individual migration
// files never execute. We patch the database layer to create the missing tables
// after initialization.
const baseDbLayer = Database.layerFromPath(":memory:")

const patchedDbLayer = Layer.effect(
  Database.Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.run(sql`
      CREATE TABLE IF NOT EXISTS "user" (
        "id" text PRIMARY KEY,
        "email" text NOT NULL UNIQUE,
        "password_hash" text NOT NULL,
        "role" text NOT NULL DEFAULT 'user',
        "verified" integer NOT NULL DEFAULT 0,
        "username" text NOT NULL DEFAULT '',
        "message_count" integer NOT NULL DEFAULT 0,
        "created_at" integer NOT NULL,
        "updated_at" integer NOT NULL
      )
    `)
    yield* db.run(sql`
      CREATE TABLE IF NOT EXISTS "verification_token" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "token" text NOT NULL UNIQUE,
        "type" text NOT NULL,
        "expires_at" integer NOT NULL,
        "used" integer NOT NULL DEFAULT 0
      )
    `)
    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "idx_user_email" ON "user" ("email")`)
    yield* db.run(
      sql`CREATE INDEX IF NOT EXISTS "idx_verification_token_token" ON "verification_token" ("token")`,
    )
    return { db }
  }),
)

const dbLayer = Layer.provideMerge(patchedDbLayer, baseDbLayer) as Layer.Layer<Database.Service>

const testLayer = UserService.layer.pipe(
  Layer.provide(dbLayer),
)

const it = testEffect(testLayer)

describe("UserService extended", () => {
  it.effect("create stores user with default fields", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("secret123")
      const user = yield* svc.create("alice@test.com", hash)

      expect(user.email).toBe("alice@test.com")
      expect(user.username).toBe("")
      expect(user.role).toBe("user")
      expect(user.verified).toBe(0)
      expect(user.message_count).toBe(0)
      expect(user.id).toBeTruthy()
      expect(typeof user.created_at).toBe("number")
      expect(typeof user.updated_at).toBe("number")
    }),
  )

  it.effect("create with custom username and role", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("secret")
      const user = yield* svc.create("bob@test.com", hash, "admin", "bob-dev")

      expect(user.email).toBe("bob@test.com")
      expect(user.username).toBe("bob-dev")
      expect(user.role).toBe("admin")
    }),
  )

  it.effect("findByEmail returns user for existing email", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("pwd")
      yield* svc.create("findme@test.com", hash)

      const found = yield* svc.findByEmail("findme@test.com")
      expect(Option.isSome(found)).toBe(true)
      if (Option.isSome(found)) {
        expect(found.value.email).toBe("findme@test.com")
      }
    }),
  )

  it.effect("findByEmail returns none for unknown email", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const found = yield* svc.findByEmail("nobody@test.com")
      expect(Option.isNone(found)).toBe(true)
    }),
  )

  it.effect("findById returns user for existing id", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("pwd")
      const created = yield* svc.create("byid@test.com", hash)

      const found = yield* svc.findById(created.id)
      expect(Option.isSome(found)).toBe(true)
      if (Option.isSome(found)) {
        expect(found.value.id).toBe(created.id)
      }
    }),
  )

  it.effect("verifyEmail sets verified to 1", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("pwd")
      const user = yield* svc.create("verify@test.com", hash)

      expect(user.verified).toBe(0)

      yield* svc.verifyEmail(user.id)

      const found = yield* svc.findById(user.id)
      expect(Option.isSome(found)).toBe(true)
      if (Option.isSome(found)) {
        expect(found.value.verified).toBe(1)
      }
    }),
  )

  it.effect("updateProfile changes username", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("pwd")
      const user = yield* svc.create("profile@test.com", hash)

      const updated = yield* svc.updateProfile(user.id, { username: "newname" })

      expect(updated.username).toBe("newname")
      expect(updated.email).toBe("profile@test.com")
      expect(updated.verified).toBe(0)
    }),
  )

  it.effect("updateProfile changing email resets verified", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("pwd")
      const user = yield* svc.create("old@test.com", hash)

      yield* svc.verifyEmail(user.id)

      const updated = yield* svc.updateProfile(user.id, { email: "new@test.com" })

      expect(updated.email).toBe("new@test.com")
      expect(updated.verified).toBe(0)
    }),
  )

  it.effect("updateProfile changes password hash", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("oldpass")
      const user = yield* svc.create("passchange@test.com", hash)

      const newHash = yield* svc.hashPassword("newpass")
      yield* svc.updateProfile(user.id, { password_hash: newHash })

      const good = yield* svc.verifyPassword("newpass", newHash)
      expect(good).toBe(true)
    }),
  )

  it.effect("updateProfile partial update preserves other fields", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("pwd")
      const user = yield* svc.create("partial@test.com", hash, "moderator", "original")

      const updated = yield* svc.updateProfile(user.id, { username: "changed" })

      expect(updated.username).toBe("changed")
      expect(updated.role).toBe("moderator")
      expect(updated.email).toBe("partial@test.com")
    }),
  )

  it.effect("getMessageCount returns 0 for new user", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("pwd")
      const user = yield* svc.create("msgcount@test.com", hash)

      const count = yield* svc.getMessageCount(user.id)
      expect(count).toBe(0)
    }),
  )

  it.effect("incrementMessageCount increases from 0 to 1 to 2", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("pwd")
      const user = yield* svc.create("increment@test.com", hash)

      yield* svc.incrementMessageCount(user.id)
      const c1 = yield* svc.getMessageCount(user.id)
      expect(c1).toBe(1)

      yield* svc.incrementMessageCount(user.id)
      const c2 = yield* svc.getMessageCount(user.id)
      expect(c2).toBe(2)
    }),
  )

  it.effect("hashPassword and verifyPassword roundtrip", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("correct-horse-battery-staple")

      const good = yield* svc.verifyPassword("correct-horse-battery-staple", hash)
      expect(good).toBe(true)

      const bad = yield* svc.verifyPassword("wrong", hash)
      expect(bad).toBe(false)
    }),
  )

  it.effect("createVerificationToken and consumeVerificationToken roundtrip", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("pwd")
      const user = yield* svc.create("token@test.com", hash)

      const expiresAt = Date.now() + 3600_000
      const token = yield* svc.createVerificationToken(user.id, "verify_email", expiresAt)
      expect(typeof token).toBe("string")
      expect(token.length).toBeGreaterThan(0)

      const consumed = yield* svc.consumeVerificationToken(token, "verify_email")
      expect(Option.isSome(consumed)).toBe(true)
      if (Option.isSome(consumed)) {
        expect(consumed.value).toBe(user.id)
      }

      const consumedAgain = yield* svc.consumeVerificationToken(token, "verify_email")
      expect(Option.isNone(consumedAgain)).toBe(true)
    }),
  )

  it.effect("consumeVerificationToken returns none for invalid token", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const result = yield* svc.consumeVerificationToken("non-existent-token", "verify_email")
      expect(Option.isNone(result)).toBe(true)
    }),
  )

  it.effect("consumeVerificationToken returns none for expired token", () =>
    Effect.gen(function* () {
      const svc = yield* UserService.Service
      const hash = yield* svc.hashPassword("pwd")
      const user = yield* svc.create("expired@test.com", hash)

      const expiresAt = Date.now() - 1000
      const token = yield* svc.createVerificationToken(user.id, "verify_email", expiresAt)

      const consumed = yield* svc.consumeVerificationToken(token, "verify_email")
      expect(Option.isNone(consumed)).toBe(true)
    }),
  )
})
