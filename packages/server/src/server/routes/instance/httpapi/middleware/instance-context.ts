import path from "node:path"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { RemoteSession, type RemoteConfig } from "@/ssh-client"
import { resolveRemoteProfile } from "@/ssh/remote-profiles"
import { WorkspaceRouteContext } from "./workspace-routing"

type RemoteEnvironment = {
  platform: NodeJS.Platform
  homeDirectory: string
}

type RemoteEnvironmentResult = { environment: RemoteEnvironment } | { error: Error }
type RemoteResolution =
  | { type: "local" }
  | { type: "remote"; config: RemoteConfig }
  | { type: "error"; response: HttpServerResponse.HttpServerResponse }

type RemoteProbe = Effect.Effect<RemoteEnvironmentResult>

export class InstanceContextMiddleware extends HttpApiMiddleware.Service<
  InstanceContextMiddleware,
  {
    requires: WorkspaceRouteContext
  }
>()("@opencode/ExperimentalHttpApiInstanceContext") {}

function decode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function sessionIDFromURL(input: string): SessionID | undefined {
  const pathname = new URL(input, "http://localhost").pathname
  const match = pathname.match(/(?:^|\/)session\/([^/]+)(?:\/|$)/)
  return match ? (decode(match[1]) as SessionID) : undefined
}

function resolveWorkingDirectory(input: string, homeDirectory: string) {
  const value = input.trim() || "~"
  if (value === "~") return homeDirectory
  if (value.startsWith("~/")) return path.posix.resolve(homeDirectory, value.slice(2))
  return value.startsWith("/") ? path.posix.normalize(value) : path.posix.resolve(homeDirectory, value)
}

function remoteEnvironment(
  cache: Map<string, RemoteProbe>,
  service: RemoteSession.Interface,
  key: string,
  config: RemoteConfig,
): RemoteProbe {
  const current = cache.get(key)
  if (current) return current

  const probe: RemoteProbe = service.probe(config).pipe(
    Effect.map(
      (result): RemoteEnvironmentResult =>
        result.ok
          ? {
              environment: {
                platform: result.platform,
                homeDirectory: result.homeDirectory,
              },
            }
          : { error: new Error(result.reason) },
    ),
    Effect.tap((result) => ("error" in result ? Effect.sync(() => cache.delete(key)) : Effect.void)),
  )
  cache.set(key, probe)
  if (cache.size > 40) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  return probe
}

function resolveRemote(
  reference: unknown,
  service: RemoteSession.Interface,
  environmentCache: Map<string, RemoteProbe>,
): Effect.Effect<RemoteResolution> {
  return Effect.gen(function* () {
    if (
      typeof reference !== "object" ||
      reference === null ||
      typeof (reference as { profileId?: unknown }).profileId !== "string"
    ) {
      return { type: "local" as const }
    }

    const profileId = (reference as { profileId: string }).profileId
    const requestedDirectory =
      typeof (reference as { workingDirectory?: unknown }).workingDirectory === "string"
        ? (reference as { workingDirectory: string }).workingDirectory
        : undefined
    const result = yield* Effect.tryPromise({
      try: () => resolveRemoteProfile({ profileId, workingDirectory: requestedDirectory }),
      catch: (error) => error as Error,
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ error }),
        onSuccess: (profile) => ({ profile }),
      }),
    )
    if ("error" in result) {
      return {
        type: "error" as const,
        response: HttpServerResponse.jsonUnsafe({ error: result.error.message }, { status: 502 }),
      }
    }
    if (!result.profile) {
      return {
        type: "error" as const,
        response: HttpServerResponse.jsonUnsafe(
          { error: "The selected SSH profile no longer exists" },
          { status: 404 },
        ),
      }
    }

    const profile = result.profile
    const config: RemoteConfig = {
      host: profile.host,
      port: profile.port,
      user: profile.user,
      auth: profile.auth,
      identity: `${profile.id}:${profile.updatedAt}`,
      workingDirectory: "/",
    }
    const environmentResult = yield* remoteEnvironment(
      environmentCache,
      service,
      `${profile.id}:${profile.updatedAt}`,
      config,
    )
    if ("error" in environmentResult) {
      return {
        type: "error" as const,
        response: HttpServerResponse.jsonUnsafe({ error: environmentResult.error.message }, { status: 502 }),
      }
    }
    return {
      type: "remote" as const,
      config: {
        ...config,
        workingDirectory: resolveWorkingDirectory(
          profile.workingDirectory,
          environmentResult.environment.homeDirectory,
        ),
        platform: environmentResult.environment.platform,
      },
    }
  })
}

function provideInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  store: InstanceStore.Interface,
  session: Session.Interface,
  remoteSession: RemoteSession.Interface,
  environmentCache: Map<string, RemoteProbe>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext | HttpRouter.Provided> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    const request = yield* HttpServerRequest.HttpServerRequest
    const id = sessionIDFromURL(request.url)
    const info = id ? yield* session.get(id).pipe(Effect.catch(() => Effect.succeed(undefined))) : undefined
    const resolution = yield* resolveRemote(info?.metadata?.remote, remoteSession, environmentCache)
    if (resolution.type === "error") return resolution.response

    const localDirectory = decode(route.directory)
    const remote = resolution.type === "remote" ? resolution.config : undefined
    const directory = remote?.workingDirectory ?? localDirectory
    const ctx = yield* store.load({
      directory,
      remote,
      localDirectory: remote ? localDirectory : undefined,
    })
    return yield* effect.pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.provideService(WorkspaceRef, route.workspaceID),
    )
  })
}

export const instanceContextLayer = Layer.effect(
  InstanceContextMiddleware,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const session = yield* Session.Service
    const remoteSession = yield* RemoteSession.Service
    const environmentCache = new Map<string, RemoteProbe>()
    return InstanceContextMiddleware.of((effect) =>
      provideInstanceContext(effect, store, session, remoteSession, environmentCache),
    )
  }),
)
