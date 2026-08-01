import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { MemoryNodeID, MemoryType, LinkType } from "@diveeoi/memory/schema"
import { MemoryError } from "@diveeoi/memory/schema"
import { SessionMemoryIntegration } from "@/session/memory"
import { Config } from "@/config/config"
import { MemoryConfig } from "@diveeoi/memory"

interface Parameters {
  query?: string
  sessionId?: string
  types?: MemoryType[]
  tags?: string[]
  seedNodes?: MemoryNodeID[]
  maxDepth?: number
  maxNodes?: number
  minConfidence?: number
  timeRange?: { from: number; to: number }
  includeEdges?: boolean
}

interface Metadata {
  readonly sessionId: string
  readonly total: number
}

/**
 * Memory Retrieve Tool - Search and recall memories from the knowledge graph
 */
export const MemoryRetrieveTool = Tool.define<Schema.Schema.Type<typeof ParametersSchema>, Metadata, MemoryService | SessionMemoryIntegration>({
  id: "memory_retrieve",
  description: "Search and retrieve memories from the knowledge graph. Supports querying by text, tags, types, session, and graph traversal from seed nodes.",
  parameters: ParametersSchema,
  execute: ({ query, sessionId, types, tags, seedNodes, maxDepth, maxNodes, minConfidence, timeRange, includeEdges }, ctx) =>
    Effect.gen(function* () {
      const memory = yield* MemoryService
      const sessionMemory = yield* SessionMemoryIntegration

      const resolvedSessionId = sessionId ?? ctx.sessionID

      const recallOptions: any = {
        seedNodes: seedNodes ?? (resolvedSessionId ? [resolvedSessionId as MemoryNodeID] : []),
        maxDepth: maxDepth ?? 2,
        maxNodes: maxNodes ?? 20,
        types,
        minConfidence,
        timeRange,
        queryTags: tags ?? (query ? query.split(/\s+/).filter(t => t.length > 2) : []),
        currentSession: resolvedSessionId,
      }

      if (recallOptions.seedNodes.length === 0 && !query && !tags?.length) {
        const session = yield* sessionMemory.loadSessionContext(resolvedSessionId)
        if (session) {
          recallOptions.seedNodes = [resolvedSessionId as MemoryNodeID]
        }
      }

      const result = yield* memory.recall(recallOptions)

      const memories = result.nodes.map(node => ({
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

      if (includeEdges) {
        response.edges = result.edges.map(e => ({
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
    }).pipe(
      Effect.catchAll((err) =>
        Effect.fail(new MemoryError(`Memory retrieve failed: ${err}`))
      )
    ),
})

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