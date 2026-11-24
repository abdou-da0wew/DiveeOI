import { describe, it, expect } from "bun:test"
import { Effect, Exit, Layer, Option } from "effect"
import { chmod, mkdir, stat, unlink, utimes, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { MemoryLayer } from "../src/index"
import { MemoryService } from "../src/memory"
import { ConsolidationService, ConsolidationLive, normalizeText } from "../src/consolidation"
import { IndexerService, IndexerLive } from "../src/indexer"
import { MemoryConfig } from "../src/config"
import { Database } from "@diveeoi/db/database/database"
import { CreateNodeInput, MemoryNode, MemoryError, MemoryNodeID } from "../src/schema"

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

describe("Consolidation Service — transactional mergeNodes + normalized duplicate-content detection (T13)", () => {
  const runTest = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runPromise(effect.pipe(Effect.provide(MemoryLayer)))

  /**
   * Injection harness: a real IndexerLive wrapped so one store step
   * (`upsertNode` of the primary, the last write of the merge transaction)
   * fails while the injection is armed. Everything else passes through.
   * MemoryService is a stub that only forwards reads to the (wrapped) indexer
   * and DIEs on the Phase-C filesystem paths — so if the merge ever reached
   * the post-commit phase after a failure, the test would die loudly.
   */
  const makeInjectionHarness = () => {
    const injection = { failUpsertOf: null as MemoryNodeID | null }

    const unused = (name: string) => Effect.die(new Error(`injection stub: MemoryService.${name} must not be called`))

    // Build ONE wrapped IndexerService instance (memoized by reference inside the
    // build), then expose it as IndexerService and — via the read-only stub — as
    // MemoryService.
    const wrappedIndexerLayer = Layer.effect(IndexerService, Effect.gen(function* () {
      const real = yield* IndexerService
      yield* real.initialize() // idempotent schema init for this fresh instance
      const wrapped: typeof real = {
        ...real,
        upsertNode: (node) =>
          injection.failUpsertOf !== null && node.id === injection.failUpsertOf
            ? Effect.fail(new MemoryError({ cause: `injected upsertNode failure for ${node.id}` }))
            : real.upsertNode(node),
      }
      return wrapped
    })).pipe(Layer.provide(IndexerLive))

    const stubMemoryLayer = Layer.effect(MemoryService, Effect.gen(function* () {
      const indexer = yield* IndexerService // = the wrapped instance
      return {
        createNode: () => unused("createNode"),
        getNode: indexer.getNode,
        updateNode: () => unused("updateNode"),
        deleteNode: () => unused("deleteNode"),
        addLink: () => unused("addLink"),
        removeLink: () => unused("removeLink"),
        getBacklinks: indexer.getBacklinks,
        recall: () => unused("recall"),
        getSessionMemory: () => unused("getSessionMemory"),
        bindSessionMemory: () => unused("bindSessionMemory"),
        createSessionRoot: () => unused("createSessionRoot"),
        loadSessionContext: () => unused("loadSessionContext"),
        extractFromSession: () => unused("extractFromSession"),
        extractFromMessages: () => unused("extractFromMessages"),
        consolidate: () => unused("consolidate"),
        search: () => unused("search"),
        getRecent: () => unused("getRecent"),
        getStats: () => unused("getStats"),
        waitForIndexer: indexer.waitForReady,
        isIndexerReady: indexer.isReady,
      }
    }))

    // provideMerge (not provide): the test effect itself needs the wrapped
    // IndexerService (setup/arm/asserts) in the same scope as ConsolidationService.
    const layer = ConsolidationLive.pipe(
      Layer.provideMerge(Layer.mergeAll(stubMemoryLayer, wrappedIndexerLayer).pipe(Layer.provide(wrappedIndexerLayer))),
      Layer.provide(MemoryConfig.defaultLayer),
      Layer.provide(Database.defaultLayer),
    )

    return { injection, layer }
  }

  it("failure injection: a store step failing mid-merge rolls back — NO partial state (primary unchanged, duplicate not deleted, links intact)", async () => {
    const { injection, layer } = makeInjectionHarness()
    const runId = crypto.randomUUID().slice(0, 8)
    const sessionId = `ses_txinj_${runId}` as any

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const indexer = yield* IndexerService
        const consolidation = yield* ConsolidationService

        const makeNode = (suffix: string, title: string, content: string, tags: string[]): MemoryNode =>
          MemoryNode.make({
            id: `mem_${runId}_${suffix}_${crypto.randomUUID().slice(0, 8)}` as MemoryNodeID,
            type: "fact",
            title,
            content,
            tags,
            sessionId,
            created: Date.now(),
            updated: Date.now(),
            confidence: 1,
            path: "" as any,
          })

        const primary = makeNode("primary", "Transactional merge primary", "Primary body about Postgres row level locking.", [`tx-${runId}`])
        const dup = makeNode("dup", "Transactional merge primary", "Duplicate body about Postgres row level locking.", [`tx-${runId}`])
        const linker = makeNode("linker", "Linking node", "A node that points at the duplicate.", [`tx-link-${runId}`])

        yield* indexer.upsertNode(primary)
        yield* indexer.upsertNode(dup)
        yield* indexer.upsertNode(linker)
        yield* indexer.upsertLink(linker.id, dup.id, "references")

        // Arm the injection: inside the merge transaction the primary's
        // upsertNode — the write that runs AFTER the link redirects and the
        // duplicate deletions — fails, forcing a full rollback.
        injection.failUpsertOf = primary.id
        const exit = yield* Effect.exit(consolidation.mergeNodes(primary.id, [dup.id]))
        injection.failUpsertOf = null

        const primaryAfter = yield* indexer.getNode(primary.id)
        const dupAfter = yield* indexer.getNode(dup.id)
        const dupBacklinks = yield* indexer.getBacklinks(dup.id)
        const linkerLinks = yield* indexer.getLinks(linker.id)
        const primaryLinksFromLinker = (yield* indexer.getBacklinks(primary.id)).filter(l => l.sourceId === linker.id)

        return { exit, primaryAfter, dupAfter, dupBacklinks, linkerLinks, primaryLinksFromLinker, primary, dup, linker }
      }).pipe(Effect.provide(layer))
    )

    // The merge failed...
    expect(Exit.isFailure(outcome.exit)).toBe(true)

    // ...and the transaction rolled back completely — NO partial state:
    // primary row untouched (content not merged, tags/confidence unchanged)
    expect(Option.isSome(outcome.primaryAfter)).toBe(true)
    expect(outcome.primaryAfter.value!.content).toBe("Primary body about Postgres row level locking.")
    expect(outcome.primaryAfter.value!.tags).toEqual([`tx-${runId}`])
    expect(outcome.primaryAfter.value!.confidence).toBe(1)

    // duplicate NOT deleted
    expect(Option.isSome(outcome.dupAfter)).toBe(true)

    // the linker's original backlink onto the duplicate is intact...
    expect(outcome.dupBacklinks.some(l => l.sourceId === outcome.linker.id)).toBe(true)
    // ...and no half-created redirect onto the primary exists
    expect(outcome.linkerLinks.some(l => l.targetId === outcome.primary.id)).toBe(false)
    expect(outcome.primaryLinksFromLinker.length).toBe(0)
  })

  it("near-duplicate content (same text, different case/whitespace/punctuation) is still deduped", async () => {
    const sessionId = `ses_consol_tx1_${crypto.randomUUID()}`
    const run = crypto.randomUUID().slice(0, 8)
    const tag = `tx-near-${run}`

    const { merged, primaryContent, dupId } = await runTest(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const consolidation = yield* ConsolidationService

        const primaryContent = "Redis Cache Invalidation: prefer write-through caching with explicit TTL bounds."
        const primary = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: `Near-dup normalization check ${run}`,
          content: primaryContent,
          tags: [tag],
          sessionId: sessionId as any,
        }))
        const dup = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: `Near-dup normalization check ${run}`,
          content: "redis   CACHE\ninvalidation...   prefer WRITE-through  caching, with explicit ttl BOUNDS!!",
          tags: [tag],
          sessionId: sessionId as any,
        }))

        const merged = yield* consolidation.mergeNodes(primary.id, [dup.id])
        return { merged, primaryContent, dupId: dup.id }
      })
    )

    // The near-duplicate was detected via normalized containment:
    // nothing appended, no separator, content exactly the primary's
    expect(merged.content).toBe(primaryContent)
    expect(merged.content).not.toContain("\n\n---\n\n")
    expect(merged.tags).toContain(tag)
    // ...and the duplicate really was merged away
    const dupAfter = await runTest(Effect.gen(function* () {
      const memory = yield* MemoryService
      return yield* memory.getNode(dupId)
    }))
    expect(Option.isNone(dupAfter)).toBe(true)
  })

  it("distinct content sharing the first-100-chars prefix with existing content is NOT dropped", async () => {
    const sessionId = `ses_consol_tx2_${crypto.randomUUID()}`
    const run = crypto.randomUUID().slice(0, 8)
    const tag = `tx-prefix-${run}`

    // Both contents are > 200 chars and share their first 100+ chars verbatim —
    // the old `mergedContent.includes(dup.content.substring(0, 100))` check
    // dropped the duplicate's unique tail entirely.
    const sharedPrefix =
      "The deployment pipeline builds the container image, runs the integration suite, and promotes the artifact "
    const primaryContent = sharedPrefix +
      "across staging environments before any production rollout is allowed to begin, and every change must carry a linked rollback plan."
    const dupContent = sharedPrefix +
      "only after a manual sign-off from the on-call release captain has been recorded in the incident tool and the changelog entry is public."

    const { merged } = await runTest(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const consolidation = yield* ConsolidationService

        const primary = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: `Shared prefix check ${run}`,
          content: primaryContent,
          tags: [tag],
          sessionId: sessionId as any,
        }))
        const dup = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: `Shared prefix check ${run}`,
          content: dupContent,
          tags: [tag],
          sessionId: sessionId as any,
        }))

        return { merged: yield* consolidation.mergeNodes(primary.id, [dup.id]) }
      })
    )

    // The genuinely new tail of the duplicate survived the merge
    expect(merged.content).toBe(primaryContent + "\n\n---\n\n" + dupContent)
    expect(merged.content).toContain("on-call release captain")
  })

  it("normalized containment folds Arabic diacritics (and strips punctuation/case) when detecting duplicate content", async () => {
    // Direct normalizer assertions
    expect(normalizeText("مُحَمَّد")).toBe(normalizeText("محمد"))
    expect(normalizeText("Hello,  WORLD!")).toBe(normalizeText("hello world"))

    const sessionId = `ses_consol_tx3_${crypto.randomUUID()}`
    const run = crypto.randomUUID().slice(0, 8)
    const tag = `tx-ar-${run}`

    const plain = "خطة النشر: بناء تدريجي مع اختبارات آلية في كل مرحلة"
    const vocalized = "خَطَّةُ النَّشْرِ: بناءٌ تدريجيٌّ مع اختباراتٍ آليَّةٍ في كلِّ مرحلةٍ"

    const { merged } = await runTest(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const consolidation = yield* ConsolidationService

        const primary = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: `Arabic folding check ${run}`,
          content: plain,
          tags: [tag],
          sessionId: sessionId as any,
        }))
        const dup = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: `Arabic folding check ${run}`,
          content: vocalized,
          tags: [tag],
          sessionId: sessionId as any,
        }))

        return { merged: yield* consolidation.mergeNodes(primary.id, [dup.id]) }
      })
    )

    // The diacritics-bearing duplicate is the same text once folded: deduped
    expect(merged.content).toBe(plain)
    expect(merged.content).not.toContain("\n\n---\n\n")
  })
  it("Phase C filesystem failure runs the orphan-file cleanup hook and reports an enriched error", async () => {
    // Root (uid 0) bypasses file-mode checks, so the chmod-0o500 trap below
    // cannot make the nodes directory unwritable and the Phase C filesystem
    // failure this test exercises never occurs.
    if (typeof process.getuid === "function" && process.getuid() === 0) return
    const sessionId = `ses_consol_phc_${crypto.randomUUID()}`
    const run = crypto.randomUUID().slice(0, 8)
    const tag = `ph-c-${run}`

    // Fixture: a near-duplicate pair (identical title + tags => similarity 1.0).
    const setup = await runTest(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const config = yield* MemoryConfig
        const primary = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: `Phase C failure check ${run}`,
          content: "Primary content for the post-commit filesystem failure reconciliation test.",
          tags: [tag],
          sessionId: sessionId as any,
        }))
        const dup = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: `Phase C failure check ${run}`,
          content: "Duplicate content for the post-commit filesystem failure reconciliation test.",
          tags: [tag],
          sessionId: sessionId as any,
        }))
        return { primary, dup, memoryDir: config.memoryDir as string }
      }),
    )

    const nodesDir = path.join(setup.memoryDir, "nodes")
    // Make the nodes directory unwritable: the Phase C primary rewrite (writeFile)
    // fails AFTER the merge transaction has committed, exercising the hook.
    await chmod(nodesDir, 0o500)

    let failure: unknown = null
    try {
      await runTest(
        Effect.gen(function* () {
          const memory = yield* MemoryService
          const consolidation = yield* ConsolidationService
          return yield* consolidation.mergeNodes(setup.primary.id, [setup.dup.id])
        }),
      )
    } catch (err) {
      failure = err
    } finally {
      await chmod(nodesDir, 0o755).catch(() => undefined)
    }

    // The merge must fail (not silently "succeed" with a stale mirror)…
    expect(failure).toBeInstanceOf(Error)
    const message = String((failure as { cause?: unknown }).cause ?? (failure as Error).message)
    expect(message).toContain("filesystem sync failed after the merge transaction committed")
    expect(message).toContain("orphan cleanup removed")

    // …and the committed index stays consistent while the mirror is stale:
    const after = await runTest(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const indexer = yield* IndexerService
        return {
          primary: yield* memory.getNode(setup.primary.id),
          dupRow: yield* indexer.getNode(setup.dup.id),
        }
      }),
    )
    expect(Option.isSome(after.primary)).toBe(true)
    expect(after.primary.value.content).toContain("Primary content for the post-commit")
    expect(after.primary.value.content).toContain("Duplicate content for the post-commit")
    expect(Option.isNone(after.dupRow)).toBe(true)

    // The stale duplicate .md file is still on disk (the directory was
    // unwritable). After restoring permissions, the cleanup hook removes it.
    // (Its mtime is back-dated first: a REAL stale duplicate is an old file,
    // and the hook's age guard must skip files young enough to belong to a
    // node whose row write is still in flight.)
    const dupFile = path.join(nodesDir, `${setup.dup.id}.md`)
    expect(await Bun.file(dupFile).exists()).toBe(true)
    const aged = new Date(Date.now() - 120_000)
    await utimes(dupFile, aged, aged)
    const removed = await runTest(Effect.gen(function* () {
      const indexer = yield* IndexerService
      return yield* indexer.cleanupOrphanFiles()
    }))
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(await Bun.file(dupFile).exists()).toBe(false)

    // Cleanup: remove the fixture nodes entirely so later runs start clean.
    await rm(path.join(nodesDir, `${setup.primary.id}.md`), { force: true })
  })

  it("cleanupOrphanFiles removes only rowless, aged, well-named files", async () => {
    const run = crypto.randomUUID().slice(0, 8)
    const result = await runTest(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const indexer = yield* IndexerService
        const config = yield* MemoryConfig
        const nodesDir = path.join(config.memoryDir as string, "nodes")
        yield* Effect.tryPromise(() => mkdir(nodesDir, { recursive: true }))

        // A real node (has a row): its file must survive.
        const kept = yield* memory.createNode(CreateNodeInput.make({
          type: "fact",
          title: `Cleanup keeper ${run}`,
          content: "This node has an index row, so its file must survive the sweep.",
          tags: [`cleanup-keep-${run}`],
          sessionId: `ses_cleanup_${crypto.randomUUID()}` as any,
        }))

        const orphanOld = path.join(nodesDir, `mem_cleanup_old_${run}.md`)
        const orphanFresh = path.join(nodesDir, `mem_cleanup_fresh_${run}.md`)
        const notANode = path.join(nodesDir, `README-${run}.md`)
        yield* Effect.tryPromise(() => writeFile(orphanOld, "orphaned marker file, no row"))
        yield* Effect.tryPromise(() => writeFile(orphanFresh, "fresh orphan — inside the age guard"))
        yield* Effect.tryPromise(() => writeFile(notANode, "not a node file at all"))
        const old = new Date(Date.now() - 120_000)
        yield* Effect.tryPromise(() => utimes(orphanOld, old, old))

        const removed = yield* indexer.cleanupOrphanFiles()
        return { removed, keptId: kept.id, orphanOld, orphanFresh, notANode }
      }),
    )

    expect(result.removed).toBeGreaterThanOrEqual(1)
    expect(await Bun.file(result.orphanOld).exists()).toBe(false)
    // Age guard: a fresh file may belong to a node whose row write is in flight.
    expect(await Bun.file(result.orphanFresh).exists()).toBe(true)
    // Unknown files are never data of ours.
    expect(await Bun.file(result.notANode).exists()).toBe(true)
    // Row-backed node file survives.
    const keptFile = await runTest(Effect.gen(function* () {
      const config = yield* MemoryConfig
      return path.join(config.memoryDir as string, "nodes", `${result.keptId}.md`)
    }))
    expect(await Bun.file(keptFile).exists()).toBe(true)

    // Cleanup of the fresh guard fixture (not rowless data of ours anymore).
    await unlink(result.orphanFresh).catch(() => undefined)
    await unlink(result.notANode).catch(() => undefined)
  })
})