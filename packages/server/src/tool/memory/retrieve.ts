import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { MemoryConfig, MemoryService } from "@diveeoi/memory"
import { MemoryNodeID, MemoryType, SessionID } from "@diveeoi/memory/schema"
import { InstanceState } from "@/effect/instance-state"

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
    const config = yield* MemoryConfig

    return {
      description: "Search and retrieve memories by text, tags, type, or session context. Searches are scoped to the current project by default; explicit seed nodes enable graph traversal within the active project boundary.",
      parameters: ParametersSchema,
      execute: (
        params: Schema.Schema.Type<typeof ParametersSchema>,
        ctx: Tool.Context
      ): Effect.Effect<Tool.ExecuteResult> =>
        Effect.gen(function* () {
          const resolvedSessionId = params.sessionId ?? ctx.sessionID
          const instance = yield* InstanceState.context
          const projectRoot = instance.worktree !== "/" ? instance.worktree : instance.directory
          const scopedProjectRoot = config.features.projectBoundaries ? projectRoot : undefined
          const query = [params.query, ...(params.tags ?? [])].filter(Boolean).join(" ")
          const queryTags = [...new Set([
            ...(params.tags ?? []),
            ...(params.query?.match(/[\p{L}\p{N}]+/gu) ?? []),
          ])]

          const result = yield* (params.seedNodes?.length
            ? memory.recall({
                seedNodes: params.seedNodes,
                maxDepth: params.maxDepth ?? 2,
                maxNodes: params.maxNodes ?? 20,
                types: params.types,
                minConfidence: params.minConfidence,
                timeRange: params.timeRange,
                queryTags,
                currentSession: resolvedSessionId as SessionID,
                projectRoot: scopedProjectRoot as any,
              })
            : memory.loadSessionContext(
                resolvedSessionId,
                params.maxDepth ?? 2,
                params.maxNodes ?? 20,
                query,
                {
                  types: params.types,
                  minConfidence: params.minConfidence,
                  timeRange: params.timeRange,
                  projectRoot: scopedProjectRoot,
                },
              ))

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
