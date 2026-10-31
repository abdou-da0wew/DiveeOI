import { ServerAuth } from "@/server/auth"
import { Effect, Encoding, Layer, Redacted } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiError, HttpApiMiddleware } from "effect/unstable/httpapi"
import { hasPtyConnectTicketURL } from "@/server/shared/pty-ticket"
import { isPublicUIPath } from "@/server/shared/public-ui"
import { JwtAuth } from "@diveeoi/api/middleware/jwt"
export {
  Authorization as ServerAuthorization,
  authorizationLayer as serverAuthorizationLayer,
} from "@diveeoi/api/middleware/authorization"

const AUTH_TOKEN_QUERY = "auth_token"
const UNAUTHORIZED = 401

// Avoid HttpApiSecurity alternatives here: Effect security middleware wraps the
// full handler, so a downstream failure can make the next auth alternative run
// and remap an authorized NotFound into Unauthorized.
export class Authorization extends HttpApiMiddleware.Service<Authorization>()(
  "@opencode/ExperimentalHttpApiAuthorization",
  {
    error: HttpApiError.UnauthorizedNoContent,
  },
) {}

export class PtyConnectAuthorization extends HttpApiMiddleware.Service<PtyConnectAuthorization>()(
  "@opencode/ExperimentalHttpApiPtyConnectAuthorization",
  {
    error: HttpApiError.UnauthorizedNoContent,
  },
) {}

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

function credentialFromURL(url: URL, request: HttpServerRequest.HttpServerRequest) {
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

const validBearer = (request: HttpServerRequest.HttpServerRequest, jwtAuth: JwtAuth.Interface) => {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.authorization ?? "")
  if (!match) return Effect.succeed(false)
  return jwtAuth.verifyAccessToken(match[1]).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }))
}

function unauthorized(raw: boolean) {
  if (raw) return Effect.succeed(HttpServerResponse.empty({ status: UNAUTHORIZED }))
  return Effect.fail(new HttpApiError.Unauthorized({}))
}

function authorize<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  request: HttpServerRequest.HttpServerRequest,
  config: ServerAuth.Info,
  jwtAuth: JwtAuth.Interface,
  raw = false,
) {
  return Effect.gen(function* () {
    if (config.mode === "disabled") return yield* effect

    if (ServerAuth.basicEnabled(config)) {
      const credential = yield* credentialFromURL(new URL(request.url, "http://localhost"), request)
      if (ServerAuth.authorized(credential, config)) return yield* effect
    }

    if (ServerAuth.jwtEnabled(config) && (yield* validBearer(request, jwtAuth))) return yield* effect
    return yield* unauthorized(raw)
  })
}

export const authorizationRouterMiddleware = HttpRouter.middleware<{ handles: unknown }>()(
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    const jwtAuth = yield* JwtAuth.Service
    if (config.mode === "disabled") return (effect) => effect

    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, "http://localhost")
        if (isPublicUIPath(request.method, url.pathname)) return yield* effect
        return (yield* authorize(effect as Effect.Effect<unknown, unknown, never>, request, config, jwtAuth, true)) as HttpServerResponse.HttpServerResponse
      })
  }),
)

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    const jwtAuth = yield* JwtAuth.Service
    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* authorize(effect, request, config, jwtAuth)
      }),
    )
  }),
)

export const ptyConnectAuthorizationLayer = Layer.effect(
  PtyConnectAuthorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    const jwtAuth = yield* JwtAuth.Service
    return PtyConnectAuthorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, "http://localhost")
        if (hasPtyConnectTicketURL(url)) return yield* effect
        return yield* authorize(effect, request, config, jwtAuth)
      }),
    )
  }),
)
