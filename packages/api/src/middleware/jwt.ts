export * as JwtAuth from "./jwt"

import { Config, Context, Effect, Layer } from "effect"
import { SignJWT, jwtVerify, type JWTPayload } from "jose"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { UnauthorizedError } from "../errors"

const TOKEN_ISSUER = "diveeoi"
const ACCESS_AUDIENCE = "diveeoi-api"
const REFRESH_AUDIENCE = "diveeoi-auth-refresh"
const ACCESS_TOKEN_EXPIRY = "15m"
const REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60
const MIN_SECRET_LENGTH = 32

export interface AccessTokenPayload extends JWTPayload {
  sub: string
  email: string
  role: string
  token_use: "access"
}

export interface RefreshTokenPayload extends JWTPayload {
  sub: string
  jti: string
  token_use: "refresh"
}

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

function readSecretFile(secretFile: string): string | undefined {
  try {
    const secret = fs.readFileSync(secretFile, "utf8").trim()
    if (secret.length >= MIN_SECRET_LENGTH) {
      // JWT keys are credential material; correct overly broad permissions on
      // existing deployments without logging or exposing the key itself.
      if (process.platform !== "win32") fs.chmodSync(secretFile, 0o600)
      return secret
    }
  } catch {
    // Missing, unreadable, or malformed key: generate a new one below.
  }
  return undefined
}

function loadOrCreateSecret(): string {
  const envSecret = process.env["DIVEEOI_JWT_SECRET"]
  if (envSecret !== undefined) {
    if (envSecret.length < MIN_SECRET_LENGTH) {
      throw new Error(`DIVEEOI_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`)
    }
    return envSecret
  }

  const dataDir = process.env["DIVEEOI_DATA_DIR"] || path.join(process.cwd(), "data")
  const secretFile = path.join(dataDir, "jwt-secret.txt")
  const existing = readSecretFile(secretFile)
  if (existing) return existing

  const newSecret = crypto.randomBytes(32).toString("hex")
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    // Preserve a malformed/short key for diagnosis, but do not leave it in
    // place: otherwise every restart silently falls back to a new in-memory key.
    if (fs.existsSync(secretFile)) {
      try {
        if (process.platform !== "win32") fs.chmodSync(secretFile, 0o600)
        fs.renameSync(secretFile, `${secretFile}.invalid-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
      const raced = readSecretFile(secretFile)
      if (raced) return raced
    }
    // `wx` avoids silently replacing a key another server process just wrote.
    try {
      fs.writeFileSync(secretFile, newSecret, { encoding: "utf8", mode: 0o600, flag: "wx" })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const raced = readSecretFile(secretFile)
      if (!raced) throw new Error("JWT secret file was concurrently created with invalid contents")
      return raced
    }
    if (process.platform !== "win32") fs.chmodSync(secretFile, 0o600)
  } catch {
    // In-memory fallback is safe for this process but invalidates sessions on
    // restart. The warning deliberately omits both the key and filesystem path.
    console.warn("[auth] Could not persist the generated JWT secret; tokens will not survive a restart")
  }
  return newSecret
}

const verifyPayload = async <A extends JWTPayload>(
  token: string,
  key: Uint8Array,
  audience: string,
  tokenUse: "access" | "refresh",
): Promise<A> => {
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
    issuer: TOKEN_ISSUER,
    audience,
  })
  if (payload.token_use !== tokenUse || typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("wrong token purpose or missing subject")
  }
  if (tokenUse === "access") {
    if (typeof payload.email !== "string" || payload.email.length === 0 || typeof payload.role !== "string" || payload.role.length === 0) {
      throw new Error("invalid access-token claims")
    }
  } else if (typeof payload.jti !== "string" || payload.jti.length < 16) {
    throw new Error("invalid refresh-token id")
  }
  return payload as A
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configuredSecret = yield* Config.string("DIVEEOI_JWT_SECRET").pipe(Config.withDefault(""))
    const resolvedSecret = configuredSecret.length > 0 ? configuredSecret : yield* Effect.sync(() => loadOrCreateSecret())
    if (resolvedSecret.length < MIN_SECRET_LENGTH) {
      return yield* Effect.die(new Error(`DIVEEOI_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`))
    }

    const key = getSecretKey(resolvedSecret)

    return Service.of({
      readSecret: () => resolvedSecret,
      signAccessToken: (userId: string, email: string, role: string) =>
        Effect.tryPromise({
          try: () =>
            new SignJWT({ email, role, token_use: "access" })
              .setProtectedHeader({ alg: "HS256", typ: "JWT" })
              .setIssuer(TOKEN_ISSUER)
              .setAudience(ACCESS_AUDIENCE)
              .setSubject(userId)
              .setIssuedAt()
              .setExpirationTime(ACCESS_TOKEN_EXPIRY)
              .sign(key),
          catch: (err) => new UnauthorizedError({ message: `Failed to sign access token: ${String(err)}` }),
        }).pipe(Effect.orDie),
      signRefreshToken: (userId: string) =>
        Effect.tryPromise({
          try: () =>
            new SignJWT({ token_use: "refresh" })
              .setProtectedHeader({ alg: "HS256", typ: "JWT" })
              .setIssuer(TOKEN_ISSUER)
              .setAudience(REFRESH_AUDIENCE)
              .setSubject(userId)
              .setJti(crypto.randomUUID())
              .setIssuedAt()
              .setExpirationTime(`${REFRESH_TOKEN_EXPIRY_SECONDS}s`)
              .sign(key),
          catch: (err) => new UnauthorizedError({ message: `Failed to sign refresh token: ${String(err)}` }),
        }).pipe(Effect.orDie),
      verifyAccessToken: (token: string) =>
        Effect.tryPromise({
          try: () => verifyPayload<AccessTokenPayload>(token, key, ACCESS_AUDIENCE, "access"),
          catch: () => new UnauthorizedError({ message: "Invalid or expired access token" }),
        }),
      verifyRefreshToken: (token: string) =>
        Effect.tryPromise({
          try: () => verifyPayload<RefreshTokenPayload>(token, key, REFRESH_AUDIENCE, "refresh"),
          catch: () => new UnauthorizedError({ message: "Invalid or expired refresh token" }),
        }),
    })
  }),
)

export const defaultLayer = layer
