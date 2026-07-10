import { Context, Effect } from "effect"

export const TraceId = Context.Reference<string>("~opencode/TraceId", {
  defaultValue: () => crypto.randomUUID(),
})

const log =
  (level: "debug" | "info" | "warn" | "error") =>
  (message: string, attrs?: Record<string, unknown>): Effect.Effect<void> =>
    Effect.gen(function* () {
      const traceId = yield* TraceId
      const allAttrs = attrs ? { ...attrs, traceId } : { traceId }
      switch (level) {
        case "debug":
          return yield* Effect.logDebug(message, allAttrs)
        case "info":
          return yield* Effect.logInfo(message, allAttrs)
        case "warn":
          return yield* Effect.logWarning(message, allAttrs)
        case "error":
          return yield* Effect.logError(message, allAttrs)
      }
    })

export const debug = log("debug")
export const info = log("info")
export const warn = log("warn")
export const error = log("error")

export const span = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
  attrs?: Record<string, unknown>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const t0 = Date.now()
    yield* info(`${name}.start`, attrs)
    const result = yield* effect
    yield* info(`${name}.end`, { ...attrs, duration_ms: Date.now() - t0 })
    return result
  })

export const withTrace = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const traceId = crypto.randomUUID()
    yield* info(`${name}.start`, { traceId })
    const t0 = Date.now()
    const result = yield* effect.pipe(Effect.provideService(TraceId, traceId))
    yield* info(`${name}.end`, { traceId, duration_ms: Date.now() - t0 })
    return result
  })

export * as Tracer from "./tracer"
