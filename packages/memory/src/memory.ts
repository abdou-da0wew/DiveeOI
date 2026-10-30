import { Effect, Layer, Context, Option, Array as Arr, Schema, PartitionedSemaphore, Scope, Fiber } from "effect"
import type { LLMClient } from "@diveeoi/llm"
import type { MemoryNode, MemoryNodeID, MemoryLink, CreateNodeInput, PatchNode, MemoryType, LinkType, RecallOptions, RecallResult, ExtractedMemory, MemoryError, NodeNotFoundError } from "./schema"
import { SessionMemory, SessionID } from "./schema"
import { MemoryConfig } from "./config"
import { NodeService, extractWikilinks } from "./node"
import { IndexerService } from "./indexer"
import { GraphService } from "./graph"
import { ExtractorService } from "./extractor"
import { Database } from "@diveeoi/db/database/database"

const QUERY_STOP_WORDS = new Set(
  "a an and are as at be been being but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves".split(" "),
)
const DURABLE_MEMORY_TYPES: MemoryType[] = ["preference", "decision", "pattern", "entity", "error", "fact", "constraint"]

const queryTerms = (query: string): string[] => {
  const words = query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(words)]
    .filter((word) => word.length > 1 && !/^\d+$/u.test(word) && !QUERY_STOP_WORDS.has(word))
    .sort((a, b) => b.length - a.length)
    .slice(0, 12)
}

/**
 * Main Memory Service - High-level API for the memory system
 */
export interface MemoryService {
  // Node CRUD
  readonly createNode: (input: CreateNodeInput) => Effect.Effect<MemoryNode, MemoryError>
  readonly getNode: (id: MemoryNodeID) => Effect.Effect<Option.Option<MemoryNode>, MemoryError>
  readonly updateNode: (id: MemoryNodeID, patch: PatchNode) => Effect.Effect<MemoryNode, MemoryError | NodeNotFoundError>
  readonly deleteNode: (id: MemoryNodeID) => Effect.Effect<void, MemoryError>

  // Links
  readonly addLink: (source: MemoryNodeID, target: MemoryNodeID, type?: LinkType) => Effect.Effect<void, MemoryError>
  readonly removeLink: (source: MemoryNodeID, target: MemoryNodeID) => Effect.Effect<void, MemoryError>
  readonly getBacklinks: (nodeId: MemoryNodeID) => Effect.Effect<MemoryLink[], MemoryError>

  // Recall (graph traversal)
  readonly recall: (options: RecallOptions) => Effect.Effect<RecallResult, MemoryError>

  // Session integration
  readonly getSessionMemory: (sessionId: string, projectRoot?: string) => Effect.Effect<SessionMemory, MemoryError>
  readonly bindSessionMemory: (sessionId: string, rootNodeId: MemoryNodeID) => Effect.Effect<void, MemoryError>
  readonly createSessionRoot: (sessionId: string, title: string, projectRoot?: string) => Effect.Effect<MemoryNode, MemoryError>
  readonly loadSessionContext: (
    sessionId: string,
    maxDepth?: number,
    maxNodes?: number,
    query?: string,
    filters?: Partial<Pick<RecallOptions, "types" | "minConfidence" | "timeRange">> & { projectRoot?: string },
  ) => Effect.Effect<RecallResult, MemoryError>

  // Extraction from sessions
  readonly extractFromSession: (sessionId: string, messages: any[]) => Effect.Effect<MemoryNode[], MemoryError>
  readonly extractFromMessages: (messages: any[], sessionId: string) => Effect.Effect<ExtractedMemory[], MemoryError>

  // Consolidation (background dreaming)
  readonly consolidate: (sessionId: string) => Effect.Effect<void, MemoryError>

  // Search & utilities
  readonly search: (query: string, limit?: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getRecent: (limit: number, since?: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getStats: () => Effect.Effect<{ nodes: number; links: number; sessions: number }, MemoryError>

  // Non-blocking init support
  /** Block until indexer init is complete (returns immediately if already done) */
  readonly waitForIndexer: () => Effect.Effect<void, MemoryError>
  /** Check if indexer is ready (non-blocking) */
  readonly isIndexerReady: () => Effect.Effect<boolean>
}

export const MemoryService = Context.Service<MemoryService, MemoryService>()("@diveeoi/memory/MemoryService")

const makeMemoryService = Effect.gen(function* () {
  const nodeService = yield* NodeService
  const indexer = yield* IndexerService
  const graph = yield* GraphService
  const extractor = yield* ExtractorService
  const config = yield* MemoryConfig
  const { db } = yield* Database.Service
  const scope = yield* Scope.Scope

  // Initialize indexer — non-blocking if feature enabled (default: true)
  // Init runs in a background fiber; callers needing init complete should use waitForIndexer()
  if (config.features.nonBlockingInit) {
    const initFiber = yield* Effect.forkIn(
      indexer.initialize().pipe(
        Effect.tap(() =>
          Effect.gen(function* () {
            if (config.features.notifications) {
              yield* Effect.logInfo("Memory indexer initialized")
            }
          })
        ),
        Effect.catchCause((cause) =>
          Effect.logError("Memory indexer init failed", { cause })
        )
      ),
      scope
    )
    // Store fiber for tracking if needed
    void initFiber
  } else {
    // Blocking mode — wait for init to complete before returning
    yield* indexer.initialize().pipe(
      Effect.tap(() =>
        Effect.gen(function* () {
          if (config.features.notifications) {
            yield* Effect.logInfo("Memory indexer initialized")
          }
        })
      )
    )
  }

  // PartitionedSemaphore per session for race condition prevention (1 permit per session key)
  const sessionLocks = yield* PartitionedSemaphore.make<string>({ permits: 1 })

  // --- Node CRUD ---

  const createNode = (input: CreateNodeInput): Effect.Effect<MemoryNode, MemoryError> =>
    Effect.gen(function* () {
      const sessionMemory = input.type === "session"
        ? undefined
        : yield* getSessionMemory(input.sessionId, input.projectRoot)
      let projectRoot = input.projectRoot
      if (sessionMemory) {
        const rootNode = yield* indexer.getNode(sessionMemory.rootNodeId)
        if (Option.isSome(rootNode)) projectRoot ??= rootNode.value.projectRoot
      }

      const node = yield* nodeService.create({ ...input, projectRoot })

      // Index the node
      yield* indexer.upsertNode(node)

      // Process wikilinks in content
      const linkIds = extractWikilinks(node.content)
      for (const linkId of linkIds) {
        yield* indexer.upsertLink(node.id, linkId.target as MemoryNodeID, "references")
      }

      // Process explicit links from input
      if (input.links && input.links.length > 0) {
        for (const link of input.links) {
          yield* indexer.upsertLink(node.id, link.targetId, link.type ?? "references")
        }
      }

      if (sessionMemory) {
        yield* indexer.upsertLink(sessionMemory.rootNodeId, node.id, "references")
      }

      return node
    })

  const getNode = (id: MemoryNodeID): Effect.Effect<Option.Option<MemoryNode>, MemoryError> =>
    Effect.gen(function* () {
      // Try indexer first (fast), fallback to file
      const indexed = yield* indexer.getNode(id)
      if (Option.isSome(indexed)) return indexed
      
      // Fallback to file system
      return yield* nodeService.get(id)
    })

  const updateNode = (id: MemoryNodeID, patch: PatchNode): Effect.Effect<MemoryNode, MemoryError | NodeNotFoundError> =>
    Effect.gen(function* () {
      const node = yield* nodeService.update(id, patch)
      
      // Update index
      yield* indexer.upsertNode(node)
      
      // Re-process wikilinks if content changed
      if (patch.content) {
        // Remove old links
        const oldLinks = yield* indexer.getLinks(id)
        for (const link of oldLinks) {
          yield* indexer.deleteLink(id, link.targetId)
        }
        
        // Add new links
        const linkIds = extractWikilinks(node.content)
        for (const linkId of linkIds) {
          yield* indexer.upsertLink(node.id, linkId.target as MemoryNodeID, "references")
        }
      }
      
      return node
    })

  const deleteNode = (id: MemoryNodeID): Effect.Effect<void, MemoryError> =>
    Effect.gen(function* () {
      yield* nodeService.delete(id)
      yield* indexer.deleteNode(id)
    })

  // --- Links ---

  const addLink = (source: MemoryNodeID, target: MemoryNodeID, type: LinkType = "references"): Effect.Effect<void, MemoryError> =>
    indexer.upsertLink(source, target, type)

  const removeLink = (source: MemoryNodeID, target: MemoryNodeID): Effect.Effect<void, MemoryError> =>
    indexer.deleteLink(source, target)

  const getBacklinks = (nodeId: MemoryNodeID): Effect.Effect<MemoryLink[], MemoryError> =>
    indexer.getBacklinks(nodeId)

  // --- Recall ---

  const recall = (options: RecallOptions): Effect.Effect<RecallResult, MemoryError> =>
    Effect.gen(function* () {
      // Ensure seeds exist
      const validSeeds = yield* Effect.all(
        options.seedNodes.map(id => indexer.getNode(id).pipe(Effect.map(Option.isSome)))
      )
      const filteredSeeds = options.seedNodes.filter((_, i) => validSeeds[i])

      if (filteredSeeds.length === 0) {
        return { nodes: [], edges: [], scores: {} }
      }

      return yield* graph.recall({
        ...options,
        seedNodes: filteredSeeds
      })
    })

  // --- Session Memory ---

  const getSessionMemory = (sessionId: string, projectRoot?: string): Effect.Effect<SessionMemory, MemoryError> =>
    Effect.gen(function* () {
      // Use partitioned semaphore to prevent race condition on session initialization
      return yield* PartitionedSemaphore.withPermit(sessionLocks, sessionId)(Effect.gen(function* () {
        const rootNodeId = yield* indexer.getSessionRoot(sessionId)

        if (Option.isNone(rootNodeId)) {
          const rootNode = yield* createSessionRoot(sessionId, "Untitled", projectRoot)
          return SessionMemory.make({
            sessionId: sessionId as SessionID,
            rootNodeId: rootNode.id,
            nodeIds: [rootNode.id],
            loadedAt: Date.now()
          })
        }

        if (projectRoot) {
          const rootNode = yield* indexer.getNode(rootNodeId.value)
          if (Option.isSome(rootNode) && rootNode.value.projectRoot !== projectRoot) {
            const scopedRoot = { ...rootNode.value, projectRoot: projectRoot as any }
            yield* nodeService.writeFile(scopedRoot)
            yield* indexer.upsertNode(scopedRoot)
          }
        }

        // Load connected graph
        const sessionNodes = yield* indexer.getSessionNodes(sessionId)

        return SessionMemory.make({
          sessionId: sessionId as SessionID,
          rootNodeId: rootNodeId.value,
          nodeIds: sessionNodes.map(n => n.id),
          loadedAt: Date.now()
        })
      }))
    })

  const bindSessionMemory = (sessionId: string, rootNodeId: MemoryNodeID): Effect.Effect<void, MemoryError> =>
    indexer.bindSession(sessionId, rootNodeId)

  const createSessionRoot = (sessionId: string, title: string, projectRoot?: string): Effect.Effect<MemoryNode, MemoryError> =>
    Effect.gen(function* () {
      const rootNode = yield* createNode({
        type: "session",
        title: `Session: ${title}`,
        content: `Root memory node for session ${sessionId}`,
        tags: ["session", "root"],
        sessionId: sessionId as SessionID,
        projectRoot: projectRoot as any,
      })

      // Bind session to root node
      yield* indexer.bindSession(sessionId, rootNode.id)

      return rootNode
    })

  const loadSessionContext = (
    sessionId: string,
    maxDepth = 2,
    maxNodes = 15,
    query = "",
    filters: Partial<Pick<RecallOptions, "types" | "minConfidence" | "timeRange">> & { projectRoot?: string } = {},
  ): Effect.Effect<RecallResult, MemoryError> =>
    Effect.gen(function* () {
      const sessionMemory = yield* getSessionMemory(sessionId, filters.projectRoot)
      const queryTags = queryTerms(query)
      const projectRoot = config.features.projectBoundaries ? filters.projectRoot : undefined
      const queryMatches = yield* Effect.forEach(
        queryTags.slice(0, 4),
        (term) => indexer.searchNodes(term, 4, projectRoot),
        { concurrency: 4 },
      )
      const seedNodes = [...new Set([
        sessionMemory.rootNodeId,
        ...sessionMemory.nodeIds,
        ...queryMatches.flatMap((nodes) => nodes.map((node) => node.id)),
      ])]

      return yield* recall({
        seedNodes,
        maxDepth,
        maxNodes,
        types: filters.types ?? DURABLE_MEMORY_TYPES,
        minConfidence: filters.minConfidence ?? config.recall.minConfidence,
        timeRange: filters.timeRange,
        queryTags,
        currentSession: sessionId as SessionID,
        projectRoot: projectRoot as any,
      })
    })

  // --- Extraction (delegated to ExtractorService) ---

  const extractFromMessages = (messages: any[], sessionId: string): Effect.Effect<ExtractedMemory[], MemoryError> =>
    extractor.extractFromMessages(messages, sessionId, [])

  const extractFromSession = (sessionId: string, messages: any[]): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      const result = yield* extractor.extractFromSession(sessionId, messages as any, config.memoryDir)
      if (result.nodes.length === 0) return []

      const sessionMemory = yield* getSessionMemory(sessionId)
      const rootNode = yield* indexer.getNode(sessionMemory.rootNodeId)
      const projectRoot = Option.isSome(rootNode) ? rootNode.value.projectRoot : undefined
      const nodes: MemoryNode[] = []
      for (const node of result.nodes) {
        const scopedNode = projectRoot ? { ...node, projectRoot } : node
        if (projectRoot) yield* indexer.upsertNode(scopedNode)
        yield* indexer.upsertLink(sessionMemory.rootNodeId, node.id, "references")
        nodes.push(scopedNode)
      }

      return nodes
    })

  // --- Consolidation (delegated to ConsolidationService) ---

  const consolidate = (sessionId: string): Effect.Effect<void, MemoryError> =>
    Effect.gen(function* () {
      // This is now a thin wrapper - real consolidation happens in ConsolidationService
      // This just triggers it for the session
      if (!config.consolidation.enabled) return

      const sessionNodes = yield* indexer.getSessionNodes(sessionId)
      if (sessionNodes.length < 2) return

      // Just ensure all session nodes are linked to root (lightweight)
      const sessionMemory = yield* getSessionMemory(sessionId)
      for (const node of sessionNodes) {
        if (node.id !== sessionMemory.rootNodeId) {
          yield* addLink(sessionMemory.rootNodeId, node.id, "references")
        }
      }
    })

  // --- Utilities ---

  const search = (query: string, limit = 20): Effect.Effect<MemoryNode[], MemoryError> =>
    indexer.searchNodes(query, limit)

  const getRecent = (limit: number, since?: number): Effect.Effect<MemoryNode[], MemoryError> =>
    indexer.getRecentNodes(limit, since)

  const getStats = (): Effect.Effect<{ nodes: number; links: number; sessions: number }, MemoryError> =>
    Effect.gen(function* () {
      const [nodes, links, sessions] = yield* Effect.all([
        indexer.countNodes(),
        indexer.countLinks(),
        indexer.countSessions()
      ])
      return { nodes, links, sessions }
    })

  // Non-blocking init helpers
  const waitForIndexer = (): Effect.Effect<void, MemoryError> =>
    indexer.waitForReady()

  const isIndexerReady = (): Effect.Effect<boolean> =>
    indexer.isReady()

  return {
    createNode,
    getNode,
    updateNode,
    deleteNode,
    addLink,
    removeLink,
    getBacklinks,
    recall,
    getSessionMemory,
    bindSessionMemory,
    createSessionRoot,
    loadSessionContext,
    extractFromSession,
    extractFromMessages,
    consolidate,
    search,
    getRecent,
    getStats,
    waitForIndexer,
    isIndexerReady,
  }
})

export const MemoryLive = Layer.effect(
  MemoryService,
  makeMemoryService
)

export * as Memory from "./memory"