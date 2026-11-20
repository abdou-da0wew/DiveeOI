import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { RemoteSession, type RemoteConfig } from "@/ssh-client"
import { ServerAuth } from "@/server/auth"
import { authorizationRouterMiddleware } from "../middleware/authorization"
import {
  deleteRemoteProfile,
  discoverSSHHosts,
  generateSSHKey,
  listRemoteProfiles,
  listSSHKeys,
  resolveRemoteProfile,
  saveRemoteProfile,
} from "@/ssh/remote-profiles"
import type { RemoteProfileInput } from "@/ssh/remote-types"

function jsonError(error: unknown, status = 400) {
  return HttpServerResponse.jsonUnsafe(
    { ok: false, reason: error instanceof Error ? error.message : String(error) },
    { status },
  )
}

function parseBody(text: string) {
  if (text.length > 64 * 1024) throw new Error("Remote management request is too large")
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error("Request body must be valid JSON")
  }
}

function profileIDFromPath(url: string, suffix = "") {
  const segments = new URL(url, "http://localhost").pathname.split("/").filter(Boolean)
  if (segments[0] !== "api" || segments[1] !== "v1" || segments[2] !== "remote" || segments[3] !== "profiles") {
    return undefined
  }
  const expectedLength = suffix ? 6 : 5
  if (segments.length !== expectedLength || (suffix && segments[5] !== suffix)) return undefined
  return decodeURIComponent(segments[4]!)
}

export const remoteProbeRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const svc = yield* RemoteSession.Service

    yield* router.add("GET", "/api/v1/remote/discovery", () =>
      Effect.tryPromise({ try: () => discoverSSHHosts(), catch: (error) => error as Error }).pipe(
        Effect.map((result) => HttpServerResponse.jsonUnsafe({ ok: true, ...result })),
        Effect.catch((error) => Effect.succeed(jsonError(error, 500))),
      ),
    )

    yield* router.add("GET", "/api/v1/remote/profiles", () =>
      Effect.tryPromise({ try: () => listRemoteProfiles(), catch: (error) => error as Error }).pipe(
        Effect.map((profiles) => HttpServerResponse.jsonUnsafe({ ok: true, profiles })),
        Effect.catch((error) => Effect.succeed(jsonError(error, 500))),
      ),
    )

    yield* router.add("POST", "/api/v1/remote/profiles", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const body = parseBody(yield* request.text)
        const profile = yield* Effect.tryPromise({
          try: () => saveRemoteProfile(body as unknown as RemoteProfileInput),
          catch: (error) => error as Error,
        })
        return HttpServerResponse.jsonUnsafe({ ok: true, profile })
      }).pipe(Effect.catch((error) => Effect.succeed(jsonError(error)))),
    )

    yield* router.add("DELETE", "/api/v1/remote/profiles/:profileId", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const profileId = profileIDFromPath(request.url)
        if (!profileId) return jsonError(new Error("Profile ID is required"))
        const removed = yield* Effect.tryPromise({
          try: () => deleteRemoteProfile(profileId),
          catch: (error) => error as Error,
        })
        return HttpServerResponse.jsonUnsafe({ ok: true, removed })
      }).pipe(Effect.catch((error) => Effect.succeed(jsonError(error)))),
    )

    yield* router.add("POST", "/api/v1/remote/profiles/:profileId/probe", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const profileId = profileIDFromPath(request.url, "probe")
        if (!profileId) return jsonError(new Error("Profile ID is required"))
        const profile = yield* Effect.tryPromise({
          try: () => resolveRemoteProfile({ profileId }),
          catch: (error) => error as Error,
        })
        if (!profile) return jsonError(new Error("SSH profile not found"), 404)
        const result = yield* svc.probe({
          host: profile.host,
          port: profile.port,
          user: profile.user,
          auth: profile.auth,
          identity: `${profile.id}:${profile.updatedAt}`,
          workingDirectory: "/",
        })
        return HttpServerResponse.jsonUnsafe(result)
      }).pipe(Effect.catch((error) => Effect.succeed(jsonError(error)))),
    )

    yield* router.add("GET", "/api/v1/remote/keys", () =>
      Effect.tryPromise({ try: () => listSSHKeys(), catch: (error) => error as Error }).pipe(
        Effect.map((keys) => HttpServerResponse.jsonUnsafe({ ok: true, keys })),
        Effect.catch((error) => Effect.succeed(jsonError(error, 500))),
      ),
    )

    yield* router.add("POST", "/api/v1/remote/keys", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const body = parseBody(yield* request.text)
        if (typeof body.name !== "string") return jsonError(new Error("Key name is required"))
        const key = yield* Effect.tryPromise({
          try: () => generateSSHKey(body.name as string),
          catch: (error) => error as Error,
        })
        return HttpServerResponse.jsonUnsafe({ ok: true, key })
      }).pipe(Effect.catch((error) => Effect.succeed(jsonError(error)))),
    )

    yield* router.add("POST", "/api/v1/remote/probe", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const body = parseBody(yield* request.text)
        if (
          typeof body.host !== "string" ||
          typeof body.user !== "string" ||
          typeof body.auth !== "object" ||
          body.auth === null
        ) {
          return jsonError(new Error("Host, username, and authentication are required"))
        }
        const config: RemoteConfig = {
          host: body.host,
          port: Number(body.port ?? 22),
          user: body.user,
          auth: body.auth as RemoteConfig["auth"],
          identity: "one-off-probe",
          workingDirectory: typeof body.workingDirectory === "string" ? body.workingDirectory : "/",
        }
        return HttpServerResponse.jsonUnsafe(yield* svc.probe(config))
      }).pipe(Effect.catch((error) => Effect.succeed(jsonError(error, 500)))),
    )
  }),
).pipe(
  Layer.provide(RemoteSession.defaultLayer),
  Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))),
)
