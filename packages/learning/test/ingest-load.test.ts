// Ingest-under-load stress test (Bug #2 re-test — 2026-11-09 ingest RSS spike to 15.8 GB).
//
// A synthetic multi-hundred-page book runs through the REAL ingest orchestrator
// (src/ingest/run.ts: parse → chunk → batch → embed → books.db) with the same
// deterministic bag-of-words stand-in embedder pattern as ingest-turn.test.ts
// (no model download, fully offline, SKIP_LIVE_EMBED-safe).
//
// Asserted resource invariants while the big book is in flight:
//   1. Bounded queue depth — at most `indexing.workersPerBook` embed batches are
//      ever in flight (run.ts wave loop is the backpressure), batch size never
//      exceeds `embedding.batchSize`.
//   2. Checkpointed + released batches — when wave W starts, exactly
//      W × batchSize vectors are already persisted in chunk_vecs. Nothing
//      accumulates embeddings in memory until the end; progress + checkpoint_json
//      advance monotonically to 100.
//   3. Adaptive budget caps — in-flight vectors stay ≤ concurrency × batchSize
//      (≈64 KB of Float32Array at the configured caps, independent of book size).
//   4. No leaks — after completion the in-memory ingest control is released
//      (ingestProgress(bookId) === undefined) and the worker pool (when used)
//      drains to zero busy/queued workers (embed-pool stats()).
//
// The big book deliberately contains NO heading-marker lines ("Chapter N",
// ALL-CAPS lines, …): the TXT parser stamps outline entries with page 1, and
// buildSectionsFromOutline (src/chunk) used to assign the WHOLE book text to
// every section (O(headings × bookSize) duplication). That root cause is now
// FIXED (4-j, same-page outline tiling) — test 5 at the bottom exercises the
// outline-heavy path end-to-end to prove the structure sizes stay linear.

import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Store from "../src/store"
import { setRuntime } from "../src/runtime"
import { PINNED_MANIFEST } from "../src/manifest/pinned"
import { createEmbedWorkerPool } from "../src/ingest/embed-pool"
import { ingestProgress, startIngest } from "../src/ingest/run"

const DIM = 1024
const hashEmbed = (text: string) => {
  const v = new Float32Array(DIM)
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 2166136261
    for (const ch of w) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
    v[Math.abs(h) % DIM] += 1
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
  return v.map((x) => x / n)
}

// ---------------------------------------------------------------------------
// Synthetic large book: 400 "pages" of realistic prose (~0.5 MB), generated
// deterministically. No heading markers (see file header) → linear chunking.
// ---------------------------------------------------------------------------

const SUBJECTS = ["chloroplast", "membrane", "enzyme", "nucleus", "mitochondrion", "stomata", "xylem", "phloem"]
const VERBS = ["converts", "absorbs", "regulates", "transports", "produces", "dissolves", "stores", "releases"]
const OBJECTS = ["light energy", "glucose", "oxygen", "carbon dioxide", "water", "minerals", "proteins", "starch"]

const makePage = (page: number, total: number): string => {
  const lines = [`Page ${page} of ${total}: topic ${page} covers the details below.`]
  for (let s = 0; s < 10; s++) {
    const k = (page * 10 + s) * 3
    lines.push(
      `The ${SUBJECTS[k % SUBJECTS.length]} ${VERBS[(k + 1) % VERBS.length]} ${OBJECTS[(k + 2) % OBJECTS.length]} while study ${page} records stage ${(k % 97) + 1} of the observed process with care and repeated measurements.`,
    )
  }
  return lines.join("\n")
}

const makeBook = (pages: number): string => {
  const out: string[] = []
  for (let p = 1; p <= pages; p++) out.push(makePage(p, pages))
  return out.join("\n\n")
}

const BIG_BOOK = makeBook(400) // ~0.5 MB, ≈800 child passages
const MEDIUM_BOOK = makeBook(120)

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let dir: string
let store: any
let db: Store.BooksDbHandle

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tl-ingest-load-"))
  process.env.DIVEEOI_TL_DATA_DIR = dir
  store = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Store.Service
    }).pipe(Effect.provide(Store.BooksStoreLayer)),
  )
  expect(store.available).toBe(true)
  db = store.db as Store.BooksDbHandle
  setRuntime({ dataDir: dir, modelDir: join(dir, "models"), booksStore: store, manifest: PINNED_MANIFEST })
})

afterAll(() => {
  delete process.env.DIVEEOI_TL_DATA_DIR
  setRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

const waitReady = async (bookId: string) => {
  for (let i = 0; i < 600; i++) {
    const row = await db.get<{ status: string; error: string | null }>("SELECT status, error FROM books WHERE id = ?", bookId)
    if (row?.status === "ready" || row?.status === "failed") return row
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("ingest under load timed out")
}

const vecCount = async (bookId: string) => {
  const row = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chunk_vecs cv JOIN chunks c ON c.id = cv.chunk_id WHERE c.book_id = ?",
    bookId,
  )
  return row?.n ?? 0
}

// ---------------------------------------------------------------------------
// 0. The dead pool stub is really gone (regression guard for the deletion).
// ---------------------------------------------------------------------------

test("dead ingest/pool.ts stub is deleted: no pool fiction in the ingest barrel", async () => {
  expect(import("../src/ingest/pool.ts")).rejects.toBeTruthy()
  const barrel = (await import("../src/ingest/index")) as Record<string, unknown>
  expect(barrel.makePool).toBeUndefined()
  expect(barrel.PoolStatus).toBeUndefined()
  expect(barrel.IngestPool).toBeUndefined()
  expect(barrel.PoolConfig).toBeUndefined()
})

// ---------------------------------------------------------------------------
// 1. Big-book ingest through the orchestrator with instrumented embedder.
// ---------------------------------------------------------------------------

test("400-page book ingests under load with bounded queue, incremental checkpoints, released controls", async () => {
  const batchSize = 8
  const concurrency = 2 // indexing.workersPerBook (in-process path → wave width)
  const budgetCapVectors = concurrency * batchSize // adaptive cap: what may be in flight at once

  const observed = {
    entered: 0,
    inFlight: 0,
    maxInFlight: 0,
    maxBatchLen: 0,
    pendingVectors: 0,
    maxPendingVectors: 0,
    progressSamples: [] as { stage: string; progress: number }[],
    vecMismatches: [] as string[],
    checkpointViolations: [] as string[],
  }
  let bookIdRef: string | null = null

  const instrumentedEmbed = async (texts: string[]): Promise<Float32Array[]> => {
    const call = observed.entered++ // synchronous: preserves wave order
    observed.inFlight += 1
    observed.pendingVectors += texts.length
    observed.maxInFlight = Math.max(observed.maxInFlight, observed.inFlight)
    observed.maxBatchLen = Math.max(observed.maxBatchLen, texts.length)
    observed.maxPendingVectors = Math.max(observed.maxPendingVectors, observed.pendingVectors)
    try {
      const wave = Math.floor(call / concurrency)
      const persisted = await vecCount(bookIdRef!)
      // Waves are sequential: when wave W starts, the W × concurrency batches
      // before it are fully written to books.db. Anything less means results
      // are being hoarded in memory instead of checkpointed per wave.
      const expected = wave * concurrency * batchSize
      if (persisted !== expected) {
        observed.vecMismatches.push(`wave ${wave} call ${call}: persisted=${persisted} expected=${expected}`)
      }
      const job = await db.get<{ id: string; stage: string; progress: number; checkpoint_json: string | null }>(
        "SELECT id, stage, progress, checkpoint_json FROM ingest_jobs WHERE book_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
        bookIdRef!,
      )
      if (job) {
        observed.progressSamples.push({ stage: job.stage, progress: job.progress })
        if (!job.checkpoint_json) observed.checkpointViolations.push(`wave ${wave}: missing checkpoint_json`)
        else {
          try {
            const parsedCheckpoint = JSON.parse(job.checkpoint_json) as { version?: number }
            if (parsedCheckpoint.version !== 1) observed.checkpointViolations.push(`wave ${wave}: bad checkpoint version`)
          } catch {
            observed.checkpointViolations.push(`wave ${wave}: checkpoint_json is not JSON`)
          }
        }
      }
      // Deterministic stand-in embedder (same pattern as ingest-turn.test.ts).
      return texts.map(hashEmbed)
    } finally {
      observed.inFlight -= 1
      observed.pendingVectors -= texts.length
    }
  }

  const heapBefore = process.memoryUsage().heapUsed
  const started = await startIngest({
    db,
    dataDir: dir,
    filename: "load-400-pages.txt",
    bytes: new TextEncoder().encode(BIG_BOOK),
    title: "Load Test Book",
    settings: {
      indexing: { workersPerBook: concurrency },
      embedding: { batchSize },
      // Pinned so batch math does not drift when chunker defaults are tuned.
      chunking: { childTargetTokens: 150, childMaxTokens: 220, childOverlapTokens: 20, minChunkTokens: 30, parentMaxTokens: 1200 },
    },
    embedFn: instrumentedEmbed,
    ensureFn: async () => undefined,
  })
  bookIdRef = started.bookId
  expect(started.duplicate).toBe(false)

  const done = await waitReady(started.bookId)
  expect(done.status).toBe("ready")
  expect(done.error ?? "").toBe("")

  // --- invariant 1: queue depth stayed at the configured cap ---
  expect(observed.entered).toBeGreaterThan(30) // many batches actually went through the queue
  expect(observed.maxInFlight).toBeLessThanOrEqual(concurrency)
  expect(observed.maxBatchLen).toBeLessThanOrEqual(batchSize)

  // --- invariant 2: completed batches were checkpointed + released, not hoarded ---
  expect(observed.vecMismatches).toEqual([])
  expect(observed.checkpointViolations).toEqual([])
  const progress = observed.progressSamples.map((p) => p.progress)
  expect(progress.length).toBeGreaterThan(30)
  for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!)
  expect(observed.progressSamples.some((p) => p.stage === "embed")).toBe(true)

  // --- invariant 3: in-flight vectors stayed inside the adaptive budget ---
  expect(observed.maxPendingVectors).toBeLessThanOrEqual(budgetCapVectors)

  // --- full completion: everything indexed, job checkpoint at 100 ---
  const chunks = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM chunks WHERE book_id = ?", started.bookId)
  const vecs = await vecCount(started.bookId)
  // The count tracks the (actively tuned) token estimator; only "many" matters here.
  expect(chunks.n).toBeGreaterThan(200)
  expect(vecs).toBe(chunks.n)
  const job = await db.get<{ status: string; progress: number; checkpoint_json: string | null }>(
    "SELECT status, progress, checkpoint_json FROM ingest_jobs WHERE book_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
    started.bookId,
  )
  expect(job?.status).toBe("complete")
  expect(job?.progress).toBe(100)
  // checkpoint_json keeps the last staged checkpoint (summary @96); the job row
  // itself carries the final complete/100 state.
  expect(JSON.parse(job?.checkpoint_json ?? "{}")).toMatchObject({ version: 1, stage: "summary", progress: 96 })

  // --- invariant 4: no fiber/control leak after the run ---
  expect(ingestProgress(started.bookId)).toBeUndefined()

  const heapAfter = process.memoryUsage().heapUsed
  console.log(
    `[ingest-load] batches=${observed.entered} maxInFlight=${observed.maxInFlight} maxPendingVectors=${observed.maxPendingVectors} chunks=${chunks.n} heap ${Math.round(heapBefore / 1e6)}MB → ${Math.round(heapAfter / 1e6)}MB`,
  )
}, 55_000)

// ---------------------------------------------------------------------------
// 2. Same load path through the REAL worker pool (createEmbedWorkerPool):
//    many waves cross the postMessage queue while the main thread stays the
//    only SQLite writer.
// ---------------------------------------------------------------------------

test("120-page book ingests through the worker pool with every vector landing on its chunk", async () => {
  let embedFnCalled = false
  const r = await startIngest({
    db,
    dataDir: dir,
    filename: "load-pool-120-pages.txt",
    bytes: new TextEncoder().encode(MEDIUM_BOOK),
    title: "Load Test Book (worker pool)",
    settings: { indexing: { workersPerBook: 2 }, embedding: { batchSize: 4 } },
    workerUrl: new URL("./fixtures/hash-worker.ts", import.meta.url),
    embedFn: async () => {
      embedFnCalled = true
      throw new Error("worker pool should have handled this book")
    },
    ensureFn: async () => undefined,
  })
  const done = await waitReady(r.bookId)
  expect(done.status).toBe("ready")
  expect(done.error ?? "").toBe("")
  expect(embedFnCalled).toBe(false) // no fallback: workers stayed healthy under load

  const counts = await db.get<{ c: number; v: number }>(
    "SELECT (SELECT COUNT(*) FROM chunks WHERE book_id = ?) AS c, (SELECT COUNT(*) FROM chunk_vecs cv JOIN chunks c2 ON c2.id = cv.chunk_id WHERE c2.book_id = ?) AS v",
    r.bookId,
    r.bookId,
  )
  expect(counts.c).toBeGreaterThan(80) // a 120-page book yields many child passages
  expect(counts.v).toBe(counts.c) // sorted batches still map to the right chunk rows
  expect(ingestProgress(r.bookId)).toBeUndefined()
}, 40_000)

// ---------------------------------------------------------------------------
// 3. Direct pool saturation: the internal queue is caller-bounded and fully
//    drains (stats() observes the bounded internal structures).
// ---------------------------------------------------------------------------

test("embed worker pool: 120 queued batches stay bounded on 2 workers and drain to zero", async () => {
  const pool = createEmbedWorkerPool({
    size: 2,
    init: { modelDir: "", signature: {}, options: {} },
    workerUrl: new URL("./fixtures/hash-worker.ts", import.meta.url),
  })
  try {
    let maxBusy = 0
    let maxQueued = 0
    const sampler = setInterval(() => {
      const s = pool.stats()
      maxBusy = Math.max(maxBusy, s.busy)
      maxQueued = Math.max(maxQueued, s.queued)
    }, 2)

    const fired = 120
    // fire all batches without awaiting: the caller (not the pool) decides the burst size
    const pending = Array.from(
      { length: fired },
      (_, i) => pool.embed([`passage ${i} about topic ${i % 9}`, ...Array.from({ length: 7 }, (_, k) => `extra sentence ${i}-${k} for padding`)]),
    )
    // deterministic snapshot right after firing: 2 batches dispatched, 118 queued
    const atFire = pool.stats()
    const all = await Promise.all(pending)
    clearInterval(sampler)

    expect(all.length).toBe(fired)
    expect(all.every((vectors) => vectors.length === 8 && vectors[0]!.length === DIM)).toBe(true)
    expect(atFire).toEqual({ workers: 2, alive: 2, busy: 2, queued: fired - 2 })
    expect(maxBusy).toBeLessThanOrEqual(2) // never more workers than configured
    expect(maxQueued).toBeGreaterThan(0) // the queue genuinely absorbed the burst
    expect(maxQueued).toBeLessThanOrEqual(fired)
    expect(pool.stats()).toEqual({ workers: 2, alive: 2, busy: 0, queued: 0 }) // fully drained, nothing held
  } finally {
    await pool.close()
  }
  await expect(pool.embed(["after close"])).rejects.toBeTruthy()
}, 30_000)

// ---------------------------------------------------------------------------
// 5. Outline-heavy variant (Bug #2 ROOT-CAUSE re-test, 4-j): a TXT book whose
//    every "Chapter N" line becomes a page-1 outline entry. Pre-fix,
//    buildSectionsFromOutline handed the WHOLE book text to EVERY section:
//    measured on a 120-heading 277 KB book → 3720 section rows carrying
//    33.0 MB of section text (119× the book) and 29 280 child chunks; the
//    per-heading duplication is the plausible 15.8 GB RSS crash profile.
//    Post-fix the sections TILE the book text between headings, so the
//    persisted section bytes ≈ book bytes and every count stays linear.
// ---------------------------------------------------------------------------

test("outline-heavy book (one heading per chapter) ingests without per-heading text duplication", async () => {
  const headings = 80
  const chapter = (h: number) =>
    [
      `Chapter ${h + 1}: Topic ${h + 1}`,
      ...Array.from(
        { length: 8 },
        (_, s) =>
          `The observed specimen converts measured input energy into stored reserves with repeatable accuracy during trial ${h * 8 + s} of the recorded experiment series.`,
      ),
    ].join("\n\n")
  const outlineBook = Array.from({ length: headings }, (_, h) => chapter(h)).join("\n\n")
  const bookBytes = outlineBook.length

  const r = await startIngest({
    db,
    dataDir: dir,
    filename: "outline-heavy-80-chapters.txt",
    bytes: new TextEncoder().encode(outlineBook),
    title: "Outline Heavy Book",
    settings: {
      indexing: { workersPerBook: 2 },
      embedding: { batchSize: 8 },
      // Pinned like test 1 so the count math does not drift when defaults are tuned.
      chunking: { childTargetTokens: 150, childMaxTokens: 220, childOverlapTokens: 20, minChunkTokens: 30, parentMaxTokens: 1200 },
    },
    embedFn: async (texts) => texts.map(hashEmbed),
    ensureFn: async () => undefined,
  })
  const done = await waitReady(r.bookId)
  expect(done.status).toBe("ready")
  expect(done.error ?? "").toBe("")

  const counts = await db.get<{ sections: number; chunks: number; vecs: number; sectionBytes: number }>(
    `SELECT (SELECT COUNT(*) FROM sections WHERE book_id = ?) AS sections,
            (SELECT COUNT(*) FROM chunks WHERE book_id = ?) AS chunks,
            (SELECT COUNT(*) FROM chunk_vecs cv JOIN chunks c ON c.id = cv.chunk_id WHERE c.book_id = ?) AS vecs,
            (SELECT COALESCE(SUM(length(text)), 0) FROM sections WHERE book_id = ?) AS sectionBytes
       FROM (SELECT 1)`,
    r.bookId,
    r.bookId,
    r.bookId,
    r.bookId,
  )

  // Exactly one parent section per heading (each chapter ≈ 310 tokens, below
  // the 1200 parentMaxTokens, so no slice rows): NOT headings × whole-book slices.
  expect(counts.sections).toBe(headings)

  // The section rows TILE the book text — pre-fix this sum was headings × bookBytes.
  expect(counts.sectionBytes).toBe(bookBytes)

  // Child chunks ≈ bookTokens/150 (+ per-section slack), not headings × that.
  const bookTokens = Math.ceil(bookBytes / 4)
  expect(counts.chunks).toBeLessThanOrEqual(3 * Math.ceil(bookTokens / 150) + headings)
  expect(counts.vecs).toBe(counts.chunks)
  expect(ingestProgress(r.bookId)).toBeUndefined()

  const heapAfter = process.memoryUsage().heapUsed
  console.log(
    `[ingest-load][outline-heavy] headings=${headings} bookBytes=${bookBytes} sections=${counts.sections} sectionBytes=${counts.sectionBytes} (pre-fix would be ≈ ${(headings * bookBytes / 1e6).toFixed(1)}MB) chunks=${counts.chunks} heap=${Math.round(heapAfter / 1e6)}MB`,
  )
}, 40_000)

// ---------------------------------------------------------------------------
// 6. Retained-heap pin for the run.ts parsed/chunked pruning (2026-11-23).
//
//    After chunkBook, run.ts snapshots the small summary facts, then releases
//    parsed.pages/outline ("parsed = { ...parsed, pages: [], outline: [] }")
//    and the whole ChunkResult ("chunked = null") so the embed phase retains
//    only chunk-row text (plus its text_norm twin and the paced-write queue).
//
//    TWO pins, because JSC liveness analysis makes them complementary:
//      a) RETAINED-HEAP assertion: a forced-GC heap snapshot is taken inside
//         the embed callback and the total size of live primitive strings is
//         bounded. Measured baseline (this fixture, bun 1.3.14): ~4.0x book
//         (chunk text + text_norm ≈ 2x, one parser-side copy + the paced-write
//         queue ≈ 2x). Threshold 4.6x book fails any refactor that CAPTURES
//         parsed/chunked into a closure or otherwise keeps page/section text
//         reachable during embedding (+2x book minimum → >6x).
//      b) SOURCE-ORDER pin: JSC prunes generator/async locals after their last
//         read, so a bare revert of the two pruning lines is GC-invisible
//         (verified 2026-11-23: reverted run measures the identical 59.65 MB).
//         The source pin fails the literal revert and checks the statements
//         sit in the right order in the run flow.
// ---------------------------------------------------------------------------

test("embed phase retains ~4xbook, not pages/sections (parsed/chunked pruning is pinned)", async () => {
  const pages = 64
  const filler =
    "The observed specimen converts measured input energy into stored reserves with repeatable accuracy during the recorded experiment series of this page. "
  const pageText = (p: number) =>
    `Page ${p} of ${pages}: dense prose block ${p}.\n` + filler.repeat(1530) // ≈ 190 KB per page
  const parts = Array.from({ length: pages }, (_, i) => pageText(i + 1))
  const bytes = new TextEncoder().encode(parts.join("\n\n"))
  const bookBytes = bytes.length
  parts.length = 0 // the test must not retain the joined page strings itself

  // (b) source-order pin — see the block comment above.
  const runSource = await Bun.file(new URL("../src/ingest/run.ts", import.meta.url)).text()
  const parsedPrune = runSource.indexOf("parsed = { ...parsed, pages: [], outline: [] }")
  const chunkedRelease = runSource.indexOf("chunked = null")
  const summaryFactsAt = runSource.indexOf("const summaryFacts = (() => {")
  const itemsAt = runSource.indexOf("const items = chunked!.chunks")
  const waveAt = runSource.indexOf("for (let w = 0; w < batches.length; w += concurrency)")
  expect(parsedPrune).toBeGreaterThan(-1)
  expect(chunkedRelease).toBeGreaterThan(-1)
  expect(summaryFactsAt).toBeGreaterThan(-1)
  expect(itemsAt).toBeGreaterThan(-1)
  expect(waveAt).toBeGreaterThan(-1)
  // snapshot facts → release pages → build items → release chunked → embed waves
  expect(parsedPrune).toBeGreaterThan(summaryFactsAt)
  expect(itemsAt).toBeGreaterThan(parsedPrune)
  expect(chunkedRelease).toBeGreaterThan(itemsAt)
  expect(chunkedRelease).toBeLessThan(waveAt)

  const liveStringBytes = (): number => {
    Bun.gc(true)
    const snap = Bun.generateHeapSnapshot()
    const nodes = snap.nodes as number[]
    const names = snap.nodeClassNames as string[]
    let total = 0
    for (let i = 0; i < nodes.length; i += 4) {
      if (names[nodes[i + 2]!] === "string") total += nodes[i + 1]!
    }
    return total
  }

  const samples: number[] = []
  const embedProbe = async (texts: string[]): Promise<Float32Array[]> => {
    // First and last batch bracket the embed phase; the retained set is steady
    // in between (verified: 59,651,157 → 59,651,415 bytes on this fixture).
    if (samples.length === 0 || texts.length < 64) samples.push(liveStringBytes())
    return texts.map(hashEmbed)
  }

  const r = await startIngest({
    db,
    dataDir: dir,
    filename: "retained-heap-64-pages.txt",
    bytes,
    title: "Retained Heap Book",
    settings: {
      indexing: { workersPerBook: 2 },
      embedding: { batchSize: 64 },
      // Huge child chunks keep the CHUNK COUNT low (fast test) while the TEXT
      // volume stays high — the shape that makes retained page/section text
      // measurable against chunk text.
      chunking: { childTargetTokens: 1000, childMaxTokens: 2000, childOverlapTokens: 20, minChunkTokens: 30, parentMaxTokens: 60000 },
    },
    embedFn: embedProbe,
    ensureFn: async () => undefined,
  })
  const done = await waitReady(r.bookId)
  expect(done.status).toBe("ready")
  expect(done.error ?? "").toBe("")

  expect(samples.length).toBe(2)
  const maxRetained = Math.max(...samples)
  console.log(
    `[ingest-load][retained-heap] bookBytes=${bookBytes} liveStrings=${Math.round(maxRetained / 1e6)}MB (= ${(maxRetained / bookBytes).toFixed(2)}x book)`,
  )
  // (a) retained-heap assertion — see the block comment above.
  expect(maxRetained).toBeLessThan(4.6 * bookBytes)
  expect(ingestProgress(r.bookId)).toBeUndefined()
}, 55_000)
