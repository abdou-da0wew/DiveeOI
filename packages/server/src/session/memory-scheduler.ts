import { Effect, Layer, Context, Schedule, DateTime, Duration } from "effect"
import { SessionMemoryIntegration } from "./memory"
import { MemoryConfig } from "@diveeoi/memory"
import { MemoryError } from "@diveeoi/memory/schema"
import { Database } from "@diveeoi/db/database/database"
import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { sql } from "drizzle-orm"

/**
 * Memory Scheduler - Runs automatic memory extraction daily at 12:00
 * and provides manual extraction trigger.
 */
export interface MemorySchedulerInterface {
  readonly start: () => Effect.Effect<void, MemoryError, MemoryConfig>
  readonly stop: () => Effect.Effect<void>
  readonly extractNow: (sessionId?: string) => Effect.Effect<void, MemoryError, MemoryConfig>
  readonly getNextRun: () => Effect.Effect<DateTime.DateTime | undefined>
}

export const MemorySchedulerService = Context.Service<MemorySchedulerInterface, MemorySchedulerInterface>()("@diveeoi/server/MemoryScheduler")

const makeScheduler = Effect.gen(function* () {
  const sessionMemory = yield* SessionMemoryIntegration.Service
  const config = yield* MemoryConfig
  const { db } = yield* Database.Service

  // State for the scheduled fiber
  const scheduleFiberRef = yield* Effect.makeRef<Effect.Fiber<unknown, unknown> | null>(null)
  const nextRunRef = yield* Effect.makeRef<DateTime.DateTime | undefined>(undefined)

  const extractForSession = (
    sessionId: string
  ): Effect.Effect<void, MemoryError, MemoryConfig> =>
    Effect.gen(function* () {
      // Get messages for this session
      const messages = yield* getSessionMessages(sessionId)
      if (messages.length === 0) return

      yield* sessionMemory.extractSessionMemory(sessionId, messages).pipe(
        Effect.catch((err) =>
          Effect.logError("Scheduled memory extraction failed", { sessionId, error: err })
        )
      )
    })

  const extractAllSessions = (): Effect.Effect<void, MemoryError, MemoryConfig> =>
    Effect.gen(function* () {
      // Get all active sessions from database
      const sessions = yield* Effect.tryPromise({
        try: async () => {
          const rows = await db.all(sql`
            SELECT id FROM sessions 
            WHERE updated_at > ${Date.now() - 7 * 24 * 60 * 60 * 1000}
            ORDER BY updated_at DESC
            LIMIT 50
          `)
          return rows.map((r: any) => r.id)
        },
        catch: (err) => new MemoryError({ cause: err })
      })

      // Extract for each session sequentially to avoid overwhelming the LLM
      for (const sessionId of sessions) {
        yield* extractForSession(sessionId).pipe(
          Effect.catch((err) =>
            Effect.logError("Session extraction failed", { sessionId, error: err })
          )
        )
        // Small delay between sessions
        yield* Effect.sleep("2 seconds")
      }
    })

  const getSessionMessages = (sessionId: string): Effect.Effect<Array<{ role: "user" | "assistant" | "system"; content: string }>, MemoryError> =>
    Effect.tryPromise({
      try: async () => {
        const rows = await db.all(sql`
          SELECT role, content FROM messages 
          WHERE session_id = ${sessionId}
          ORDER BY created_at ASC
        `)
        return rows.map((r: any) => ({
          role: r.role as "user" | "assistant" | "system",
          content: r.content
        }))
      },
      catch: (err) => new MemoryError({ cause: err })
    })

  const calculateNextRun = (): Effect.Effect<DateTime.DateTime> =>
    Effect.gen(function* () {
      const now = yield* DateTime.now
      const todayAtNoon = yield* DateTime.make({
        year: now.year,
        month: now.month,
        day: now.day,
        hour: 12,
        minute: 0,
        second: 0,
        millisecond: 0
      })
      
      // If it's already past noon today, schedule for tomorrow
      const nextRun = DateTime.greaterThan(now, todayAtNoon)
        ? yield* DateTime.add(todayAtNoon, Duration.days(1))
        : todayAtNoon
      
      return nextRun
    })

  const runSchedule = (): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      yield* Effect.logInfo("Memory scheduler started - daily extraction at 12:00")
      
      // Initial calculation of next run
      const nextRun = yield* calculateNextRun()
      yield* Effect.setRef(nextRunRef, nextRun)
      
      // Run immediately on startup for any sessions that need it
      yield* extractAllSessions().pipe(
        Effect.catchAll((err) => Effect.logError("Initial extraction failed", { error: err }))
      )
      
      // Schedule recurring daily at 12:00
      const schedule = Schedule.recursForever(
        Schedule.spaced(Duration.days(1))
      ).pipe(
        Schedule.addDelay(() => Effect.gen(function* () {
          const nextRun = yield* calculateNextRun()
          yield* Effect.setRef(nextRunRef, nextRun)
          const now = yield* DateTime.now
          const delay = yield* DateTime.toMillis(DateTime.diff(nextRun, now))
          return Duration.millis(Math.max(0, delay))
        }))
      )

      yield* Effect.sleepForever.pipe(
        Effect.provideService(Schedule.Schedule, schedule),
        Effect.tap(() => extractAllSessions().pipe(
          Effect.catchAll((err) => Effect.logError("Scheduled extraction failed", { error: err }))
        ))
      )
    })

  const start = (): Effect.Effect<void, MemoryError, MemoryConfig> =>
    Effect.gen(function* () {
      const existingFiber = yield* Effect.getRef(scheduleFiberRef)
      if (existingFiber) return
      
      const scope = yield* Effect.scope
      const fiber = yield* runSchedule().pipe(
        Effect.forkIn(scope)
      )
      
      yield* Effect.setRef(scheduleFiberRef, fiber)
      yield* Effect.logInfo("Memory scheduler started")
    })

  const stop = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const fiber = yield* Effect.getRef(scheduleFiberRef)
      if (fiber) {
        yield* Effect.interrupt(fiber)
        yield* Effect.setRef(scheduleFiberRef, null)
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
    Effect.getRef(nextRunRef)

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

export const node = LayerNode.make(MemorySchedulerLive, [
  SessionMemoryIntegration.node,
  Database.node,
])

export * as MemoryScheduler from "./memory-scheduler"