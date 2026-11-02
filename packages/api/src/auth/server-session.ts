import { Effect } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { SERVER_SESSION_IDLE_SECONDS } from "../middleware/jwt"

export const SERVER_SESSION_COOKIE = "diveeoi_server_session"

export function readServerSessionCookie(header: string | undefined) {
  for (const item of (header ?? "").split(";")) {
    const separator = item.indexOf("=")
    if (separator === -1) continue
    if (item.slice(0, separator).trim() !== SERVER_SESSION_COOKIE) continue
    const value = item.slice(separator + 1).trim()
    if (!value) return undefined
    try {
      return decodeURIComponent(value)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Roll the browser's persistent server session forward after successful activity.
 * The token and cookie share a four-day idle timeout, so neither can outlive the
 * other. HttpOnly prevents frontend JavaScript from reading the credential.
 */
function secureCookieRequest(request: HttpServerRequest.HttpServerRequest) {
  const forwardedProto = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim().toLowerCase()
  const requestUrl = new URL(request.url, "http://localhost")
  return requestUrl.protocol === "https:" || forwardedProto === "https"
}

export const appendServerSessionCookie = (token: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const secure = secureCookieRequest(request)

    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        HttpServerResponse.setCookieUnsafe(response, SERVER_SESSION_COOKIE, token, {
          path: "/",
          maxAge: SERVER_SESSION_IDLE_SECONDS * 1000,
          httpOnly: true,
          secure,
          sameSite: "lax",
        }),
      ),
    )
  })

export const appendExpiredServerSessionCookie = () =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const secure = secureCookieRequest(request)

    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        HttpServerResponse.expireCookieUnsafe(response, SERVER_SESSION_COOKIE, {
          path: "/",
          httpOnly: true,
          secure,
          sameSite: "lax",
        }),
      ),
    )
  })
