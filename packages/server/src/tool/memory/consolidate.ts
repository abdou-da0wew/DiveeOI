import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { SessionMemoryIntegration } from "@/session/memory"
import { MemoryError } from "@diveeoi/memory/schema"
import { MemoryConfig } from "@diveeoi/memory"
import { Config } from "@/config/config"

interface Parameters {
  sessionId?: string
  force?: boolean
}

interface Metadata {}

/**
 * Memory Consolidate Tool - Trigger memory consolidation for a session
 */
export const MemoryConsolidateTool = Tool.define<typeof ConsolidateParametersSchema, Metadata, MemoryService | SessionMemoryIntegration | MemoryConfig | Config.Service>({
  id: "memory_consolidate",
  description: "Trigger memory consolidation for a session. Merges similar memories, updates links, and runs graph optimization.",
  parameters: ConsolidateParametersSchema,
  execute: ({ sessionId, force }, ctx) =>
    Effect.gen(function* () {
      const memory = yield* MemoryService
      const sessionMemory = yield* SessionMemoryIntegration
      const config = yield* Config.Service

      const resolvedSessionId = sessionId ?? ctx.sessionID

      const memConfig = yield* MemoryConfig
      if (!memConfig.consolidation.enabled && !force) {
        return {
          title: "Consolidation disabled",
          output: JSON.stringify({
            message: "Consolidation is disabled in config. Use force: true to override.",
          }, null, 2),
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
      }
    }).pipe(
      Effect.catchAll((err) =>
        Effect.fail(new MemoryError(`Memory consolidate failed: ${err}`))
      )
    ),
})

const ConsolidateParametersSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  force: Schema.optional(Schema.Boolean),
})