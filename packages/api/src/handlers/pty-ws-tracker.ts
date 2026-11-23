import { Context, Effect, Layer, Option } from "effect"
import * as Socket from "effect/unstable/socket/Socket"
import { AdaptiveResourceService, useAdaptiveTargets } from "@diveeoi/db/adaptive"

/**
 * Graceful-shutdown WebSocket tracking for API-package raw WebSocket handlers
 * (pty.connect). Mirrors the server's
 * `server/routes/instance/httpapi/websocket-tracker.ts` contract: during
 * graceful shutdown new sockets are rejected with a "server closing" close
 * frame, connection caps follow the adaptive resource targets, and closeAll
 * drains every tracked socket with 1001.
 *
 * The tag lives in the API package because dependency direction forbids the
 * API package from importing server internals; the server mounts a bridge
 * layer (its own tracker implementation) where it serves the API routes, and
 * standalone API usage degrades to "allowed" via Effect.serviceOption.
 */

export const SERVER_CLOSING_EVENT = () => new Socket.CloseEvent(1001, "server closing")

type Close = Effect.Effect<void, unknown>

export interface Interface {
  readonly add: (close: Close) => Effect.Effect<boolean, never, AdaptiveResourceService>
  readonly remove: (close: Close) => Effect.Effect<void>
  readonly closeAll: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ApiWebSocketTracker") {}

export const layer = Layer.sync(Service)(() => {
  const sockets = new Set<Close>()
  let closing = false
  return Service.of({
    add: (close) =>
      useAdaptiveTargets((targets) =>
        Effect.gen(function* () {
          if (closing) return false
          if (sockets.size >= targets.maxWSConnections) return false
          sockets.add(close)
          return true
        }),
      ),
    remove: (close) =>
      Effect.sync(() => {
        sockets.delete(close)
      }),
    closeAll: Effect.gen(function* () {
      closing = true
      const active = Array.from(sockets)
      sockets.clear()
      yield* Effect.all(
        active.map((close) =>
          close.pipe(
            Effect.timeout("1 second"),
            Effect.catch(() => Effect.void),
          ),
        ),
        { concurrency: "unbounded", discard: true },
      )
    }),
  })
})

/**
 * Register the current socket with the tracker when one is in scope; degrade
 * to "allowed" when running standalone without the service.
 */
export const register = (close: Close) =>
  Effect.gen(function* () {
    const tracker = yield* Effect.serviceOption(Service)
    if (Option.isNone(tracker)) return true
    const registered = yield* tracker.value.add(close)
    if (!registered) return false
    yield* Effect.addFinalizer(() => tracker.value.remove(close))
    return true
  })
