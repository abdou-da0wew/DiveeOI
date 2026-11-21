import { describe, it, expect } from "bun:test"
import { Effect, Option } from "effect"
import { MemoryLayer } from "../src/index"
import { MemoryService } from "../src/memory"
import { ConsolidationService } from "../src/consolidation"
import { CreateNodeInput } from "../src/schema"

// Dedupe key used by consolidateNodes: sourceId→targetId→type
const linkKey = (l: { sourceId: string; targetId: string; type: string }) =>
  `${l.sourceId}→${l.targetId}→${l.type}`

/**
 * Notes on the fixture design (similarity scoring in consolidation.ts):
 * - calculateSimilarity = 0.3 (same type) + 0.4 * titleWordOverlap + 0.3 * tagOverlap
 * - Duplicates need >= 0.85: identical titles (0.4) + identical tags (0.3) => 1.0
 * - Connections need > 0.75: shared title words 4/5 (0.32) + shared tags 2/3 (0.2) => 0.82
 * - findDuplicates buckets by FIRST tag, so distinct-but-related nodes use a different
 *   first tag to never land in a duplicate bucket.
 * - Every tag is unique per test run (uuid suffix, no fixed tags at all) so nodes left
 *   over from previous runs of this suite (the SQLite DB persists) can never share tags
 *   and pollute linksAdded.
 * - Link existence is cross-checked via memory.getBacklinks(targetId): a reported link
 *   (s→t, type) really exists iff the backlinks of t contain source s with that type.
 */
describe("Consolidation Service", () => {
  const runTest = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runPromise(effect.pipe(Effect.provide(MemoryLayer)))

  it("linksAdded is non-empty, every entry really exists in the index, and covers redirects + strengthened connections", async () => {
    const sessionId = `ses_consol_a_${crypto.randomUUID()}`
    const run = crypto.randomUUID().slice(0, 8)
    const tagDup = `t-dup-${run}`
    const tagFast = `t-fast-${run}`
    const tagRel = `t-rel-${run}`
    const tagUnrel = `t-unrel-${run}`
    const tagK8s = `t-k8s-${run}`

    const { result, dupA1, dupA2, relA1, sessionRootId, existingKeys } = await runTest(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const consolidation = yield* ConsolidationService

        // Near-duplicate pair: identical title + identical tags => similarity 1.0 (>= 0.85)
        const dupA1 = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: "FastAPI async database sessions",
          content: "Sessions hold async database access for FastAPI request handlers.",
          tags: [tagDup, tagFast],
          sessionId: sessionId as any,
        }))
        const dupA2 = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: "FastAPI async database sessions",
          content: "Duplicate note about async database sessions in FastAPI.",
          tags: [tagDup, tagFast],
          sessionId: sessionId as any,
        }))
        // Distinct-but-related: different first tag (own bucket), similarity 0.82 (> 0.75)
        const relA1 = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: "FastAPI async database sessions guide",
          content: "A related but distinct guide about FastAPI sessions.",
          tags: [tagRel, tagFast, tagDup],
          sessionId: sessionId as any,
        }))
        // Unrelated: zero tag overlap => no links at all
        const unrelA1 = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: "Kubernetes pod autoscaling",
          content: "Horizontal pod autoscaling is unrelated to the FastAPI notes.",
          tags: [tagUnrel, tagK8s],
          sessionId: sessionId as any,
        }))

        const session = yield* memory.getSessionMemory(sessionId)

        const result = yield* consolidation.consolidateNodes([dupA1, dupA2, relA1, unrelA1])

        // Collect every link row the index REALLY holds (backlinks of each target give
        // full source→target→type rows, covering both redirect and strengthened links)
        const existingKeys = new Set<string>()
        for (const targetId of [...new Set(result.linksAdded.map(l => l.targetId))]) {
          for (const link of yield* memory.getBacklinks(targetId)) existingKeys.add(linkKey(link))
        }

        return { result, dupA1, dupA2, relA1, sessionRootId: session.rootNodeId, existingKeys }
      })
    )

    // The near-duplicate pair was merged into dupA1
    expect(result.merged).toContain(dupA2.id)
    expect(result.merged).not.toContain(dupA1.id)
    const mergedPrimary = result.updated.find(n => n.id === dupA1.id)
    expect(mergedPrimary).toBeDefined()
    expect(mergedPrimary!.content).toContain("Sessions hold async database access")
    expect(mergedPrimary!.content).toContain("Duplicate note about async database sessions")

    // linksAdded is populated and every reported link really exists in the indexer
    expect(result.linksAdded.length).toBeGreaterThan(0)
    for (const link of result.linksAdded) {
      expect(existingKeys.has(linkKey(link))).toBe(true)
    }

    // Strengthened connections (both directions between primary and related node)
    expect(result.linksAdded.some(l => l.sourceId === dupA1.id && l.targetId === relA1.id)).toBe(true)
    expect(result.linksAdded.some(l => l.sourceId === relA1.id && l.targetId === dupA1.id)).toBe(true)
    // Redirect link re-created onto the primary during the merge (session root -> duplicate)
    expect(result.linksAdded.some(l => l.sourceId === sessionRootId && l.targetId === dupA1.id)).toBe(true)
  })

  it("linksAdded contains no duplicate sourceId→targetId→type entries even when several redirects hit the same primary", async () => {
    const sessionId = `ses_consol_b_${crypto.randomUUID()}`
    const run = crypto.randomUUID().slice(0, 8)
    const tagDup = `t-dup-${run}`
    const tagFast = `t-fast-${run}`
    const tagRel = `t-rel-${run}`

    const { result, dupB1, dupB2, dupB3, sessionRootId } = await runTest(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const consolidation = yield* ConsolidationService

        // Triple of near-duplicates (similarity 1.0 within the bucket)
        const dupB1 = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: "Zustand store persistence patterns",
          content: "Zustand persist middleware patterns for stores.",
          tags: [tagDup, tagFast],
          sessionId: sessionId as any,
        }))
        const dupB2 = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: "Zustand store persistence patterns",
          content: "Second copy of the zustand persistence note.",
          tags: [tagDup, tagFast],
          sessionId: sessionId as any,
        }))
        const dupB3 = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: "Zustand store persistence patterns",
          content: "Third copy of the zustand persistence note.",
          tags: [tagDup, tagFast],
          sessionId: sessionId as any,
        }))
        const relB1 = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: "Zustand store persistence patterns guide",
          content: "A related but distinct zustand guide.",
          tags: [tagRel, tagFast, tagDup],
          sessionId: sessionId as any,
        }))

        const session = yield* memory.getSessionMemory(sessionId)

        const result = yield* consolidation.consolidateNodes([dupB1, dupB2, dupB3, relB1])

        return { result, dupB1, dupB2, dupB3, sessionRootId: session.rootNodeId }
      })
    )

    expect(result.merged).toContain(dupB2.id)
    expect(result.merged).toContain(dupB3.id)
    expect(result.linksAdded.length).toBeGreaterThan(0)

    // Core assertion: no two entries share sourceId→targetId→type
    const keys = result.linksAdded.map(linkKey)
    expect(new Set(keys).size).toBe(keys.length)

    // Without dedupe there would be two identical entries here: both dupB2 and dupB3
    // redirected their session-root backlink onto the same primary dupB1
    const redirectsToPrimary = result.linksAdded.filter(
      l => l.sourceId === sessionRootId && l.targetId === dupB1.id
    )
    expect(redirectsToPrimary.length).toBe(1)
  })

  it("consolidateNodes([]) returns empty merged, created, updated and linksAdded", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const consolidation = yield* ConsolidationService
        return yield* consolidation.consolidateNodes([])
      })
    )

    expect(result.merged).toEqual([])
    expect(result.created).toEqual([])
    expect(result.updated).toEqual([])
    expect(result.linksAdded).toEqual([])
  })

  it("mergeNodes redirect path: a backlink C→B is redirected to C→A and reported in linksAdded", async () => {
    const sessionId = `ses_consol_d_${crypto.randomUUID()}`
    const run = crypto.randomUUID().slice(0, 8)
    const tagDup = `t-dup-${run}`
    const tagFast = `t-fast-${run}`
    const tagDec = `t-dec-${run}`

    const { result, nodeA, nodeB, nodeC, bAfter, aAfter, cLinkToA } = await runTest(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const consolidation = yield* ConsolidationService

        // Duplicate pair (type "fact")
        const nodeA = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: "Redis cache invalidation strategy",
          content: "Cache invalidation writes through to Redis.",
          tags: [tagDup, tagFast],
          sessionId: sessionId as any,
        }))
        const nodeB = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: "Redis cache invalidation strategy",
          content: "Duplicate note about Redis cache invalidation.",
          tags: [tagDup, tagFast],
          sessionId: sessionId as any,
        }))
        // Different type + zero tag overlap: strengthening can never link C to A,
        // so any C→A link can only come from the merge redirect path
        const nodeC = yield* memory.createNode(CreateNodeInput.make({
          type: "decision",
          title: "Adopt Redis for rate limiting",
          content: "Decision: use Redis token buckets for rate limiting.",
          tags: [tagDec],
          sessionId: sessionId as any,
        }))

        // C links to B (the future duplicate)
        yield* memory.addLink(nodeC.id, nodeB.id, "references")

        const result = yield* consolidation.consolidateNodes([nodeA, nodeB, nodeC])

        const bAfter = yield* memory.getNode(nodeB.id)
        const aAfter = yield* memory.getNode(nodeA.id)
        if (Option.isNone(aAfter)) throw new Error("primary node missing after merge")
        const cLinkToA = (yield* memory.getBacklinks(nodeA.id)).find(l => l.sourceId === nodeC.id)

        return { result, nodeA, nodeB, nodeC, bAfter, aAfter, cLinkToA }
      })
    )

    // The duplicate was merged away, the primary survived
    expect(result.merged).toContain(nodeB.id)
    expect(Option.isNone(bAfter)).toBe(true)
    expect(Option.isSome(aAfter)).toBe(true)

    // The redirect C→A was created by the merge path and reported in linksAdded
    const redirect = result.linksAdded.find(l => l.sourceId === nodeC.id && l.targetId === nodeA.id)
    expect(redirect).toBeDefined()
    expect(redirect!.type).toBe("references")

    // The redirect really exists in the index with the original link type
    expect(cLinkToA).toBeDefined()
    expect(cLinkToA!.type).toBe("references")

    // Redirect keys stay unique
    const keys = result.linksAdded.map(linkKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
