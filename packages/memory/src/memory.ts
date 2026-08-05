import { Effect, Layer, Context, Option, Array as Arr, Schema, PartitionedSemaphore } from "effect"
import type { LLMClient } from "@diveeoi/llm"
import type { MemoryNode, MemoryNodeID, MemoryLink, CreateNodeInput, PatchNode, MemoryType, LinkType, RecallOptions, RecallResult, ExtractedMemory, MemoryError, NodeNotFoundError } from "./schema"
import { SessionMemory, SessionID } from "./schema"
import { MemoryConfig } from "./config"
import { NodeService, extractWikilinks } from "./node"
import { IndexerService } from "./indexer"
import { GraphService } from "./graph"
import { ExtractorService } from "./extractor"
import { Database } from "@diveeoi/db/database/database"

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
  readonly getSessionMemory: (sessionId: string) => Effect.Effect<SessionMemory, MemoryError>
  readonly bindSessionMemory: (sessionId: string, rootNodeId: MemoryNodeID) => Effect.Effect<void, MemoryError>
  readonly createSessionRoot: (sessionId: string, title: string) => Effect.Effect<MemoryNode, MemoryError>
  readonly loadSessionContext: (sessionId: string, maxDepth?: number, maxNodes?: number) => Effect.Effect<RecallResult, MemoryError>

  // Extraction from sessions
  readonly extractFromSession: (sessionId: string, messages: any[]) => Effect.Effect<MemoryNode[], MemoryError>
  readonly extractFromMessages: (messages: any[], sessionId: string) => Effect.Effect<ExtractedMemory[], MemoryError>

  // Consolidation (background dreaming)
  readonly consolidate: (sessionId: string) => Effect.Effect<void, MemoryError>

  // Search & utilities
  readonly search: (query: string, limit?: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getRecent: (limit: number, since?: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getStats: () => Effect.Effect<{ nodes: number; links: number; sessions: number }, MemoryError>
}

export const MemoryService = Context.Service<MemoryService, MemoryService>()("@diveeoi/memory/MemoryService")

const makeMemoryService = Effect.gen(function* () {
  console.log("[DEBUG] MemoryLive.init: Starting init effect")
  const nodeService = yield* NodeService
  const indexer = yield* IndexerService
  const graph = yield* GraphService
  const extractor = yield* ExtractorService
  const config = yield* MemoryConfig
  const { db } = yield* Database.Service
  console.log("[DEBUG] MemoryLive.init: All services obtained, initializing indexer")

  // Initialize indexer
  yield* indexer.initialize()

  // PartitionedSemaphore per session for race condition prevention (1 permit per session key)
  const sessionLocks = yield* PartitionedSemaphore.make<string>({ permits: 1 })

  // --- Node CRUD ---

  const createNode = (input: CreateNodeInput): Effect.Effect<MemoryNode, MemoryError> =>
    Effect.gen(function* () {
      const node = yield* nodeService.create(input)
      
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

  const getSessionMemory = (sessionId: string): Effect.Effect<SessionMemory, MemoryError> =>
    Effect.gen(function* () {
      // Use partitioned semaphore to prevent race condition on session initialization
      return yield* PartitionedSemaphore.withPermit(sessionLocks, sessionId)(Effect.gen(function* () {
        const rootNodeId = yield* indexer.getSessionRoot(sessionId)
        
        if (Option.isNone(rootNodeId)) {
          // Create session root if it doesn't exist
          const rootNode = yield* createSessionRoot(sessionId, "Untitled")
          return SessionMemory.make({
            sessionId: sessionId as SessionID,
            rootNodeId: rootNode.id,
            nodeIds: [rootNode.id],
            loadedAt: Date.now()
          })
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

  const createSessionRoot = (sessionId: string, title: string): Effect.Effect<MemoryNode, MemoryError> =>
    Effect.gen(function* () {
      const rootNode = yield* createNode({
        type: "session",
        title: `Session: ${title}`,
        content: `Root memory node for session ${sessionId}`,
        tags: ["session", "root"],
        sessionId: sessionId as SessionID
      })

      // Bind session to root node
      yield* indexer.bindSession(sessionId, rootNode.id)
      
      return rootNode
    })

  const loadSessionContext = (sessionId: string, maxDepth = 2, maxNodes = 15): Effect.Effect<RecallResult, MemoryError> =>
    Effect.gen(function* () {
      const sessionMemory = yield* getSessionMemory(sessionId)
      
      return yield* recall({
        seedNodes: [sessionMemory.rootNodeId],
        maxDepth,
        maxNodes,
        currentSession: sessionId as SessionID
      })
    })

  // --- Extraction (delegated to ExtractorService) ---

  const extractFromMessages = (messages: any[], sessionId: string): Effect.Effect<ExtractedMemory[], MemoryError> =>
    extractor.extractFromMessages(messages, sessionId, [])

  const extractFromSession = (sessionId: string, messages: any[]): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      const result = yield* extractor.extractFromSession(sessionId, messages as any, config.memoryDir)
      return result.nodes
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
    getStats
  }
})

export const MemoryLive = Layer.effect(
  MemoryService,
  makeMemoryService
)

export * as Memory from "./memory"