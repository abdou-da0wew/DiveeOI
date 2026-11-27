import { defaultLayer as AdaptiveResourceDefaultLayer } from "@diveeoi/db/adaptive"
import { HttpClient, HttpRouter, HttpServerResponse } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { Effect, Layer } from "effect"
import { HttpApiProxy } from "../middleware/proxy"
import { Features } from "@/features"
import * as VoiceBridge from "@/voice/bridge"

/**
 * `/voice/*` routes: mounts the voice gateway (packages/voice) into the main
 * server.
 *
 * - `POST /voice/listen` — authed; registers a session for spoken replies and
 *   hands out a one-time WS ticket (pty ticket pattern — browsers cannot send
 *   Authorization headers on WebSocket handshakes).
 * - `GET  /voice/ws` — ticket-validated WebSocket, proxied to the gateway
 *   (mic audio in, transcript + TTS PCM out).
 * - `*    /voice/*` — authed HTTP proxy (demo UI assets, /cache audio,
 *   /healthz). The bridge talks to the gateway directly on its own port; the
 *   proxy exists for UI assets and diagnostics.
 */

const gatewayTarget = (requestURL: URL): URL => {
  const target = new URL(process.env.VOICE_GATEWAY_URL ?? "http://127.0.0.1:4747")
  target.pathname = requestURL.pathname
  target.search = requestURL.search
  return target
}

function requestURL(url: string): URL {
  return new URL(url, "http://voice.internal")
}

export const voiceListenRoute = HttpRouter.use((router) =>
  router.add("POST", "/voice/listen", (request) =>
    Effect.gen(function* () {
      if (!Features.flags.voice) {
        return HttpServerResponse.jsonUnsafe({ error: "voice feature disabled" }, { status: 404 })
      }
      const body = (yield* request.json) as
        | { sessionID?: unknown; lang?: unknown; on?: unknown }
        | undefined
      const sessionID = typeof body?.sessionID === "string" ? body.sessionID : ""
      const lang = body?.lang === "ar" ? ("ar" as const) : ("en" as const)
      const on = body?.on !== false
      if (!on && !sessionID) {
        return HttpServerResponse.jsonUnsafe({ error: "sessionID required" }, { status: 400 })
      }
      // An empty sessionID is a valid "pending" registration: the voice pill on
      // a new-session page attaches before the first prompt creates the
      // session, then re-registers once the real id exists.
      const result = yield* Effect.promise(() =>
        VoiceBridge.listen({ sessionID, lang, on }).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
      )
      if (!result.ok) {
        return HttpServerResponse.jsonUnsafe({ error: String(result.error) }, { status: 503 })
      }
      return HttpServerResponse.jsonUnsafe({ ticket: result.value.ticket, lang, on })
    }),
  ),
)

export const voiceWsRoute = HttpRouter.use((router) =>
  router.add("GET", "/voice/ws", (request) =>
    Effect.gen(function* () {
      const url = requestURL(request.url)
      const ticket = url.searchParams.get("ticket") ?? ""
      if (!VoiceBridge.consumeTicket(ticket)) {
        return HttpServerResponse.text("invalid or expired voice ticket", { status: 401 })
      }
      const headers = request.headers as Record<string, string>
      if (headers["upgrade"]?.toLowerCase() !== "websocket") {
        return HttpServerResponse.text("websocket upgrade required", { status: 400 })
      }
      return yield* HttpApiProxy.websocket(request, gatewayTarget(url))
    }),
  ),
).pipe(Layer.provide([Socket.layerWebSocketConstructorGlobal, AdaptiveResourceDefaultLayer]))

export const voiceProxyRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    yield* router.add("*", "/voice/*", (request) =>
      HttpApiProxy.http(client, gatewayTarget(requestURL(request.url)), undefined, request),
    )
  }),
)

export * as VoiceHandlers from "./voice"
