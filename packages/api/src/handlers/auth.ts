import { Effect, Option } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ConflictError, ForbiddenError, InvalidRequestError, UnauthorizedError } from "../errors"
import { JwtAuth } from "../middleware/jwt"
import { UserService } from "@diveeoi/db/auth-user/user"
import { isBrowserRequest } from "../auth/refresh-transport"

const REFRESH_COOKIE = "diveeoi_refresh"
const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

const normalizeEmail = (email: string) => email.trim().toLowerCase()
const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

const bearerToken = (authorization: string | undefined) => {
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization ?? "")
  return match?.[1]
}

const cookieToken = (header: string | undefined) => {
  for (const item of (header ?? "").split(";")) {
    const [name, ...value] = item.trim().split("=")
    if (name === REFRESH_COOKIE) return value.join("=") || undefined
  }
  return undefined
}

const setRefreshCookie = (token: string | null) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const requestUrl = Option.getOrElse(
      HttpServerRequest.toURL(request),
      () => new URL(request.url, "http://localhost"),
    )
    const forwardedProto = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim().toLowerCase()
    const secure = requestUrl.protocol === "https:" || forwardedProto === "https:" ? "; Secure" : ""
    const value = token
      ? `${REFRESH_COOKIE}=${encodeURIComponent(token)}; Path=/api/auth; Max-Age=${REFRESH_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`
      : `${REFRESH_COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(HttpServerResponse.setHeader(response, "set-cookie", value)),
    )
  })

const issueRefreshSession = Effect.fn("Auth.issueRefreshSession")(function* (
  jwtAuth: JwtAuth.Interface,
  userService: UserService.Interface,
  userId: string,
) {
  const token = yield* jwtAuth.signRefreshToken(userId)
  const payload = yield* jwtAuth.verifyRefreshToken(token)
  const expiresAt = Number(payload.exp) * 1000
  yield* userService.issueRefreshSession(payload.jti, userId, expiresAt)
  return token
})

export const AuthHandler = HttpApiBuilder.group(Api, "server.auth", (handlers) =>
  Effect.gen(function* () {
    const jwtAuth = yield* JwtAuth.Service
    const userService = yield* UserService.Service

    return handlers
      .handle("auth.register", Effect.fn(function* (ctx) {
        const email = normalizeEmail(ctx.payload.email)
        const { password, username } = ctx.payload
        if (!validEmail(email)) {
          return yield* new InvalidRequestError({ message: "Enter a valid email address", field: "email" })
        }
        if (password.length < 12) {
          return yield* new InvalidRequestError({ message: "Password must be at least 12 characters", field: "password" })
        }
        if (Buffer.byteLength(password, "utf8") > 72) {
          return yield* new InvalidRequestError({ message: "Password must be at most 72 bytes", field: "password" })
        }
        if (username !== undefined) {
          if (username.length > 30) {
            return yield* new InvalidRequestError({ message: "Username must be 30 characters or fewer", field: "username" })
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            return yield* new InvalidRequestError({ message: "Username can only contain letters, numbers, underscores, and hyphens", field: "username" })
          }
        }

        const publicRegistration = ["1", "true", "yes"].includes(
          (process.env["DIVEEOI_AUTH_ALLOW_REGISTRATION"] ?? "").toLowerCase(),
        )
        const existing = yield* userService.findByEmail(email)
        if (Option.isSome(existing)) {
          return yield* new ConflictError({ message: "Email already registered", resource: "user" })
        }
        // This read is only an early rejection/CPU-saving check. The database
        // performs the actual first-admin claim atomically below.
        if (!publicRegistration) {
          const adminCount = yield* userService.countByRole("admin")
          const userCount = yield* userService.countByRole("user")
          if (adminCount + userCount > 0) {
            return yield* new ForbiddenError({ message: "Public registration is disabled" })
          }
        }

        const passwordHash = yield* userService.hashPassword(password)
        // The conditional insert guarantees that concurrent first registrations
        // cannot both receive admin. Later public registrations are regular users.
        const firstAdmin = yield* userService.createFirstAdmin(email, passwordHash, username ?? "")
        let user: UserService.User
        if (Option.isSome(firstAdmin)) {
          user = firstAdmin.value
        } else {
          const racedExisting = yield* userService.findByEmail(email)
          if (Option.isSome(racedExisting)) {
            return yield* new ConflictError({ message: "Email already registered", resource: "user" })
          }
          if (!publicRegistration) {
            return yield* new ForbiddenError({ message: "Public registration is disabled" })
          }
          user = yield* userService.create(email, passwordHash, "user", username ?? "")
        }
        // Email delivery is not configured, so do not create an unusable token or
        // claim that a verification email has been sent. Legacy verification
        // tokens continue to work for accounts created by earlier versions.
        if (user.verified === 0) yield* userService.verifyEmail(user.id)
        return {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            verified: true,
            message_count: user.message_count,
          },
        }
      }))
      .handle("auth.login", Effect.fn(function* (ctx) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const email = normalizeEmail(ctx.payload.email)
        if (!validEmail(email) || ctx.payload.password.length > 1024) {
          return yield* new UnauthorizedError({ message: "Invalid email or password" })
        }
        const maybeUser = yield* userService.findByEmail(email)
        if (Option.isNone(maybeUser)) {
          return yield* new UnauthorizedError({ message: "Invalid email or password" })
        }
        const user = maybeUser.value
        const valid = yield* userService.verifyPassword(ctx.payload.password, user.password_hash)
        if (!valid) {
          return yield* new UnauthorizedError({ message: "Invalid email or password" })
        }
        const accessToken = yield* jwtAuth.signAccessToken(user.id, user.email, user.role)
        const refreshToken = yield* issueRefreshSession(jwtAuth, userService, user.id)
        yield* setRefreshCookie(refreshToken)
        return {
          accessToken,
          ...(!isBrowserRequest(request.headers) ? { refreshToken } : {}),
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            verified: user.verified === 1,
            message_count: user.message_count,
          },
        }
      }))
      .handle("auth.refresh", Effect.fn(function* (ctx) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const refreshToken = ctx.payload.refreshToken || cookieToken(request.headers.cookie)
        if (!refreshToken || refreshToken.length > 4096) {
          return yield* new UnauthorizedError({ message: "Missing or invalid refresh token" })
        }
        const payload = yield* jwtAuth.verifyRefreshToken(refreshToken)
        const maybeUser = yield* userService.findById(payload.sub)
        if (Option.isNone(maybeUser)) {
          return yield* new UnauthorizedError({ message: "Invalid refresh token" })
        }
        const user = maybeUser.value
        const nextRefreshToken = yield* jwtAuth.signRefreshToken(user.id)
        const nextPayload = yield* jwtAuth.verifyRefreshToken(nextRefreshToken)
        const rotated = yield* userService.rotateRefreshSession(
          payload.jti,
          user.id,
          nextPayload.jti,
          Number(nextPayload.exp) * 1000,
        )
        if (!rotated) return yield* new UnauthorizedError({ message: "Refresh token has been revoked or already used" })
        const accessToken = yield* jwtAuth.signAccessToken(user.id, user.email, user.role)
        yield* setRefreshCookie(nextRefreshToken)
        return {
          accessToken,
          ...(ctx.payload.refreshToken ? { refreshToken: nextRefreshToken } : {}),
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            verified: user.verified === 1,
            message_count: user.message_count,
          },
        }
      }))
      .handle("auth.logout", Effect.fn(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const refreshToken = cookieToken(request.headers.cookie)
        if (refreshToken && refreshToken.length <= 4096) {
          const payload = yield* jwtAuth.verifyRefreshToken(refreshToken).pipe(
            Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
          )
          if (payload) yield* userService.revokeRefreshSession(payload.jti, payload.sub)
        }
        const accessToken = bearerToken(request.headers.authorization)
        if (accessToken) {
          const payload = yield* jwtAuth.verifyAccessToken(accessToken).pipe(
            Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
          )
          if (payload) yield* userService.revokeAllRefreshSessions(payload.sub)
        }
        yield* setRefreshCookie(null)
        return { ok: true as const }
      }))
      .handle("auth.me", Effect.fn(function* (_ctx) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const token = bearerToken(request.headers.authorization)
        if (!token) {
          return yield* new UnauthorizedError({ message: "Missing or invalid authorization header" })
        }
        const payload = yield* jwtAuth.verifyAccessToken(token)
        const maybeUser = yield* userService.findById(payload.sub)
        if (Option.isNone(maybeUser)) {
          return yield* new UnauthorizedError({ message: "User not found" })
        }
        const user = maybeUser.value
        return {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            verified: user.verified === 1,
            message_count: user.message_count,
          },
        }
      }))
      .handle("auth.verifyEmail", Effect.fn(function* (ctx) {
        const { token } = ctx.query
        const maybeUserId = yield* userService.consumeVerificationToken(token, "verify_email")
        if (Option.isNone(maybeUserId)) {
          return yield* new InvalidRequestError({ message: "Invalid or expired verification token" })
        }
        yield* userService.verifyEmail(maybeUserId.value)
        return { ok: true as const }
      }))
      .handle("auth.resendVerification", Effect.fn(function* (_ctx) {
        // Avoid account enumeration. Verification email delivery is not yet
        // configured, so this endpoint intentionally sends nothing.
        return { ok: true as const }
      }))
      .handle("auth.updateProfile", Effect.fn(function* (ctx) {
        const { username, email: requestedEmail, password } = ctx.payload
        const request = yield* HttpServerRequest.HttpServerRequest
        const token = bearerToken(request.headers.authorization)
        if (!token) {
          return yield* new UnauthorizedError({ message: "Missing or invalid authorization header" })
        }
        const payload = yield* jwtAuth.verifyAccessToken(token)
        const maybeUser = yield* userService.findById(payload.sub)
        if (Option.isNone(maybeUser)) {
          return yield* new UnauthorizedError({ message: "User not found" })
        }
        const currentUser = maybeUser.value
        const email = requestedEmail === undefined ? undefined : normalizeEmail(requestedEmail)

        if (username === undefined && email === undefined && password === undefined) {
          return yield* new InvalidRequestError({ message: "At least one field (username, email, or password) must be provided" })
        }
        if (username !== undefined) {
          if (username.length > 30) {
            return yield* new InvalidRequestError({ message: "Username must be 30 characters or fewer", field: "username" })
          }
          if (!/^[a-zA-Z0-9_-]*$/.test(username)) {
            return yield* new InvalidRequestError({ message: "Username can only contain letters, numbers, underscores, and hyphens", field: "username" })
          }
        }
        if (email !== undefined && !validEmail(email)) {
          return yield* new InvalidRequestError({ message: "Enter a valid email address", field: "email" })
        }
        if (email !== undefined && email !== currentUser.email) {
          const existing = yield* userService.findByEmail(email)
          if (Option.isSome(existing)) {
            return yield* new ConflictError({ message: "Email already in use", resource: "email" })
          }
        }
        if (password !== undefined && (password.length < 12 || Buffer.byteLength(password, "utf8") > 72)) {
          return yield* new InvalidRequestError({ message: "Password must be 12–72 bytes", field: "password" })
        }

        const data: { username?: string; email?: string; password_hash?: string } = {}
        if (username !== undefined) data.username = username
        if (email !== undefined) data.email = email
        if (password !== undefined) data.password_hash = yield* userService.hashPassword(password)
        const updatedUser = yield* userService.updateProfile(currentUser.id, data)
        if (password !== undefined || email !== undefined) {
          yield* userService.revokeAllRefreshSessions(currentUser.id)
          yield* setRefreshCookie(null)
        }
        return {
          user: {
            id: updatedUser.id,
            email: updatedUser.email,
            username: updatedUser.username,
            role: updatedUser.role,
            verified: updatedUser.verified === 1,
            message_count: updatedUser.message_count,
          },
        }
      }))
  }),
)
