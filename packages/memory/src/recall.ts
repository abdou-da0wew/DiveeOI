import { Effect, Layer, Context, Option, Array as Arr } from "effect"
import type { MemoryNode, MemoryNodeID, MemoryLink, RecallOptions, RecallResult, MemoryType, SessionID } from "./schema"
import { MemoryConfig } from "./config"
import { MemoryError } from "./schema"
import { GraphService } from "./graph"

/**
 * Recall Service - High-level API for memory retrieval
 * Wraps graph traversal with convenient methods
 */
export interface RecallService {
  readonly recall: (options: RecallOptions) => Effect.Effect<RecallResult, MemoryError>
  readonly recallFromSession: (sessionId: string, options?: Partial<RecallOptions>) => Effect.Effect<RecallResult, MemoryError>
  readonly recallFromQuery: (query: string, sessionId?: string, options?: Partial<RecallOptions>) => Effect.Effect<RecallResult, MemoryError>
  readonly recallByType: (type: MemoryType, sessionId?: string, limit?: number) => Effect.Effect<RecallResult, MemoryError>
  readonly recallRecent: (sessionId?: string, limit?: number, since?: number) => Effect.Effect<RecallResult, MemoryError>
  readonly recallHubs: (limit?: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly recallOrphans: (limit?: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getNodeWithContext: (nodeId: MemoryNodeID, depth?: number) => Effect.Effect<{ node: MemoryNode; edges: MemoryLink[] }, MemoryError>
}

export const RecallService = Context.Service<RecallService, RecallService>()("@diveeoi/memory/RecallService")

const makeRecallService = Effect.gen(function* () {
  const graph = yield* GraphService
  const config = yield* MemoryConfig

  const recall = (options: RecallOptions) =>
    graph.recall(options)

  const recallFromSession = (sessionId: string, options: Partial<RecallOptions> = {}) =>
    graph.recall({
      seedNodes: [sessionId as MemoryNodeID],
      maxDepth: options.maxDepth ?? config.recall.maxDepth,
      maxNodes: options.maxNodes ?? config.recall.maxNodes,
      types: options.types,
      minConfidence: options.minConfidence,
      timeRange: options.timeRange,
      queryTags: options.queryTags,
      currentSession: sessionId as SessionID
    })

  const recallFromQuery = (query: string, sessionId?: string, options: Partial<RecallOptions> = {}) =>
    graph.recall({
      seedNodes: [],
      maxDepth: options.maxDepth ?? config.recall.maxDepth,
      maxNodes: options.maxNodes ?? config.recall.maxNodes,
      types: options.types,
      minConfidence: options.minConfidence,
      queryTags: query.split(/\s+/).filter(t => t.length > 2),
      currentSession: sessionId as SessionID
    })

  const recallByType = (type: MemoryType, sessionId?: string, limit = 20) =>
    graph.recall({
      seedNodes: [],
      maxDepth: 1,
      maxNodes: limit,
      types: [type],
      currentSession: sessionId as SessionID
    })

  const recallRecent = (sessionId?: string, limit = 20, since?: number) =>
    graph.recall({
      seedNodes: [],
      maxDepth: 1,
      maxNodes: limit,
      timeRange: since ? { from: since, to: Date.now() } : undefined,
      currentSession: sessionId as SessionID
    })

  const recallHubs = (limit = 10) =>
    graph.getHubs(limit)

  const recallOrphans = (limit = 0) =>
    graph.getOrphans(limit)

  const getNodeWithContext = (nodeId: MemoryNodeID, depth = 1) =>
    Effect.gen(function* () {
      const result = yield* graph.getSubgraph([nodeId])
      return {
        node: result.nodes[0]!,
        edges: result.edges
      }
    })

  return {
    recall,
    recallFromSession,
    recallFromQuery,
    recallByType,
    recallRecent,
    recallHubs,
    recallOrphans,
    getNodeWithContext
  }
})

export const RecallLive = Layer.effect(
  RecallService,
  makeRecallService
)

export * as Recall from "./recall"