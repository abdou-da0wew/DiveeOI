import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { MemoryNodeID, MemoryType, LinkType } from "@diveeoi/memory/schema"
import { SessionMemoryIntegration } from "@/session/memory"

const ParametersSchema = Schema.Struct({
  query: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  types: Schema.optional(Schema.Array(MemoryType)),
  tags: Schema.optional(Schema.Array(Schema.String)),
  seedNodes: Schema.optional(Schema.Array(MemoryNodeID)),
  maxDepth: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 5 })))),
  maxNodes: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 })))),
  minConfidence: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })))),
  timeRange: Schema.optional(Schema.Struct({
    from: Schema.Number,
    to: Schema.Number
  })),
  includeEdges: Schema.optional(Schema.Boolean),
})

/**
 * Memory Retrieve Tool - Search and recall memories from the knowledge graph
 */
export const MemoryRetrieveTool = Tool.define(
  "memory_retrieve",
  Effect.gen(function* () {
    const memory = yield* MemoryService
    const sessionMemory = yield* SessionMemoryIntegration.Service

    return {
      description: "Search and retrieve memories from the knowledge graph. Supports querying by text, tags, types, session, and graph traversal from methods (seedNodes).",
      parameters: ParametersSchema,
      execute: (
        params: Schema.Schema.Type<typeof ParametersSchema>,
        ctx: Tool.Context
      ): Effect.Effect<Tool.ExecuteResult> =>
        Effect.gen(function* () {
          const resolvedSessionId = params.sessionId ?? ctx.sessionID

          const recallOptions: any = {
            seedNodes: params.seedNodes ?? (resolvedSessionId ? [resolvedSessionId as MemoryNodeID] : []),
            maxDepth: params.maxDepth ?? 2,
            maxNodes: params.maxNodes ?? 20,
            types: params.types,
            minConfidence: params.minConfidence,
            timeRange: params.timeRange,
            queryTags: params.tags ?? (params.query ? params.query.split(/\s+/).filter((t: string) => t.length > 2) : []),
            currentSession: resolvedSessionId,
          }

          if (recallOptions.seedNodes.length === 0 && !params.query && !params.tags?.length) {
            const session = yield* memory.loadSessionContext(resolvedSessionId)
            if (session.nodes.length > 0) {
              recallOptions.seedNodes = [resolvedSessionId as MemoryNodeID]
            }
          }

          const result = yield* memory.recall(recallOptions)

          const memories = result.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title,
            content: node.content,
            tags: node.tags,
            sessionId: node.sessionId,
            created: node.created,
            updated: node.updated,
            confidence: node.confidence,
            score: result.scores[node.id],
          }))

          const response: any = { memories, total: memories.length }

          if (params.includeEdges) {
            response.edges = result.edges.map((e) => ({
              sourceId: e.sourceId,
              targetId: e.targetId,
              type: e.type,
              created: e.created,
            }))
          }

          return {
            title: `Retrieved ${memories.length} memories`,
            output: JSON.stringify(response, null, 2),
            metadata: { sessionId: resolvedSessionId, total: memories.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
