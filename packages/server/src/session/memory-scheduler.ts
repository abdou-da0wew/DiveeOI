import { Effect, Layer, Context, Schedule, DateTime, Duration, Ref, Fiber, Scope } from "effect"
import { SessionMemoryIntegration } from "./memory"
import { MemoryConfig } from "@diveeoi/memory"
import { MemoryError } from "@diveeoi/memory/schema"
import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { Session } from "./session"
import { SessionID } from "./schema"

/**
 * Memory Scheduler - Runs automatic memory extraction daily at 12:00
 * and provides manual extraction trigger.
 */

const EXTRACT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const MAX_EXTRACT_SESSIONS = 50

const EXTRACT_SESSION_DELAY = Duration.seconds(2)

export interface MemorySchedulerInterface {
  readonly start: () => Effect.Effect<void, MemoryError, MemoryConfig>
  readonly stop: () => Effect.Effect<void>
  readonly extractNow: (sessionId?: string) => Effect.Effect<void, MemoryError, MemoryConfig>
  readonly getNextRun: () => Effect.Effect<DateTime.DateTime | undefined>
}

export const MemorySchedulerService = Context.Service<MemorySchedulerInterface, MemorySchedulerInterface>()("@diveeoi/server/MemoryScheduler")

const makeScheduler = Effect.gen(function* () {
  const sessionMemory = yield* SessionMemoryIntegration.Service
  const sessions = yield* Session.Service
  const scope = yield* Scope.Scope

  // State for the scheduled fiber
  const scheduleFiberRef = yield* Ref.make<Fiber.Fiber<unknown, unknown> | null>(null)
  const nextRunRef = yield* Ref.make<DateTime.DateTime | undefined>(undefined)

  const extractForSession = (
    sessionId: string
  ): Effect.Effect<void, MemoryError, MemoryConfig> =>
    Effect.gen(function* () {
      // Get messages for this session
      const messages = yield* getSessionMessages(sessionId)
      if (messages.length === 0) return

      yield* sessionMemory.extractSessionMemory(sessionId, messages).pipe(
        Effect.catch((err) =>
          Effect.logError("Scheduled memory extraction failed", { sessionID: sessionId, error: err })
        )
      )
    })

  const extractAllSessions = (): Effect.Effect<void, MemoryError, MemoryConfig> =>
    Effect.gen(function* () {
      // Get the most recently updated sessions from the session service
      const cutoff = Date.now() - EXTRACT_WINDOW_MS
      const all = yield* sessions.listGlobal({ limit: MAX_EXTRACT_SESSIONS })
      const recent = all
        .filter((session) => session.time.updated > cutoff)
        .sort((a, b) => b.time.updated - a.time.updated)
        .slice(0, MAX_EXTRACT_SESSIONS)

      // Extract for each session sequentially to avoid overwhelming the LLM
      for (const info of recent) {
        yield* extractForSession(info.id).pipe(
          Effect.catch((err) =>
            Effect.logError("Session extraction failed", { sessionID: info.id, error: err })
          )
        )
        // Small delay between sessions
        yield* Effect.sleep(EXTRACT_SESSION_DELAY)
      }
    })

  const getSessionMessages = (sessionId: string): Effect.Effect<Array<{ role: "user" | "assistant" | "system"; content: string }>, MemoryError> =>
    sessions.messages({ sessionID: sessionId as SessionID }).pipe(
      Effect.mapError((err) => new MemoryError({ cause: err })),
      Effect.map((withParts) =>
        withParts.flatMap((message) => {
          const content = message.parts
            .filter((part) => part.type === "text" && !part.synthetic && !part.ignored)
            .map((part) => part.text)
            .join("\n\n")
          return content.length === 0
            ? []
            : [{ role: message.info.role, content }]
        })
      )
    )

  const calculateNextRun = (): Effect.Effect<DateTime.DateTime> =>
    Effect.gen(function* () {
      const now = yield* DateTime.now
      const todayAtNoon = DateTime.makeUnsafe({
        year: now.year,
        month: now.month,
        day: now.day,
        hour: 12,
        minute: 0,
        second: 0,
      })

      // If it's already past noon today, schedule for tomorrow
      const nextRun = DateTime.isGreaterThan(now, todayAtNoon)
        ? DateTime.addDuration(Duration.days(1))(todayAtNoon)
        : todayAtNoon

      return nextRun
    })

  const runSchedule = (): Effect.Effect<void, never, MemoryConfig> =>
    Effect.gen(function* () {
      yield* Effect.logInfo("Memory scheduler started - daily extraction at 12:00")

      // Initial calculation of next run
      const nextRun = yield* calculateNextRun()
      yield* Ref.set(nextRunRef, nextRun)

      // Run immediately on startup for any sessions that need it
      yield* extractAllSessions().pipe(
        Effect.catch((err) => Effect.logError("Initial extraction failed", { error: err }))
      )

      // Wait until the scheduled time, extract, then reschedule and repeat
      yield* Effect.gen(function* () {
        const target = yield* Ref.get(nextRunRef)
        const now = yield* DateTime.now
        const delayMs = target === undefined
          ? 0
          : Math.max(0, DateTime.toEpochMillis(target) - DateTime.toEpochMillis(now))
        if (delayMs > 0) {
          yield* Effect.sleep(Duration.millis(delayMs))
        }

        yield* extractAllSessions().pipe(
          Effect.catch((err) => Effect.logError("Scheduled extraction failed", { error: err }))
        )

        const next = yield* calculateNextRun()
        yield* Ref.set(nextRunRef, next)
      }).pipe(Effect.repeat(Schedule.forever))
    })

  const start = (): Effect.Effect<void, MemoryError, MemoryConfig> =>
    Effect.gen(function* () {
      const existingFiber = yield* Ref.get(scheduleFiberRef)
      if (existingFiber) return

      const fiber = yield* runSchedule().pipe(Effect.forkIn(scope))

      yield* Ref.set(scheduleFiberRef, fiber)
      yield* Effect.logInfo("Memory scheduler started")
    })

  const stop = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const fiber = yield* Ref.get(scheduleFiberRef)
      if (fiber) {
        yield* Fiber.interrupt(fiber)
        yield* Ref.set(scheduleFiberRef, null)
        yield* Effect.logInfo("Memory scheduler stopped")
      }
    })

  const extractNow = (sessionId?: string): Effect.Effect<void, MemoryError, MemoryConfig> =>
    Effect.gen(function* () {
      if (sessionId) {
        yield* extractForSession(sessionId)
      } else {
        yield* extractAllSessions()
      }
    })

  const getNextRun = (): Effect.Effect<DateTime.DateTime | undefined> =>
    Ref.get(nextRunRef)

  return { start, stop, extractNow, getNextRun }
})

export const MemorySchedulerLive = Layer.effect(
  MemorySchedulerService,
  Effect.gen(function* () {
    const scheduler = yield* makeScheduler
    yield* scheduler.start()
    return scheduler
  })
).pipe(Layer.provide(MemoryConfig.defaultLayer))

export const defaultLayer = MemorySchedulerLive.pipe(
  Layer.provide(SessionMemoryIntegration.defaultLayer),
  Layer.provide(Session.defaultLayer),
)

export const node = LayerNode.make(MemorySchedulerLive, [
  SessionMemoryIntegration.node,
  Session.node,
])

export * as MemoryScheduler from "./memory-scheduler"