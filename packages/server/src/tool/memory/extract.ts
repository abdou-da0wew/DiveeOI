import { Tool } from "../tool"
import { MemoryScheduler } from "@/session/memory-scheduler"
import { Effect, Schema } from "effect"
import { MemoryConfig } from "@diveeoi/memory"

const ExtractParametersSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  all: Schema.optional(Schema.Boolean),
})

export const MemoryExtractTool = Tool.define(
  "memory-extract",
  Effect.gen(function* () {
    const scheduler = yield* MemoryScheduler.MemorySchedulerService

    return {
      description: "Extract memories from the current session (or all sessions) using AI",
      parameters: ExtractParametersSchema,
      execute: (
        { sessionId: targetSessionId, all }: Schema.Schema.Type<typeof ExtractParametersSchema>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult> =>
        Effect.gen(function* () {
          if (all) {
            yield* scheduler.extractNow()
            return {
              title: "Memory extraction completed for all recent sessions",
              output: "Memory extraction completed for all recent sessions",
              metadata: {},
            }
          }
          const sid = targetSessionId ?? ctx.sessionID
          yield* scheduler.extractNow(sid)
          return {
            title: `Memory extraction completed for session ${sid}`,
            output: `Memory extraction completed for session ${sid}`,
            metadata: {},
          }
        }).pipe(Effect.provide(MemoryConfig.defaultLayer), Effect.orDie),
    }
  })
)

const StatusParametersSchema = Schema.Struct({})

export const MemoryExtractStatusTool = Tool.define(
  "memory-extract-status",
  Effect.gen(function* () {
    const scheduler = yield* MemoryScheduler.MemorySchedulerService

    return {
      description: "Check when the next automatic memory extraction will run",
      parameters: StatusParametersSchema,
      execute: (): Effect.Effect<Tool.ExecuteResult> =>
        Effect.gen(function* () {
          const nextRun = yield* scheduler.getNextRun()
          const output = nextRun === undefined
            ? "Memory scheduler is not running"
            : `Next automatic extraction: ${nextRun.toString()}`
          return { title: output, output, metadata: {} }
        }).pipe(Effect.orDie),
    }
  })
)

export const MemoryTools = [MemoryExtractTool, MemoryExtractStatusTool]
