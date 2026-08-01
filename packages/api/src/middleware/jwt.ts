export * as JwtAuth from "./jwt"

import { Config, Context, Effect, Layer } from "effect"
import { SignJWT, jwtVerify, type JWTPayload } from "jose"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { UnauthorizedError } from "../errors"

export interface AccessTokenPayload extends JWTPayload {
  sub: string
  email: string
  role: string
}

export interface RefreshTokenPayload extends JWTPayload {
  sub: string
  jti: string
}

const ACCESS_TOKEN_EXPIRY = "15m"
const REFRESH_TOKEN_EXPIRY = "7d"

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export interface Interface {
  readonly signAccessToken: (userId: string, email: string, role: string) => Effect.Effect<string>
  readonly signRefreshToken: (userId: string) => Effect.Effect<string>
  readonly verifyAccessToken: (token: string) => Effect.Effect<AccessTokenPayload, UnauthorizedError>
  readonly verifyRefreshToken: (token: string) => Effect.Effect<RefreshTokenPayload, UnauthorizedError>
  readonly readSecret: () => string
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/JwtAuth") {}

function loadOrCreateSecret(): string {
  const envSecret = process.env["DIVEEOI_JWT_SECRET"]
  if (envSecret && envSecret.length >= 32) return envSecret

  const dataDir = process.env["DIVEEOI_DATA_DIR"] || process.cwd() + "/data"
  const secretFile = path.join(dataDir, "jwt-secret.txt")

  try {
    const fileSecret = fs.readFileSync(secretFile, "utf-8").trim()
    if (fileSecret.length >= 32) return fileSecret
  } catch {
    // File doesn't exist or can't be read
  }

  const newSecret = crypto.randomBytes(32).toString("hex")
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(secretFile, newSecret, "utf-8")
    console.warn("[auth] JWT secret auto-generated and written to", secretFile)
  } catch {
    console.warn("[auth] Could not write JWT secret to file, using in-memory only")
  }

  return newSecret
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const secret = yield* Config.string("DIVEEOI_JWT_SECRET").pipe(
      Config.withDefault(""),
    )

    const resolvedSecret = secret.length >= 32 ? secret : yield* Effect.sync(() => loadOrCreateSecret())

    const key = getSecretKey(resolvedSecret)

    return Service.of({
      readSecret: () => resolvedSecret,
      signAccessToken: (userId: string, email: string, role: string) =>
        Effect.tryPromise({
          try: () =>
            new SignJWT({ sub: userId, email, role } as AccessTokenPayload)
              .setProtectedHeader({ alg: "HS256" })
              .setIssuedAt()
              .setExpirationTime(ACCESS_TOKEN_EXPIRY)
              .sign(key),
          catch: (err) => new UnauthorizedError({ message: `Failed to sign access token: ${String(err)}` }),
        }).pipe(Effect.orDie),
      signRefreshToken: (userId: string) =>
        Effect.tryPromise({
          try: () =>
            new SignJWT({ sub: userId, jti: crypto.randomUUID() } as RefreshTokenPayload)
              .setProtectedHeader({ alg: "HS256" })
              .setIssuedAt()
              .setExpirationTime(REFRESH_TOKEN_EXPIRY)
              .sign(key),
          catch: (err) => new UnauthorizedError({ message: `Failed to sign refresh token: ${String(err)}` }),
        }).pipe(Effect.orDie),
      verifyAccessToken: (token: string) =>
        Effect.tryPromise({
          try: () => jwtVerify(token, key).then((result) => result.payload as unknown as AccessTokenPayload),
          catch: () => {
            throw new UnauthorizedError({ message: "Invalid or expired access token" })
          },
        }),
      verifyRefreshToken: (token: string) =>
        Effect.tryPromise({
          try: () => jwtVerify(token, key).then((result) => result.payload as unknown as RefreshTokenPayload),
          catch: () => {
            throw new UnauthorizedError({ message: "Invalid or expired refresh token" })
          },
        }),
    })
  }),
)

export const defaultLayer = layer
