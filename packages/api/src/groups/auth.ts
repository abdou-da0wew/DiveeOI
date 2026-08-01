import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, UnauthorizedError, ForbiddenError } from "../errors"

const UserResponse = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  username: Schema.String,
  role: Schema.String,
  verified: Schema.Boolean,
  message_count: Schema.Number,
})

const RegisterBody = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
  username: Schema.optional(Schema.String),
})

const LoginBody = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
})

const RefreshBody = Schema.Struct({
  refreshToken: Schema.String,
})

const ResendBody = Schema.Struct({
  email: Schema.String,
})

const TokenQuery = Schema.Struct({
  token: Schema.String,
})

const LoginResponse = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  user: UserResponse,
})

const OkResponse = Schema.Struct({
  ok: Schema.Literal(true),
})

const UpdateProfileBody = Schema.Struct({
  username: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
})

const UpdateProfileResponse = Schema.Struct({
  user: Schema.Struct({
    id: Schema.String,
    email: Schema.String,
    username: Schema.String,
    role: Schema.String,
    verified: Schema.Boolean,
    message_count: Schema.Number,
  }),
})

export const AuthGroup = HttpApiGroup.make("server.auth")
  .add(
    HttpApiEndpoint.post("auth.register", "/api/auth/register", {
      payload: RegisterBody,
      success: Schema.Struct({ user: UserResponse }),
      error: [ConflictError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.register",
        summary: "Register a new user",
        description: "Create a new user account with email and password.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("auth.login", "/api/auth/login", {
      payload: LoginBody,
      success: LoginResponse,
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.login",
        summary: "Login",
        description: "Authenticate with email and password.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("auth.refresh", "/api/auth/refresh", {
      payload: RefreshBody,
      success: LoginResponse,
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.refresh",
        summary: "Refresh access token",
        description: "Get a new access token using a refresh token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("auth.logout", "/api/auth/logout", {
      success: OkResponse,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.logout",
        summary: "Logout",
        description: "Clear the current session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("auth.me", "/api/auth/me", {
      success: Schema.Struct({ user: UserResponse }),
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.me",
        summary: "Get current user",
        description: "Get the currently authenticated user from the Bearer token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("auth.verifyEmail", "/api/auth/verify-email", {
      query: TokenQuery,
      success: OkResponse,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.verifyEmail",
        summary: "Verify email",
        description: "Verify email address using a verification token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("auth.resendVerification", "/api/auth/resend-verification", {
      payload: ResendBody,
      success: OkResponse,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.resendVerification",
        summary: "Resend verification email",
        description: "Resend the email verification link.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("auth.updateProfile", "/api/auth/profile", {
      payload: UpdateProfileBody,
      success: UpdateProfileResponse,
      error: [ConflictError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.updateProfile",
        summary: "Update user profile",
        description: "Update username, email, or password for the authenticated user.",
      }),
    ),
  )