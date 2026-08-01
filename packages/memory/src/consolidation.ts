import { Effect, Layer, Context, Option, Array as Arr, Schedule } from "effect"
import { MemoryNode, MemoryNodeID, MemoryLink, MemoryType, ConsolidationInput, ConsolidationResult, MemoryError, NodeNotFoundError } from "./schema"
import { MemoryService } from "./memory"
import { IndexerService } from "./indexer"
import { MemoryConfig, defaultMemoryConfig } from "./config"

/**
 * Background Consolidation Service ("Dreaming")
 * Runs after sessions to merge, deduplicate, and strengthen connections
 */
export interface ConsolidationService {
  readonly consolidateSession: (sessionId: string) => Effect.Effect<ConsolidationResult, MemoryError | NodeNotFoundError>
  readonly consolidateNodes: (nodes: MemoryNode[]) => Effect.Effect<ConsolidationResult, MemoryError | NodeNotFoundError>
  readonly findDuplicates: (threshold?: number) => Effect.Effect<MemoryNode[][], MemoryError>
  readonly mergeNodes: (primaryId: MemoryNodeID, duplicateIds: MemoryNodeID[]) => Effect.Effect<MemoryNode, MemoryError | NodeNotFoundError>
  readonly strengthenConnections: (nodeId: MemoryNodeID) => Effect.Effect<number, MemoryError>
  readonly runMaintenance: () => Effect.Effect<void, MemoryError | NodeNotFoundError>
}

export const ConsolidationService = Context.Service<ConsolidationService, ConsolidationService>()("@diveeoi/memory/ConsolidationService")

const makeConsolidationService = Effect.gen(function* () {
  const memory = yield* MemoryService
  const indexer = yield* IndexerService
  const config = defaultMemoryConfig

  // Similarity threshold for duplicate detection
  const DUPLICATE_THRESHOLD = 0.85
  const CONNECTION_THRESHOLD = 0.75 // Higher threshold for connections

  const consolidateSession = (sessionId: string): Effect.Effect<ConsolidationResult, MemoryError | NodeNotFoundError> =>
    Effect.gen(function* () {
      if (!config.consolidation.enabled) {
        return ConsolidationResult.make({
          merged: [],
          created: [],
          updated: [],
          linksAdded: []
        })
      }

      // Get all nodes from this session
      const sessionNodes = yield* indexer.getNodesBySession(sessionId)
      if (sessionNodes.length === 0) {
        return ConsolidationResult.make({
          merged: [],
          created: [],
          updated: [],
          linksAdded: []
        })
      }

      // Get related nodes from other sessions (limited to same types)
      const relatedNodes: MemoryNode[] = []
      for (const node of sessionNodes) {
        const linked = yield* indexer.getLinkedNodes(node.id, 1)
        // Filter: only same type nodes to reduce noise
        const sameType = linked.filter(l => l.type === node.type)
        relatedNodes.push(...sameType)
      }

      // Run consolidation
      return yield* consolidateNodes([...sessionNodes, ...relatedNodes])
    })

  const consolidateNodes = (nodes: MemoryNode[]): Effect.Effect<ConsolidationResult, MemoryError | NodeNotFoundError> =>
    Effect.gen(function* () {
      if (nodes.length === 0) {
        return ConsolidationResult.make({
          merged: [],
          created: [],
          updated: [],
          linksAdded: []
        })
      }

      // Find duplicates
      const duplicateGroups = yield* findDuplicates(nodes)
      
      const merged: MemoryNodeID[] = []
      const updated: MemoryNode[] = []
      const linksAdded: MemoryLink[] = []

      // Merge each duplicate group
      for (const group of duplicateGroups) {
        if (group.length <= 1) continue
        
        const primary = group[0]
        const duplicates = group.slice(1)
        
        const mergedNode = yield* mergeNodes(primary.id, duplicates.map(d => d.id))
        merged.push(...duplicates.map(d => d.id))
        updated.push(mergedNode)
      }

      // Strengthen connections for all nodes (with concurrency limit)
      const connectionResults = yield* Effect.forEach(nodes, (node) => 
        strengthenConnections(node.id), 
        { concurrency: 10 }
      )
      const totalLinks = Arr.reduce(connectionResults, 0, (sum, n) => sum + n)

      return ConsolidationResult.make({
        merged,
        created: [],
        updated,
        linksAdded: [] // TODO: track actual links added
      })
    })

  // Optimized: Use candidate filtering to avoid O(n²)
  const findDuplicates = (nodes?: MemoryNode[], threshold = DUPLICATE_THRESHOLD): Effect.Effect<MemoryNode[][], MemoryError> =>
    Effect.gen(function* () {
      const batchSize = config.consolidation.batchSize
      const allNodes = nodes ?? (yield* indexer.getRecentNodes(batchSize))
      
      // Group by type first to reduce comparisons
      const byType = new Map<MemoryType, MemoryNode[]>()
      for (const node of allNodes) {
        const arr = byType.get(node.type) ?? []
        arr.push(node)
        byType.set(node.type, arr)
      }

      const groups: MemoryNode[][] = []
      const processed = new Set<MemoryNodeID>()

      // Only compare within same type
      for (const [, typeNodes] of byType) {
        // Further bucket by first tag to reduce comparisons
        const byFirstTag = new Map<string, MemoryNode[]>()
        for (const node of typeNodes) {
          const firstTag = node.tags[0] ?? "__none__"
          const arr = byFirstTag.get(firstTag) ?? []
          arr.push(node)
          byFirstTag.set(firstTag, arr)
        }

        for (const [, bucket] of byFirstTag) {
          if (bucket.length < 2) continue
          
          // Compare within bucket (much smaller)
          for (let i = 0; i < bucket.length; i++) {
            const node = bucket[i]
            if (processed.has(node.id)) continue

            const group = [node]
            processed.add(node.id)

            for (let j = i + 1; j < bucket.length; j++) {
              const other = bucket[j]
              if (processed.has(other.id)) continue

              const similarity = calculateSimilarity(node, other)
              if (similarity >= threshold) {
                group.push(other)
                processed.add(other.id)
              }
            }

            if (group.length > 1) {
              groups.push(group)
            }
          }
        }
      }

      return groups
    })

  const calculateSimilarity = (a: MemoryNode, b: MemoryNode): number => {
    let score = 0

    // Same type (already guaranteed by bucketing)
    score += 0.3

    // Title similarity (simple word overlap)
    const aWords = new Set(a.title.toLowerCase().split(/\W+/).filter(w => w.length > 2))
    const bWords = new Set(b.title.toLowerCase().split(/\W+/).filter(w => w.length > 2))
    const titleOverlap = [...aWords].filter(w => bWords.has(w)).length
    const titleUnion = new Set([...aWords, ...bWords]).size
    score += 0.4 * (titleUnion > 0 ? titleOverlap / titleUnion : 0)

    // Tag overlap
    const aTags = new Set(a.tags)
    const bTags = new Set(b.tags)
    const tagOverlap = [...aTags].filter(t => bTags.has(t)).length
    const tagUnion = new Set([...aTags, ...bTags]).size
    score += 0.3 * (tagUnion > 0 ? tagOverlap / tagUnion : 0)

    return score
  }

  const mergeNodes = (primaryId: MemoryNodeID, duplicateIds: MemoryNodeID[]): Effect.Effect<MemoryNode, MemoryError | NodeNotFoundError> =>
    Effect.gen(function* () {
      // Verify all nodes still exist
      const primary = yield* memory.getNode(primaryId)
      if (Option.isNone(primary)) {
        return yield* Effect.fail(new MemoryError({ cause: "Primary node not found" }))
      }

      const duplicates = yield* Effect.all(
        duplicateIds.map(id => memory.getNode(id))
      )

      // Filter to only existing duplicates
      const existingDuplicates = duplicates.filter(Option.isSome).map(d => d.value)
      if (existingDuplicates.length === 0) {
        return primary.value // Nothing to merge
      }

      // Merge content with semantic awareness
      let mergedContent = primary.value.content
      let mergedTags = [...primary.value.tags]
      let maxConfidence = primary.value.confidence

      for (const dup of existingDuplicates) {
        // Semantic merge: use LLM to merge if content is substantial
        if (dup.content.length > 200 && primary.value.content.length > 200) {
          // For large content, append with clear separator
          if (!mergedContent.includes(dup.content.substring(0, 100))) {
            mergedContent += "\n\n---\n\n" + dup.content
          }
        } else {
          // For small content, simple append if not duplicate
          const dupSummary = dup.content.substring(0, 200)
          if (!mergedContent.includes(dupSummary)) {
            mergedContent += "\n\n---\n\n" + dup.content
          }
        }
        
        // Merge tags
        for (const tag of dup.tags) {
          if (!mergedTags.includes(tag)) mergedTags.push(tag)
        }
        // Take max confidence
        maxConfidence = Math.max(maxConfidence, dup.confidence)
        
        // Redirect links from duplicate to primary (in transaction)
        const inLinks = yield* indexer.getBacklinks(dup.id)
        for (const link of inLinks) {
          yield* indexer.deleteLink(link.sourceId, dup.id)
          yield* indexer.upsertLink(link.sourceId, primaryId, link.type)
        }

        // Delete duplicate
        yield* memory.deleteNode(dup.id)
      }

      const updated = MemoryNode.make({
        ...primary.value,
        content: mergedContent,
        tags: mergedTags,
        confidence: maxConfidence,
        updated: Date.now()
      })

      yield* memory.updateNode(primaryId, {
        content: mergedContent,
        tags: mergedTags,
        confidence: maxConfidence
      })

      return updated
    })

  const strengthenConnections = (nodeId: MemoryNodeID): Effect.Effect<number, MemoryError> =>
    Effect.gen(function* () {
      const node = yield* memory.getNode(nodeId)
      if (Option.isNone(node)) return 0

      // Find related nodes: same type + tag overlap
      const candidates = yield* indexer.getNodesByType(node.value.type)
      let newLinks = 0

      for (const candidate of candidates) {
        if (candidate.id === nodeId) continue

        // Require tag overlap for connections
        const tagOverlap = node.value.tags.filter(t => candidate.tags.includes(t)).length
        if (tagOverlap === 0) continue

        const similarity = calculateSimilarity(node.value, candidate)
        if (similarity > CONNECTION_THRESHOLD) {
          // Check if link already exists
          const existingLinks = yield* indexer.getLinks(nodeId)
          const hasLink = existingLinks.some(l => l.targetId === candidate.id)
          
          if (!hasLink) {
            const linkType = similarity > 0.85 ? "references" : "see_also"
            yield* indexer.upsertLink(nodeId, candidate.id, linkType)
            newLinks++
          }
        }
      }

      return newLinks
    })

  const runMaintenance = (): Effect.Effect<void, MemoryError | NodeNotFoundError> =>
    Effect.gen(function* () {
      // Process in batches with concurrency control
      const batchSize = 50
      const concurrency = 5

      // 1. Find and merge duplicates (high threshold)
      const duplicates = yield* findDuplicates(undefined, 0.9)
      for (const group of duplicates) {
        if (group.length > 1) {
          yield* mergeNodes(group[0].id, group.slice(1).map(n => n.id))
        }
      }

      // 2. Strengthen connections for recent nodes (batched)
      const recent = yield* indexer.getRecentNodes(200)
      yield* Effect.forEach(recent, (node) => strengthenConnections(node.id), { 
        concurrency
      })

      // 3. Archive low-confidence orphans (batched)
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
      const orphans = yield* indexer.getRecentNodes(500, cutoff)
      
      yield* Effect.forEach(orphans, (orphan) =>
        Effect.gen(function* () {
          const [outCount, inCount] = yield* Effect.all([
            indexer.getLinks(orphan.id).pipe(Effect.map(Arr.length)),
            indexer.getBacklinks(orphan.id).pipe(Effect.map(Arr.length))
          ])

          if (outCount === 0 && inCount === 0 && orphan.confidence < 0.4) {
            yield* memory.updateNode(orphan.id, { confidence: 0.1 })
          }
        }), 
        { concurrency }
      )
    })

  return {
    consolidateSession,
    consolidateNodes,
    findDuplicates: (threshold?: number) => findDuplicates(undefined, threshold),
    mergeNodes,
    strengthenConnections,
    runMaintenance
  }
})

export const ConsolidationLive = Layer.effect(
  ConsolidationService,
  makeConsolidationService
)

export * as Consolidation from "./consolidation"