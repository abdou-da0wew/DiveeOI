import { Effect, Layer, Context, Option, Array as Arr, Schedule } from "effect"
import { MemoryNode, MemoryNodeID, MemoryLink, MemoryType, LinkType, ConsolidationInput, ConsolidationResult, MemoryError, NodeNotFoundError } from "./schema"
import { MemoryService } from "./memory"
import { IndexerService } from "./indexer"
import { extractWikilinks } from "./node"
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

// --- Duplicate-content detection (normalized containment) ---------------------

// Arabic vocalization (harakat U+064B-U+0652, superscript alef U+0670) and the
// tatweel stretch character (U+0640) carry no lexical meaning here and are folded
// away so Arabic text compares independent of diacritics.
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/gu

/**
 * Normalized form used for duplicate-content comparison: NFKC, lowercase,
 * Arabic diacritic folding, punctuation/symbols replaced by spaces, whitespace
 * collapsed. Two texts with the same normalized form carry the same words, so
 * they count as the same content regardless of case, spacing or punctuation.
 */
export const normalizeText = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()

/**
 * True when `candidate` (normalized) is already contained in `merged`, i.e. the
 * duplicate adds no new words and must not be appended to the merged content.
 *
 * Replaces the old raw `mergedContent.includes(dup.content.substring(0, 100))`
 * check, which dropped genuinely new content whenever its first 100 chars
 * happened to appear elsewhere, and failed to dedupe near-identical text that
 * differed only in case, whitespace or punctuation.
 */
const containsDuplicateContent = (merged: string, candidate: string): boolean => {
  const normalizedCandidate = normalizeText(candidate)
  if (normalizedCandidate.length === 0) return true
  return normalizeText(merged).includes(normalizedCandidate)
}

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
        
        const { node: mergedNode, redirectLinks } = yield* mergeNodesDetailed(primary.id, duplicates.map(d => d.id))
        merged.push(...duplicates.map(d => d.id))
        updated.push(mergedNode)
        linksAdded.push(...redirectLinks)
      }

      // Strengthen connections for all nodes (with concurrency limit), collecting the real links created
      const connectionResults = yield* Effect.forEach(nodes, (node) => 
        strengthenConnectionsDetailed(node.id), 
        { concurrency: 10 }
      )
      for (const links of connectionResults) {
        linksAdded.push(...links)
      }

      // Deduplicate by sourceId→targetId→type: the same link row can be reported twice
      // (e.g. several members of one duplicate group whose backlinks all redirect onto the same primary)
      const seen = new Set<string>()
      const uniqueLinksAdded = linksAdded.filter((link) => {
        const key = `${link.sourceId}→${link.targetId}→${link.type}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      return ConsolidationResult.make({
        merged,
        created: [],
        updated,
        linksAdded: uniqueLinksAdded
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

  // Upsert a link and return the REAL stored link, read back from the index (upsertLink
  // itself returns void). This keeps linksAdded grounded in what was actually persisted
  // instead of fabricating MemoryLink instances.
  const upsertLinkReturning = (sourceId: MemoryNodeID, targetId: MemoryNodeID, type: LinkType): Effect.Effect<MemoryLink, MemoryError> =>
    Effect.gen(function* () {
      yield* indexer.upsertLink(sourceId, targetId, type)
      const stored = yield* indexer.getLinks(sourceId)
      const link = stored.find(l => l.targetId === targetId)
      if (link === undefined) {
        return yield* Effect.fail(new MemoryError({ cause: `Link ${sourceId} -> ${targetId} (${type}) missing after upsert` }))
      }
      return link
    })

  /**
   * Merge duplicates into the primary node.
   *
   * Executed in three phases with failure-safe ordering:
   *
   *   Phase A — read + plan (no writes). Computes the merged content/tags/confidence
   *     and the link-redirect plan in memory; any failure here leaves the store
   *     completely untouched.
   *   Phase B — one SQLite transaction for the whole index-side merge. Link
   *     redirects, duplicate node-row deletions, the primary content/tags/confidence
   *     update and the primary's outgoing-link rebuild all commit together or not at
   *     all (`indexer.runInTransaction`); per-step verification inside the transaction
   *     fails it (and rolls everything back) if the persisted state does not match
   *     the plan.
   *   Phase C — filesystem mirror sync, AFTER the transaction commits. The primary
   *     file is rewritten first (non-destructive), duplicate files are deleted last
   *     (destructive). SQLite cannot roll back file writes, so these cannot join the
   *     transaction; the index is the read path (`getNode` is indexer-first), so a
   *     Phase C failure leaves a complete, consistent index with at worst stale/orphan
   *     markdown files.
   */
  const mergeNodesDetailed = (primaryId: MemoryNodeID, duplicateIds: MemoryNodeID[]): Effect.Effect<{ node: MemoryNode; redirectLinks: MemoryLink[] }, MemoryError | NodeNotFoundError> =>
    Effect.gen(function* () {
      // Phase A — verify all nodes still exist (reads only, no writes yet)
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
        return { node: primary.value, redirectLinks: [] } // Nothing to merge
      }
      const duplicateIdSet = new Set(existingDuplicates.map(d => d.id))

      // In-memory merge plan (still no writes). Duplicate content is detected by
      // normalized containment, not the old first-100-chars raw substring check.
      let mergedContent = primary.value.content
      let mergedTags = [...primary.value.tags]
      let maxConfidence = primary.value.confidence

      for (const dup of existingDuplicates) {
        if (!containsDuplicateContent(mergedContent, dup.content)) {
          mergedContent += "\n\n---\n\n" + dup.content
        }

        // Merge tags
        for (const tag of dup.tags) {
          if (!mergedTags.includes(tag)) mergedTags.push(tag)
        }
        // Take max confidence
        maxConfidence = Math.max(maxConfidence, dup.confidence)
      }

      const updated = MemoryNode.make({
        ...primary.value,
        content: mergedContent,
        tags: mergedTags,
        confidence: maxConfidence,
        updated: Date.now()
      })

      // Redirect links re-created onto the primary (collected for linksAdded)
      const redirectLinks: MemoryLink[] = []

      // Phase B — the whole index-side merge in ONE SQLite transaction
      yield* indexer.runInTransaction(Effect.gen(function* () {
        for (const dup of existingDuplicates) {
          // Redirect links from duplicate to primary. Read lazily, per duplicate,
          // so the link set matches the interleaved redirect/delete sequence.
          const inLinks = yield* indexer.getBacklinks(dup.id)
          for (const link of inLinks) {
            // Links sourced from another node in this merge group (incl. self-links)
            // are destroyed together with their source node — redirecting them would
            // immediately create a dangling entry in linksAdded.
            if (duplicateIdSet.has(link.sourceId)) continue
            yield* indexer.deleteLink(link.sourceId, dup.id)
            const redirect = yield* upsertLinkReturning(link.sourceId, primaryId, link.type)
            redirectLinks.push(redirect)
          }

          // Delete duplicate from the index (destructive, but inside the
          // transaction — rolled back if any later step fails)
          yield* indexer.deleteNode(dup.id)
        }

        // Primary content/tags/confidence update
        yield* indexer.upsertNode(updated)

        // Rebuild the primary's outgoing links exactly as memory.updateNode does for
        // a content patch: remove old ones, re-derive from wikilinks in the content.
        const oldLinks = yield* indexer.getLinks(primaryId)
        for (const link of oldLinks) {
          yield* indexer.deleteLink(primaryId, link.targetId)
        }
        for (const linkId of extractWikilinks(mergedContent)) {
          yield* indexer.upsertLink(primaryId, linkId.target as MemoryNodeID, "references")
        }

        // Per-step verification inside the transaction: a mismatch fails the
        // transaction and rolls back every write above.
        for (const dup of existingDuplicates) {
          const gone = yield* indexer.getNode(dup.id)
          if (Option.isSome(gone)) {
            return yield* Effect.fail(new MemoryError({ cause: `merge verification failed: duplicate ${dup.id} still present after merge` }))
          }
        }
        const primaryAfter = yield* indexer.getNode(primaryId)
        if (
          Option.isNone(primaryAfter) ||
          primaryAfter.value.content !== mergedContent ||
          primaryAfter.value.confidence !== maxConfidence ||
          JSON.stringify(primaryAfter.value.tags) !== JSON.stringify(mergedTags)
        ) {
          return yield* Effect.fail(new MemoryError({ cause: "merge verification failed: primary node not updated with merged content" }))
        }
        for (const redirect of redirectLinks) {
          const links = yield* indexer.getLinks(redirect.sourceId)
          if (!links.some(l => l.targetId === redirect.targetId)) {
            return yield* Effect.fail(new MemoryError({ cause: `merge verification failed: redirect ${redirect.sourceId} -> ${redirect.targetId} missing after merge` }))
          }
        }
      }))

      // Phase C — filesystem mirror sync (post-commit; primary write first,
      // destructive duplicate deletes last). The public memory.* paths keep the
      // old behavior (they re-run the idempotent index updates on top of the
      // committed transaction state).
      yield* memory.updateNode(primaryId, {
        content: mergedContent,
        tags: mergedTags,
        confidence: maxConfidence
      })
      for (const dup of existingDuplicates) {
        yield* memory.deleteNode(dup.id)
      }

      return { node: updated, redirectLinks }
    })

  const mergeNodes = (primaryId: MemoryNodeID, duplicateIds: MemoryNodeID[]): Effect.Effect<MemoryNode, MemoryError | NodeNotFoundError> =>
    Effect.map(mergeNodesDetailed(primaryId, duplicateIds), (result) => result.node)

  const strengthenConnectionsDetailed = (nodeId: MemoryNodeID): Effect.Effect<MemoryLink[], MemoryError> =>
    Effect.gen(function* () {
      const node = yield* memory.getNode(nodeId)
      if (Option.isNone(node)) return []

      // Find related nodes: same type + tag overlap
      const candidates = yield* indexer.getNodesByType(node.value.type)
      const createdLinks: MemoryLink[] = []

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
            const stored = yield* upsertLinkReturning(nodeId, candidate.id, linkType)
            createdLinks.push(stored)
          }
        }
      }

      return createdLinks
    })

  const strengthenConnections = (nodeId: MemoryNodeID): Effect.Effect<number, MemoryError> =>
    Effect.map(strengthenConnectionsDetailed(nodeId), (links) => links.length)

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