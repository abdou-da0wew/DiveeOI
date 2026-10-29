import { ServerAuth } from "../auth"
import { UnauthorizedError } from "../errors"
import { hasPtyConnectTicketURL } from "../groups/pty"
import { Effect, Encoding, Layer, Redacted } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { JwtAuth } from "./jwt"

const AUTH_TOKEN_QUERY = "auth_token"

export class Authorization extends HttpApiMiddleware.Service<Authorization>()("@opencode/HttpApiAuthorization", {
  error: UnauthorizedError,
}) {}

function emptyCredential() {
  return { username: "", password: Redacted.make("") }
}

function decodeCredential(input: string) {
  return Effect.fromResult(Encoding.decodeBase64String(input)).pipe(
    Effect.match({
      onFailure: emptyCredential,
      onSuccess: (header) => {
        const separator = header.indexOf(":")
        if (separator === -1) return emptyCredential()
        return { username: header.slice(0, separator), password: Redacted.make(header.slice(separator + 1)) }
      },
    }),
  )
}

function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
  const url = new URL(request.url, "http://localhost")
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, "http://localhost")
        if (url.pathname.startsWith("/api/auth/")) return yield* effect
        if (hasPtyConnectTicketURL(url)) return yield* effect
        if (config.mode === "disabled") return yield* effect

        if (ServerAuth.basicEnabled(config)) {
          const credential = yield* credentialFromRequest(request)
          if (ServerAuth.authorized(credential, config)) return yield* effect
        }

        if (ServerAuth.jwtEnabled(config)) {
          const bearerMatch = /^Bearer\s+([^\s]+)$/i.exec(request.headers.authorization ?? "")
          if (bearerMatch) {
            const jwtAuth = yield* JwtAuth.Service
            const valid = yield* jwtAuth.verifyAccessToken(bearerMatch[1]).pipe(
              Effect.match({ onSuccess: () => true, onFailure: () => false }),
            )
            if (valid) return yield* effect
          }
        }

        return yield* new UnauthorizedError({ message: "Authentication required" })
      }) as any,
    )
  }),
)
