import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { SessionMemoryIntegration } from "@/session/memory"
import { MemoryConfig } from "@diveeoi/memory"

interface Parameters {
  sessionId?: string
  force?: boolean
}

interface Metadata {}

const ConsolidateParametersSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  force: Schema.optional(Schema.Boolean),
})

/**
 * Memory Consolidate Tool - Trigger memory consolidation for a session
 */
export const MemoryConsolidateTool = Tool.define(
  "memory_consolidate",
  Effect.gen(function* () {
    const memory = yield* MemoryService
    const sessionMemory = yield* SessionMemoryIntegration.Service
    const memConfig = yield* MemoryConfig

    return {
      description: "Trigger memory consolidation for a session. Merges similar memories, updates links, and runs graph optimization.",
      parameters: ConsolidateParametersSchema,
      execute: (
        params: { sessionId?: string; force?: boolean },
        ctx: Tool.Context
      ) =>
        Effect.gen(function* () {
          const { sessionId, force } = params
          const resolvedSessionId = sessionId ?? ctx.sessionID

          if (!memConfig.consolidation.enabled && !force) {
            return {
              title: "Consolidation disabled",
              output: JSON.stringify({
                message: "Consolidation is disabled in config. Use force: true to override.",
              }, null, 2),
              metadata: {},
            }
          }

          yield* memory.consolidate(resolvedSessionId)

          return {
            title: `Consolidated session: ${resolvedSessionId}`,
            output: JSON.stringify({
              sessionId: resolvedSessionId,
              status: "completed",
              timestamp: Date.now(),
            }, null, 2),
            metadata: {},
          }
        }).pipe(
          Effect.catch((err) =>
            Effect.succeed({
              title: "Memory consolidate failed",
              output: `Error: ${String(err)}`,
              metadata: {},
            })
          )
        ),
    }
  }),
)
