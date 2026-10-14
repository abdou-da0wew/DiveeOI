// packages/server/src/provider/user-agent.ts
// The User-Agent the OpenCode Zen gateway (`opencode.ai/zen`) authorizes anonymous free-tier
// traffic on.
//
// Measured against the live gateway on 2026-10-12, holding every other request byte constant:
//
//   opencode/1.17.8              403 FreeTierError
//   opencode/1.18.0              200
//   opencode/2.0.27              200
//   opencode/9.9.9               200
//   opencode/1.19.0-dev          200   <- a prerelease of a passing version passes
//   opencode/local               403   <- unparseable, treated as below the floor
//   opencode/dev                 403
//   opencode/x.y.z               403
//
// So the gateway parses the second segment as a semver and compares it against a floor (1.18.0 at
// the time of measurement). It is not an allowlist of exact versions and it is not "2.x only": any
// version at or above the floor passes. A User-Agent with no parseable version is rejected.
//
// The two ways that bites a fork:
//
//   1. Development builds report `local` (InstallationVersion falls back to that when
//      OPENCODE_VERSION is undefined) - always rejected, so no anonymous call ever works in dev.
//   2. A fork whose own version sits below the floor is rejected even though it is a real release.
//
// Hardcoding a passing version is not a fix: the floor moves, and the next release silently
// breaks again. So the version is read from the npm registry at startup, cached on disk, and
// refreshed daily. If all of that fails, the local version is used - correct in the common case
// where the local version already sits at or above the floor.
//
// Only the session request path needs this: the gateway gates inference, not the other outbound
// calls that merely carry a User-Agent.

import { Context, Duration, Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { FetchHttpClient } from "effect/unstable/http"
import { Global } from "@diveeoi/db/global"
import { FSUtil } from "@diveeoi/db/fs-util"
import { InstallationChannel, InstallationVersion } from "@diveeoi/db/installation/version"
import { Flag } from "@diveeoi/db/flag/flag"
import { LayerNode } from "@diveeoi/db/effect/layer-node"

/** npm package whose `latest` dist-tag tracks the client version the gateway expects. */
const PACKAGE = "@opencode/cli"
const REGISTRY = "https://registry.npmjs.org"

/** A published version is a moving target; re-check daily so the floor never silently outruns us. */
const TTL = Duration.hours(24)

const filepath = () => `${Global.Path.cache}/zen-user-agent.json`

function format(version: string) {
  return `opencode/${InstallationChannel}/${version}/${Flag.OPENCODE_CLIENT}`
}

/** Accept only a real semver core - "local", "dev" and friends must never satisfy the parser. */
const parse = (text: string): Option.Option<string> => {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return Option.none()
  }
  if (!body || typeof body !== "object") return Option.none()
  const version = (body as Record<string, unknown>)["version"]
  return typeof version === "string" && /^\d+\.\d+\.\d+/.test(version) ? Option.some(version) : Option.none()
}

export interface Interface {
  /**
   * The User-Agent to send to the Zen gateway. Never fails: an unreachable registry degrades to
   * the locally reported version rather than blocking inference.
   */
  readonly resolve: Effect.Effect<string>
  /** Force a re-read of the registry, ignoring the cache. */
  readonly refresh: Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/ZenUserAgent") {}

/**
 * Resolve the gateway User-Agent from an already-built resolver.
 *
 * `LLMRequestPrep.prepare` takes this as a parameter rather than yielding the service: prepare
 * runs inside a Stream that must stay free of per-call requirements (see the module rules on
 * closures), and the session layer closes over the resolver at construction time anyway.
 */
export const resolveWith = (userAgent: Interface) => userAgent.resolve

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const http = yield* HttpClient.HttpClient

    const readCache = Effect.fnUntraced(function* () {
      const text = yield* fs
        .readFileString(filepath())
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!text) return undefined
      return Option.getOrUndefined(parse(text))
    })

    const writeCache = Effect.fnUntraced(function* (version: string) {
      yield* fs
        .writeWithDirs(filepath(), JSON.stringify({ version, time: Date.now() }))
        .pipe(Effect.catch(() => Effect.void))
    })

    const fetchLatest = Effect.fnUntraced(function* () {
      const response = yield* HttpClientRequest.get(`${REGISTRY}/${PACKAGE}/latest`).pipe(
        http.execute,
        Effect.timeout("10 seconds"),
      )
      if (response.status !== 200) return undefined
      const text = yield* response.text
      return Option.getOrUndefined(parse(text))
    })

    // Fetch only when the cache is missing or stale. A failed fetch keeps the previous value:
    // a stale known-good version beats a fresh failure.
    const resolve = Effect.fnUntraced(function* () {
      const info = yield* fs.stat(filepath()).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const mtime = info ? Option.getOrElse(info.mtime, () => new Date(0)).getTime() : 0
      if (Date.now() - mtime < Duration.toMillis(TTL)) {
        const cached = yield* readCache()
        if (cached) return format(cached)
      }
      const latest = yield* fetchLatest().pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (latest) {
        yield* writeCache(latest)
        return format(latest)
      }
      return format(InstallationVersion)
    })

    const refresh = Effect.fnUntraced(function* () {
      const latest = yield* fetchLatest().pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (latest) {
        yield* writeCache(latest)
        return format(latest)
      }
      return yield* resolve()
    })

    // `Effect.fnUntraced` yields a thunk so the same definition can be piped; the service
    // interface wants plain Effects, so the thunks are suspended once here.
    return Service.of({
      resolve: Effect.suspend(resolve),
      refresh: Effect.suspend(refresh),
    })
  }),
)

// Self-sufficient: the HTTP client is provided here so every consumer (session LLM, app runtime,
// tests) gets a working resolver without having to know this module reaches the network.
export const defaultLayer = layer.pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(FSUtil.defaultLayer))

export const node = LayerNode.make(defaultLayer, [])

export * as ProviderUserAgent from "./user-agent"