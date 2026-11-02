import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer, Option, Schema } from "effect"
import { JwtAuth } from "@diveeoi/api/middleware/jwt"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi"
import { ServerAuth } from "../../src/server/auth"
import {
  Authorization,
  authorizationLayer,
  ServerAuthorization,
  serverAuthorizationLayer,
} from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { testEffect } from "../lib/effect"

const Api = HttpApi.make("test-authorization").add(
  HttpApiGroup.make("test")
    .add(
      HttpApiEndpoint.get("probe", "/probe", {
        success: Schema.String,
      }),
      HttpApiEndpoint.get("missing", "/missing", {
        success: Schema.String,
        error: HttpApiError.NotFound,
      }),
    )
    .middleware(Authorization),
)

const ServerApi = HttpApi.make("test-server-authorization").add(
  HttpApiGroup.make("test.v2")
    .add(
      HttpApiEndpoint.get("probe", "/api/probe", {
        success: Schema.String,
      }),
    )
    .middleware(ServerAuthorization),
)

const handlers = HttpApiBuilder.group(Api, "test", (handlers) =>
  handlers
    .handle("probe", () => Effect.succeed("ok"))
    .handle("missing", () => Effect.fail(new HttpApiError.NotFound({}))),
)

const serverHandlers = HttpApiBuilder.group(ServerApi, "test.v2", (handlers) =>
  handlers.handle("probe", () => Effect.succeed("ok")),
)

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers), Layer.provide(authorizationLayer)),
  { disableListenLog: true, disableLogger: true },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest))

const v2ApiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(ServerApi).pipe(Layer.provide(serverHandlers), Layer.provide(serverAuthorizationLayer)),
  { disableListenLog: true, disableLogger: true },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest))

const noAuthLayer = ServerAuth.Config.layer({ password: Option.none(), username: "opencode", mode: "disabled" })
const secretLayer = ServerAuth.Config.layer({ password: Option.some("secret"), username: "opencode", mode: "both" })
const kitSecretLayer = ServerAuth.Config.layer({ password: Option.some("secret"), username: "kit", mode: "both" })

const jwtLayer = JwtAuth.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DIVEEOI_JWT_SECRET: "test-only-server-session-signing-key" }))),
)
const it = testEffect(apiLayer.pipe(Layer.provide([noAuthLayer, jwtLayer])))
const itSecret = testEffect(apiLayer.pipe(Layer.provide([secretLayer, jwtLayer])))
const itKitSecret = testEffect(apiLayer.pipe(Layer.provide([kitSecretLayer, jwtLayer])))
const itV2Secret = testEffect(Layer.provideMerge(v2ApiLayer, Layer.merge(secretLayer, jwtLayer)))

const basic = (username: string, password: string) => ServerAuth.header({ username, password }) ?? ""

const token = (username: string, password: string) => Buffer.from(`${username}:${password}`).toString("base64")

const getProbe = (headers?: Record<string, string>) =>
  HttpClientRequest.get("/probe").pipe(
    headers ? HttpClientRequest.setHeaders(headers) : (request) => request,
    HttpClient.execute,
  )

describe("HttpApi authorization middleware", () => {
  it.live("allows requests when server password is not configured", () =>
    Effect.gen(function* () {
      const response = yield* getProbe()

      expect(response.status).toBe(200)
      expect(yield* response.json).toBe("ok")
    }),
  )

  itSecret.live("creates and renews a four-day session cookie on the legacy instance API", () =>
    Effect.gen(function* () {
      const first = yield* HttpClientRequest.get("/probe").pipe(
        HttpClientRequest.setHeader("authorization", basic("opencode", "secret")),
        HttpClient.execute,
      )
      expect(first.status).toBe(200)

      const setCookie = first.headers["set-cookie"]
      expect(setCookie).toContain("Max-Age=345600")
      expect(setCookie).toContain("HttpOnly")
      const cookiePair = setCookie!.split(";")[0]!

      const second = yield* HttpClientRequest.get("/probe").pipe(
        HttpClientRequest.setHeader("cookie", cookiePair),
        HttpClient.execute,
      )
      expect(second.status).toBe(200)
      expect(second.headers["set-cookie"]).toContain("Max-Age=345600")
    }),
  )

  itSecret.live("requires configured password for basic auth", () =>
    Effect.gen(function* () {
      const [missing, badPassword, good] = yield* Effect.all(
        [
          getProbe(),
          getProbe({ authorization: basic("opencode", "wrong") }),
          getProbe({ authorization: basic("opencode", "secret") }),
        ],
        { concurrency: "unbounded" },
      )

      expect(missing.status).toBe(401)
      // No WWW-Authenticate challenge: browsers must not open their native Basic-auth popup.
      expect(missing.headers["www-authenticate"]).toBeUndefined()
      expect(badPassword.status).toBe(401)
      expect(badPassword.headers["www-authenticate"]).toBeUndefined()
      expect(good.status).toBe(200)
    }),
  )

  itKitSecret.live("respects configured basic auth username", () =>
    Effect.gen(function* () {
      const [defaultUser, configuredUser] = yield* Effect.all(
        [getProbe({ authorization: basic("opencode", "secret") }), getProbe({ authorization: basic("kit", "secret") })],
        { concurrency: "unbounded" },
      )

      expect(defaultUser.status).toBe(401)
      expect(configuredUser.status).toBe(200)
    }),
  )

  itSecret.live("accepts auth token query credentials", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get(`/probe?auth_token=${encodeURIComponent(token("opencode", "secret"))}`)

      expect(response.status).toBe(200)
    }),
  )

  itSecret.live("prefers auth token query credentials over basic auth", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.get(
        `/probe?auth_token=${encodeURIComponent(token("opencode", "secret"))}`,
      ).pipe(HttpClientRequest.setHeader("authorization", basic("opencode", "wrong")), HttpClient.execute)

      expect(response.status).toBe(200)
    }),
  )

  itSecret.live("preserves handler errors when basic auth succeeds", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.get("/missing").pipe(
        HttpClientRequest.setHeader("authorization", basic("opencode", "secret")),
        HttpClient.execute,
      )

      expect(response.status).toBe(404)
    }),
  )

  itSecret.live("preserves handler errors when auth token query succeeds", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get(`/missing?auth_token=${encodeURIComponent(token("opencode", "secret"))}`)

      expect(response.status).toBe(404)
    }),
  )

  itSecret.live("rejects malformed auth token query credentials", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get("/probe?auth_token=not-base64")

      expect(response.status).toBe(401)
    }),
  )

  itV2Secret.live("issues and rolls a four-day HttpOnly server session after Basic authentication", () =>
    Effect.gen(function* () {
      const first = yield* HttpClientRequest.get("/api/probe").pipe(
        HttpClientRequest.setHeader("authorization", basic("opencode", "secret")),
        HttpClient.execute,
      )

      expect(first.status).toBe(200)
      const firstCookie = first.headers["set-cookie"]
      expect(firstCookie).toBeString()
      expect(firstCookie).toContain("diveeoi_server_session=")
      expect(firstCookie).toContain("Max-Age=345600")
      expect(firstCookie).toContain("HttpOnly")
      expect(firstCookie).toContain("SameSite=Lax")
      const cookiePair = firstCookie!.split(";")[0]!

      const second = yield* HttpClientRequest.get("/api/probe").pipe(
        HttpClientRequest.setHeader("cookie", cookiePair),
        HttpClient.execute,
      )

      expect(second.status).toBe(200)
      expect(second.headers["set-cookie"]).toContain("diveeoi_server_session=")
      expect(second.headers["set-cookie"]).toContain("Max-Age=345600")
    }),
  )

  itV2Secret.live("rejects server-session cookies after the configured Basic password changes", () =>
    Effect.gen(function* () {
      const jwt = yield* JwtAuth.Service
      const oldSession = yield* jwt.signServerSession("opencode", "old-password")
      const response = yield* HttpClientRequest.get("/api/probe").pipe(
        HttpClientRequest.setHeader("cookie", `diveeoi_server_session=${oldSession}`),
        HttpClient.execute,
      )
      expect(response.status).toBe(401)
    }),
  )

  itV2Secret.live("returns bodyful v2 unauthorized errors", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get("/api/probe")
      const body = yield* response.json

      expect(response.status).toBe(401)
      expect(response.headers["www-authenticate"]).toBeUndefined()
      expect(body).toEqual({ _tag: "UnauthorizedError", message: "Authentication required" })
    }),
  )
})
