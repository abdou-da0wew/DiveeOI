import { Effect, Layer, Context, Option, Array as Arr } from "effect"
import type { MemoryNode, MemoryLink, MemoryNodeID, RecallOptions, RecallResult, MemoryType, LinkType } from "./schema"
import { MemoryConfig } from "./config"
import { MemoryError, SessionID } from "./schema"
import { IndexerService } from "./indexer"

/**
 * Recall context for scoring
 */
export interface RecallContext {
  currentSession?: string
  queryTags: readonly string[]
  seedNodes: MemoryNodeID[]
  now: number
}

/**
 * Node with computed scores and graph metadata
 */
export interface ScoredNode {
  node: MemoryNode
  score: number
  depth: number
  path: MemoryNodeID[]
}

/**
 * Graph traversal result
 */
export interface GraphTraversalResult {
  nodes: Map<MemoryNodeID, ScoredNode>
  edges: MemoryLink[]
}

/**
 * Graph Service Interface
 */
export interface GraphService {
  readonly recall: (options: RecallOptions) => Effect.Effect<RecallResult, MemoryError>
  readonly traverse: (seeds: MemoryNodeID[], maxDepth: number, maxVisited: number, context?: { queryTags?: string[]; currentSession?: string }) => Effect.Effect<GraphTraversalResult, MemoryError>
  readonly pureScoreNode: (node: MemoryNode, context: RecallContext, depth: number, totalDegree: number) => number
  readonly getSubgraph: (nodeIds: MemoryNodeID[]) => Effect.Effect<{ nodes: MemoryNode[]; edges: MemoryLink[] }, MemoryError>
  readonly findPaths: (from: MemoryNodeID, to: MemoryNodeID, maxDepth: number) => Effect.Effect<MemoryNodeID[][], MemoryError>
  readonly getHubs: (limit: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getOrphans: (limit: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getClusters: (minClusterSize: number) => Effect.Effect<MemoryNode[][], MemoryError>
}

export const GraphService = Context.Service<GraphService, GraphService>()("@diveeoi/memory/GraphService")

// Type weight constants
const TYPE_WEIGHTS: Record<MemoryType, number> = {
  decision: 1.0,
  pattern: 0.9,
  error: 0.8,
  entity: 0.7,
  preference: 0.6,
  fact: 0.5,
  constraint: 0.5,
  session: 0.4
}

// True 30-day half-life constant
const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

const makeGraphService = Effect.gen(function* () {
  const indexer = yield* IndexerService
  const config = yield* MemoryConfig

  /**
   * Pure scoring function — no DB calls, no Effect.
   * Calculates score for a single node given pre-computed degree.
   */
  const scoreNodePure = (
    node: MemoryNode,
    context: RecallContext,
    depth: number,
    totalDegree: number
  ): number => {
    // 1. Recency: true exponential decay with 30-day half-life (weight: 0.25)
    const ageMs = Math.max(0, context.now - node.updated)
    const recencyScore = Math.exp(-Math.LN2 * ageMs / RECENCY_HALF_LIFE_MS)

    // 2. Link density: hub boost, capped at 10 connections (weight: 0.20)
    const linkDensityScore = Math.min(totalDegree / 10, 1)

    // 3. Type weight: lookup from constants (weight: 0.20)
    const typeWeight = TYPE_WEIGHTS[node.type] ?? 0.5

    // 4. Confidence: direct from node (weight: 0.10)
    const confidenceScore = node.confidence

    // 5. Session relevance: binary feature (weight: 0.10)
    const sessionBoost = (context.currentSession && node.sessionId === context.currentSession) ? 1.0 : 0.0

    // 6. Tag overlap: normalized by 3 (weight: 0.15)
    let tagOverlapScore = 0
    if (context.queryTags.length > 0) {
      const overlap = node.tags.filter(t => context.queryTags.includes(t)).length
      tagOverlapScore = Math.min(overlap / 3, 1)
    }

    // 7. Depth penalty: subtractive, lambda from config with fallback (weight: subtractive)
    const lambda = config.recall.depthPenaltyLambda ?? 0.15
    const depthPenalty = 1 - Math.exp(-depth * lambda)

    // 8. Seed boost: multiplicative 20% for seeds (weight: multiplicative)
    const isSeed = context.seedNodes.includes(node.id)
    const seedMultiplier = isSeed ? 1.2 : 1.0

    // Weighted sum: 0.25 + 0.20 + 0.20 + 0.10 + 0.10 + 0.15 = 1.00
    let score =
      0.25 * recencyScore +
      0.20 * linkDensityScore +
      0.20 * typeWeight +
      0.10 * confidenceScore +
      0.10 * sessionBoost +
      0.15 * tagOverlapScore

    // Apply seed multiplier
    score *= seedMultiplier

    // Apply depth penalty as subtraction
    score = Math.max(0, score - depthPenalty)

    // Final clamp to [0, 1]
    return Math.min(1, score)
  }

  /**
   * BFS by depth first — guarantees shortest-path depth before scoring.
   * Uses level-order expansion: process all nodes at depth D before depth D+1.
   * Within each depth level, scores and sorts before expanding.
   */
  const traverse = (
    seeds: MemoryNodeID[],
    maxDepth: number,
    maxVisited: number,
    contextParams?: { queryTags?: string[]; currentSession?: string }
  ) =>
    Effect.gen(function* () {
      const now = Date.now()
      const queryTags = contextParams?.queryTags ?? []
      const currentSession = contextParams?.currentSession

      const context: RecallContext = {
        seedNodes: seeds,
        queryTags,
        currentSession,
        now
      }

      const visited = new Map<MemoryNodeID, ScoredNode>()
      const edgesMap = new Map<string, MemoryLink>()

      const addEdge = (link: MemoryLink) => {
        const key = JSON.stringify([link.sourceId, link.targetId, link.type])
        if (!edgesMap.has(key)) {
          edgesMap.set(key, link)
        }
      }

// BFS by depth: process one level at a time to guarantee shortest-path depth
      // Use a depth-ordered queue with level boundaries
      interface BfsEntry { id: MemoryNodeID; depth: number; path: MemoryNodeID[] }

      // Seeds at depth 0
      let frontier: BfsEntry[] = seeds.map(id => ({ id, depth: 0, path: [id] }))

      while (frontier.length > 0 && visited.size < maxVisited) {
        // Fetch all frontier nodes + their adjacencies in parallel within this level
        const nodeResults = yield* Effect.all(
          frontier.map(entry =>
            Effect.gen(function* () {
              if (visited.has(entry.id)) return null
              const nodeOpt = yield* indexer.getNode(entry.id)
              if (Option.isNone(nodeOpt)) return null
              const node = nodeOpt.value

              const [outLinks, inLinks] = yield* Effect.all([
                indexer.getLinks(entry.id).pipe(Effect.mapError(e => new MemoryError(e))),
                indexer.getBacklinks(entry.id).pipe(Effect.mapError(e => new MemoryError(e)))
              ])

              return { entry, node, outLinks, inLinks }
            })
          )
        )

        // Score and lock in nodes at this depth
        const nextFrontier: BfsEntry[] = []

        for (const result of nodeResults) {
          if (!result) continue
          const { entry, node, outLinks, inLinks } = result
          const totalDegree = outLinks.length + inLinks.length

          const score = scoreNodePure(node, context, entry.depth, totalDegree)
          visited.set(entry.id, { node, score, depth: entry.depth, path: entry.path })

          // Add edges
          for (const link of outLinks) addEdge(link)
          for (const link of inLinks) addEdge(link)

          // Push neighbors for next depth level
          if (entry.depth < maxDepth) {
            for (const link of outLinks) {
              if (!visited.has(link.targetId)) {
                nextFrontier.push({ id: link.targetId, depth: entry.depth + 1, path: [...entry.path, link.targetId] })
              }
            }
            for (const link of inLinks) {
              if (!visited.has(link.sourceId)) {
                nextFrontier.push({ id: link.sourceId, depth: entry.depth + 1, path: [...entry.path, link.sourceId] })
              }
            }
          }
        }

        frontier = nextFrontier
      }

      return { nodes: visited, edges: Array.from(edgesMap.values()) }
    })

  /**
   * Get subgraph for a set of node IDs (deduplicated edges)
   */
  const recall = (options: RecallOptions) =>
    Effect.gen(function* () {
      const seeds = [...options.seedNodes]
      const maxDepth = options.maxDepth ?? config.recall.maxDepth
      const maxResults = options.maxNodes ?? config.recall.maxNodes
      const maxVisited = Math.ceil(maxResults * 1.5)

      const { nodes: nodeMap, edges } = yield* traverse(seeds, maxDepth, maxVisited, {
        queryTags: [...(options.queryTags ?? [])],
        currentSession: options.currentSession
      })

      let filteredNodes = Array.from(nodeMap.values())

      // Filter by type
      if (options.types && options.types.length > 0) {
        filteredNodes = filteredNodes.filter(n => options.types!.includes(n.node.type))
      }

      // Filter by confidence
      if (options.minConfidence !== undefined) {
        filteredNodes = filteredNodes.filter(n => n.node.confidence >= options.minConfidence!)
      }

      // Filter by time range
      if (options.timeRange) {
        filteredNodes = filteredNodes.filter(n =>
          n.node.updated >= options.timeRange!.from && n.node.updated <= options.timeRange!.to
        )
      }

      // Sort by score descending
      filteredNodes.sort((a, b) => b.score - a.score)

      // Take top results (not maxVisited)
      const topNodes = filteredNodes.slice(0, maxResults)
      const topNodeIds = new Set(topNodes.map(n => n.node.id))

      // Filter edges to only include those between top nodes
      const filteredEdges = edges.filter(e => topNodeIds.has(e.sourceId) && topNodeIds.has(e.targetId))

      const scores: Record<string, number> = {}
      for (const n of topNodes) {
        scores[n.node.id] = n.score
      }

      return {
        nodes: topNodes.map(n => n.node),
        edges: filteredEdges,
        scores
      }
    })

  /**
   * Get subgraph for a set of node IDs (deduplicated edges)
   */
  const getSubgraph = (nodeIds: MemoryNodeID[]) =>
    Effect.gen(function* () {
      const nodes = yield* indexer.getNodes(nodeIds)
      const nodeIdSet = new Set(nodeIds)
      const edgesMap = new Map<string, MemoryLink>()

      for (const id of nodeIds) {
        const [outLinks, inLinks] = yield* Effect.all([
          indexer.getLinks(id),
          indexer.getBacklinks(id)
        ])
        for (const link of outLinks) {
          if (nodeIdSet.has(link.targetId)) {
            const key = `${link.sourceId}-${link.targetId}-${link.type}`
            if (!edgesMap.has(key)) edgesMap.set(key, link)
          }
        }
        for (const link of inLinks) {
          if (nodeIdSet.has(link.sourceId)) {
            const key = `${link.sourceId}-${link.targetId}-${link.type}`
            if (!edgesMap.has(key)) edgesMap.set(key, link)
          }
        }
      }

      return { nodes, edges: Array.from(edgesMap.values()) }
    })

  /**
   * Find paths between two nodes — per-path cycle detection only, no global visited
   */
  const findPaths = (from: MemoryNodeID, to: MemoryNodeID, maxDepth: number) =>
    Effect.gen(function* () {
      const paths: MemoryNodeID[][] = []
      const queue: Array<{ path: MemoryNodeID[]; depth: number }> = [{ path: [from], depth: 0 }]
      let head = 0

      while (head < queue.length && paths.length < 10) {
        const { path, depth } = queue[head++]
        const current = path[path.length - 1]

        if (current === to) {
          paths.push(path)
          continue
        }

        if (depth >= maxDepth) continue

        const [links, backlinks] = yield* Effect.all([
          indexer.getLinks(current),
          indexer.getBacklinks(current)
        ])

        for (const link of links) {
          if (!path.includes(link.targetId)) {
            queue.push({ path: [...path, link.targetId], depth: depth + 1 })
          }
        }
        for (const link of backlinks) {
          if (!path.includes(link.sourceId)) {
            queue.push({ path: [...path, link.sourceId], depth: depth + 1 })
          }
        }
      }

      return paths
    })

  /**
   * Get hub nodes (highest degree)
   */
  const getHubs = (limit: number) =>
    Effect.gen(function* () {
      const allNodes = yield* indexer.getRecentNodes(1000)
      const scored: Array<{ node: MemoryNode; degree: number }> = []

      for (const node of allNodes) {
        const [outCount, inCount] = yield* Effect.all([
          indexer.getLinks(node.id).pipe(Effect.map(Arr.length)),
          indexer.getBacklinks(node.id).pipe(Effect.map(Arr.length))
        ])
        scored.push({ node, degree: outCount + inCount })
      }

      scored.sort((a, b) => b.degree - a.degree)
      return scored.slice(0, limit).map(s => s.node)
    })

  /**
   * Get orphan nodes (no links)
   */
  const getOrphans = (limit: number) =>
    Effect.gen(function* () {
      const allNodes = yield* indexer.getRecentNodes(1000)
      const orphans: MemoryNode[] = []

      for (const node of allNodes) {
        const [outCount, inCount] = yield* Effect.all([
          indexer.getLinks(node.id).pipe(Effect.map(Arr.length)),
          indexer.getBacklinks(node.id).pipe(Effect.map(Arr.length))
        ])
        if (outCount === 0 && inCount === 0) {
          orphans.push(node)
          if (orphans.length >= limit) break
        }
      }

      return orphans
    })

  /**
   * Get clusters using connected components (avoids redundant getNode calls)
   */
  const getClusters = (minClusterSize: number) =>
    Effect.gen(function* () {
      const allNodes = yield* indexer.getRecentNodes(5000)
      const nodesById = new Map(allNodes.map(n => [n.id, n]))
      const nodeIdSet = new Set(allNodes.map(n => n.id))
      const visited = new Set()
      const clusters: MemoryNode[][] = []

      for (const nodeId of nodeIdSet) {
        if (visited.has(nodeId)) continue

        const cluster: MemoryNode[] = []
        const queue: MemoryNodeID[] = [nodeId]
        let head = 0

        while (head < queue.length) {
          const current = queue[head++]
          if (visited.has(current)) continue
          visited.add(current)

          const node = nodesById.get(current)
          if (!node) continue
          cluster.push(node)

          const [links, backlinks] = yield* Effect.all([
            indexer.getLinks(current),
            indexer.getBacklinks(current)
          ])

          for (const link of links) {
            if (nodeIdSet.has(link.targetId) && !visited.has(link.targetId)) {
              queue.push(link.targetId)
            }
          }
          for (const link of backlinks) {
            if (nodeIdSet.has(link.sourceId) && !visited.has(link.sourceId)) {
              queue.push(link.sourceId)
            }
          }
        }

        if (cluster.length >= minClusterSize) {
          clusters.push(cluster)
        }
      }

      clusters.sort((a, b) => b.length - a.length)
      return clusters
    })

  return {
    recall,
    traverse,
    pureScoreNode: scoreNodePure,
    getSubgraph,
    findPaths,
    getHubs,
    getOrphans,
    getClusters
  }
})

export const GraphLive = Layer.effect(
  GraphService,
  makeGraphService
)

export * as Graph from "./graph"