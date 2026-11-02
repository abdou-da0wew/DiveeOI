import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import crypto from "node:crypto"
import { JwtAuth } from "@diveeoi/api/middleware/jwt"
import { testEffect } from "../lib/effect"

const secret = "test-only-signing-key-with-32-bytes-minimum"
const jwtLayer = JwtAuth.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DIVEEOI_JWT_SECRET: secret }))),
)
const it = testEffect(jwtLayer)

describe("JWT purpose validation", () => {
  it.effect("accepts access tokens only as access tokens", () =>
    Effect.gen(function* () {
      const jwt = yield* JwtAuth.Service
      const access = yield* jwt.signAccessToken("usr_1", "student@example.test", "user")
      const decoded = yield* jwt.verifyAccessToken(access)
      expect(decoded.sub).toBe("usr_1")
      expect(decoded.token_use).toBe("access")
      const wrongPurpose = yield* Effect.exit(jwt.verifyRefreshToken(access))
      expect(wrongPurpose._tag).toBe("Failure")
    }),
  )

  it.effect("accepts refresh tokens only as refresh tokens", () =>
    Effect.gen(function* () {
      const jwt = yield* JwtAuth.Service
      const refresh = yield* jwt.signRefreshToken("usr_2")
      const decoded = yield* jwt.verifyRefreshToken(refresh)
      expect(decoded.sub).toBe("usr_2")
      expect(decoded.jti.length).toBeGreaterThanOrEqual(16)
      expect(decoded.exp! - decoded.iat!).toBe(4 * 24 * 60 * 60)
      const wrongPurpose = yield* Effect.exit(jwt.verifyAccessToken(refresh))
      expect(wrongPurpose._tag).toBe("Failure")
    }),
  )

  it.effect("issues a four-day rolling server session bound to the current Basic credentials", () =>
    Effect.gen(function* () {
      const jwt = yield* JwtAuth.Service
      const token = yield* jwt.signServerSession("DIVEEOI", "server-password")
      const payload = yield* jwt.verifyServerSession(token, "DIVEEOI", "server-password")

      expect(payload.token_use).toBe("server_session")
      expect(payload.username).toBe("DIVEEOI")
      expect(payload.sub).toBe("DIVEEOI")
      expect(payload.jti.length).toBeGreaterThanOrEqual(16)
      expect(payload.exp! - payload.iat!).toBe(4 * 24 * 60 * 60)

      const now = Math.floor(Date.now() / 1000)
      const credentialVersion = crypto
        .createHmac("sha256", new TextEncoder().encode(secret))
        .update("DIVEEOI")
        .update("\\0")
        .update("server-password")
        .digest("base64url")
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
      const body = Buffer.from(
        JSON.stringify({
          token_use: "server_session",
          username: "DIVEEOI",
          credential_version: credentialVersion,
          iss: "diveeoi",
          aud: "diveeoi-server-session",
          sub: "DIVEEOI",
          jti: crypto.randomUUID(),
          iat: now - 4 * 24 * 60 * 60 - 1,
          exp: now - 1,
        }),
      ).toString("base64url")
      const signed = `${header}.${body}`
      const signature = crypto.createHmac("sha256", secret).update(signed).digest("base64url")
      const expiredToken = `${signed}.${signature}`
      const expiredSession = yield* Effect.exit(
        jwt.verifyServerSession(expiredToken, "DIVEEOI", "server-password"),
      )
      expect(expiredSession._tag).toBe("Failure")

      const wrongPassword = yield* Effect.exit(jwt.verifyServerSession(token, "DIVEEOI", "changed-password"))
      const wrongUsername = yield* Effect.exit(jwt.verifyServerSession(token, "another-user", "server-password"))
      expect(wrongPassword._tag).toBe("Failure")
      expect(wrongUsername._tag).toBe("Failure")
    }),
  )
})
