import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
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
      const wrongPurpose = yield* Effect.exit(jwt.verifyAccessToken(refresh))
      expect(wrongPurpose._tag).toBe("Failure")
    }),
  )
})
