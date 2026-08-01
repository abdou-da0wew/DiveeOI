import { Effect, Option } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ConflictError, InvalidRequestError, UnauthorizedError } from "../errors"
import { JwtAuth } from "../middleware/jwt"
import { MailService } from "@diveeoi/db/mail/mail"
import { UserService } from "@diveeoi/db/auth-user/user"

export const AuthHandler = HttpApiBuilder.group(Api, "server.auth", (handlers) =>
  Effect.gen(function* () {
    const jwtAuth = yield* JwtAuth.Service
    const userService = yield* UserService.Service
    const mailService = yield* MailService.Service

    return handlers
      .handle("auth.register", Effect.fn(function* (ctx) {
        const { email, password, username } = ctx.payload
        if (username !== undefined) {
          if (username.length > 30) {
            return yield* new InvalidRequestError({ message: "Username must be 30 characters or fewer", field: "username" })
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            return yield* new InvalidRequestError({ message: "Username can only contain letters, numbers, underscores, and hyphens", field: "username" })
          }
        }
        const existing = yield* userService.findByEmail(email)
        if (Option.isSome(existing)) {
          return yield* new ConflictError({ message: "Email already registered", resource: "user" })
        }
        const passwordHash = yield* userService.hashPassword(password)
        const user = yield* userService.create(email, passwordHash, "user", username ?? "")
        const token = yield* userService.createVerificationToken(
          user.id,
          "verify_email",
          Date.now() + 24 * 60 * 60 * 1000,
        )
        yield* mailService.sendVerificationEmail(email, token)
        return {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            verified: false,
            message_count: user.message_count,
          },
        }
      }))
      .handle("auth.login", Effect.fn(function* (ctx) {
        const { email, password } = ctx.payload
        const maybeUser = yield* userService.findByEmail(email)
        if (Option.isNone(maybeUser)) {
          return yield* new UnauthorizedError({ message: "Invalid email or password" })
        }
        const user = maybeUser.value
        const valid = yield* userService.verifyPassword(password, user.password_hash)
        if (!valid) {
          return yield* new UnauthorizedError({ message: "Invalid email or password" })
        }
        const accessToken = yield* jwtAuth.signAccessToken(user.id, user.email, user.role)
        const refreshToken = yield* jwtAuth.signRefreshToken(user.id)
        return {
          accessToken,
          refreshToken,
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
        const { refreshToken } = ctx.payload
        const payload = yield* jwtAuth.verifyRefreshToken(refreshToken)
        const maybeUser = yield* userService.findById(payload.sub)
        if (Option.isNone(maybeUser)) {
          return yield* new UnauthorizedError({ message: "User not found" })
        }
        const user = maybeUser.value
        const accessToken = yield* jwtAuth.signAccessToken(user.id, user.email, user.role)
        const newRefreshToken = yield* jwtAuth.signRefreshToken(user.id)
        return {
          accessToken,
          refreshToken: newRefreshToken,
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
      .handle("auth.logout", () => Effect.succeed({ ok: true as const }))
      .handle("auth.me", Effect.fn(function* (_ctx) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const authHeader = request.headers.authorization
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return yield* new UnauthorizedError({ message: "Missing or invalid authorization header" })
        }
        const token = authHeader.slice(7)
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
      .handle("auth.resendVerification", Effect.fn(function* (ctx) {
        const { email } = ctx.payload
        const maybeUser = yield* userService.findByEmail(email)
        if (Option.isNone(maybeUser)) {
          return { ok: true as const }
        }
        const user = maybeUser.value
        if (user.verified === 1) {
          return { ok: true as const }
        }
        const token = yield* userService.createVerificationToken(
          user.id,
          "verify_email",
          Date.now() + 24 * 60 * 60 * 1000,
        )
        yield* mailService.sendVerificationEmail(email, token)
        return { ok: true as const }
      }))
      .handle("auth.updateProfile", Effect.fn(function* (ctx) {
        const { username, email, password } = ctx.payload

        const request = yield* HttpServerRequest.HttpServerRequest
        const authHeader = request.headers.authorization
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return yield* new UnauthorizedError({ message: "Missing or invalid authorization header" })
        }
        const token = authHeader.slice(7)
        const payload = yield* jwtAuth.verifyAccessToken(token)
        const maybeUser = yield* userService.findById(payload.sub)
        if (Option.isNone(maybeUser)) {
          return yield* new UnauthorizedError({ message: "User not found" })
        }
        const currentUser = maybeUser.value

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

        if (email !== undefined && email !== currentUser.email) {
          const existing = yield* userService.findByEmail(email)
          if (Option.isSome(existing)) {
            return yield* new ConflictError({ message: "Email already in use", resource: "email" })
          }
        }

        if (password !== undefined && password.length < 8) {
          return yield* new InvalidRequestError({ message: "Password must be at least 8 characters", field: "password" })
        }

        const data: { username?: string; email?: string; password_hash?: string } = {}
        if (username !== undefined) data.username = username
        if (email !== undefined) data.email = email
        if (password !== undefined) {
          data.password_hash = yield* userService.hashPassword(password)
        }

        const updatedUser = yield* userService.updateProfile(currentUser.id, data)
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