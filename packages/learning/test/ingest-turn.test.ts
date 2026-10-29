// End-to-end (no model download): upload → ingest → mention → gate → grounded context.
// A deterministic bag-of-words hash stands in for bge-m3 so retrieval is meaningful.

import { afterAll, beforeAll, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { Effect } from "effect"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Store from "../src/store"
import { setRuntime } from "../src/runtime"
import { PINNED_MANIFEST } from "../src/manifest/pinned"
import {
  cancelIngestJob,
  deleteBook,
  listIngestJobs,
  pauseIngestJob,
  resumeIngestJob,
  retryIngestJob,
  startIngest,
} from "../src/ingest/run"
import { attachBookMentions, prepareTargetedTurn } from "../src/session/turn"

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

let dir: string
let store: any
const BOOK = `Chapter 1 Photosynthesis

Photosynthesis is the process by which green plants convert light energy into chemical energy. Chlorophyll in the chloroplasts absorbs sunlight. The plant uses water and carbon dioxide to produce glucose and oxygen during photosynthesis.

Chapter 2 Cell Division

Mitosis is the process of cell division that produces two identical daughter cells. During mitosis the chromosomes are copied and separated into the two nuclei of the new cells.
`

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tl-ingest-"))
  process.env.DIVEEOI_TL_DATA_DIR = dir
  const s = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Store.Service
    }).pipe(Effect.provide(Store.BooksStoreLayer)),
  )
  expect(s.available).toBe(true)
  ;(store as any) = s
  setRuntime({ dataDir: dir, modelDir: join(dir, "models"), booksStore: s as any, manifest: PINNED_MANIFEST })
})
afterAll(() => {
  delete process.env.DIVEEOI_TL_DATA_DIR
  setRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

const waitReady = async (id: string) => {
  const db = (store as any).db
  for (let i = 0; i < 100; i++) {
    const row = await db.get("SELECT status, error FROM books WHERE id = ?", id)
    if (row.status === "ready" || row.status === "failed") return row
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("ingest timed out")
}

const waitJobStatus = async (jobId: string, expected: string[]) => {
  const db = (store as any).db
  for (let i = 0; i < 100; i++) {
    const job = await db.get("SELECT status FROM ingest_jobs WHERE id = ?", jobId)
    if (job && expected.includes(job.status)) return job
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`ingest job ${jobId} did not reach ${expected.join("/")}`)
}

const jobIdForBook = async (bookId: string) => {
  const jobs = await listIngestJobs((store as any).db)
  const job = jobs.find((entry) => entry.bookId === bookId)
  if (!job) throw new Error(`ingest job for ${bookId} was not created`)
  return job.id
}

test("ingest → mention → gate → grounded context, off-topic refused without LLM", async () => {
  const db = (store as any).db
  const r = await startIngest({
    db,
    dataDir: dir,
    filename: "biology.txt",
    bytes: new TextEncoder().encode(BOOK),
    title: "Biology Basics",
    embedFn: async (texts) => texts.map(hashEmbed),
    ensureFn: async () => undefined,
  })
  expect(r.duplicate).toBe(false)
  const done = await waitReady(r.bookId)
  expect(done.status).toBe("ready")
  const chunks = await db.get("SELECT count(*) AS n FROM chunks WHERE book_id = ?", r.bookId)
  expect(chunks.n).toBeGreaterThan(0)

  // same bytes again = duplicate, no second book
  const again = await startIngest({ db, dataDir: dir, filename: "biology.txt", bytes: new TextEncoder().encode(BOOK) })
  expect(again.duplicate).toBe(true)

  const meta = await attachBookMentions(`@book:${r.slug} what is photosynthesis?`, undefined)
  expect(meta?.mode).toBe("targeted")
  expect(meta?.bookIds).toEqual([r.bookId])
  expect(await attachBookMentions("no mention here", undefined)).toBeNull()

  const seams = { ensureFn: async () => true, embedFn: async (q: string) => hashEmbed(q) }
  const onTopic = await prepareTargetedTurn({ meta: meta!, query: "how do green plants convert light energy into chemical energy by photosynthesis", recentUserTurns: [], ...seams })
  expect(onTopic.refusal).toBeUndefined()
  expect(onTopic.system.join("\n")).toContain("<book_context>")
  expect(onTopic.system.join("\n").toLowerCase()).toContain("chlorophyll")

  const offTopic = await prepareTargetedTurn({ meta: meta!, query: "who won the football match yesterday", recentUserTurns: [], ...seams })
  expect(offTopic.decision).toBe("refused")
  expect(offTopic.refusal).toContain("isn't covered")

  const arabicOff = await prepareTargetedTurn({ meta: meta!, query: "من فاز في مباراة كرة القدم", recentUserTurns: [], ...seams })
  expect(arabicOff.refusal).toBeTruthy()

  const hello = await prepareTargetedTurn({ meta: meta!, query: "hello", recentUserTurns: [], ...seams })
  expect(hello.refusal).toBeUndefined()

  expect(await deleteBook(db, dir, r.bookId)).toBe(true)
  const left = await db.get("SELECT count(*) AS n FROM chunks WHERE book_id = ?", r.bookId)
  expect(left.n).toBe(0)
})

test("ingest jobs pause at a checkpoint and resume to completion", async () => {
  const db = (store as any).db
  let notifyEmbed: (() => void) | undefined
  const embedEntered = new Promise<void>((resolve) => {
    notifyEmbed = resolve
  })
  let releaseEmbed!: () => void
  const holdEmbed = new Promise<void>((resolve) => {
    releaseEmbed = resolve
  })
  const text = `Chapter 1 Adaptive Biology\n\n${"Cells convert light into chemical energy through photosynthesis. ".repeat(20)}`
  const result = await startIngest({
    db,
    dataDir: dir,
    filename: "pause-resume.txt",
    bytes: new TextEncoder().encode(text),
    embedFn: async (texts) => {
      notifyEmbed?.()
      await holdEmbed
      return texts.map(hashEmbed)
    },
    ensureFn: async () => undefined,
  })
  const jobId = await jobIdForBook(result.bookId)

  try {
    await embedEntered
    expect(await pauseIngestJob(db, jobId)).toBe(true)
    releaseEmbed()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect((await db.get("SELECT status FROM ingest_jobs WHERE id = ?", jobId)).status).toBe("paused")
    expect(await resumeIngestJob(db, jobId, dir)).toBe(true)
    expect((await waitReady(result.bookId)).status).toBe("ready")
    expect((await waitJobStatus(jobId, ["complete"])).status).toBe("complete")
  } finally {
    releaseEmbed()
  }
})

test("ingest cancellation cleans partial rows and recovery rejects an escaped source path", async () => {
  const db = (store as any).db
  let notifyEmbed: (() => void) | undefined
  const embedEntered = new Promise<void>((resolve) => {
    notifyEmbed = resolve
  })
  let releaseEmbed!: () => void
  const holdEmbed = new Promise<void>((resolve) => {
    releaseEmbed = resolve
  })
  const text = `Chapter 1 Cell Safety\n\n${"Cell membranes regulate movement into and out of the cell. ".repeat(20)}`
  const result = await startIngest({
    db,
    dataDir: dir,
    filename: "cancel-job.txt",
    bytes: new TextEncoder().encode(text),
    embedFn: async (texts) => {
      notifyEmbed?.()
      await holdEmbed
      return texts.map(hashEmbed)
    },
    ensureFn: async () => undefined,
  })
  const jobId = await jobIdForBook(result.bookId)

  try {
    await embedEntered
    expect(await cancelIngestJob(db, jobId)).toBe(true)
    releaseEmbed()
    expect((await waitJobStatus(jobId, ["cancelled"])).status).toBe("cancelled")
    const rows = await db.get("SELECT count(*) AS n FROM chunks WHERE book_id = ?", result.bookId)
    expect(rows.n).toBe(0)
    // Let runIngest finish its final cleanup and release the in-memory control.
    await new Promise((resolve) => setTimeout(resolve, 30))

    const escaped = join(dir, "outside-source.txt")
    writeFileSync(escaped, text)
    await db.run("UPDATE books SET source_path = ? WHERE id = ?", escaped, result.bookId)
    expect(await retryIngestJob(db, jobId, dir)).toBe(false)
    expect((await db.get("SELECT status FROM ingest_jobs WHERE id = ?", jobId)).status).toBe("failed")
    expect(existsSync(escaped)).toBe(true)
  } finally {
    releaseEmbed()
  }
})

test("cancelling a persisted job during its recovery claim prevents a worker from starting", async () => {
  const db = (store as any).db as Store.BooksDbHandle
  const bookId = `book_${randomUUID().replace(/-/g, "")}`
  const jobId = `job_${randomUUID().replace(/-/g, "").slice(0, 12)}`
  const sourcePath = join(dir, "books", `${bookId}.txt`)
  const bytes = new TextEncoder().encode("Chapter 1 Recovery\n\nA persisted source used to test cancellation races.")
  const hash = createHash("sha256").update(bytes).digest("hex")
  mkdirSync(join(dir, "books"), { recursive: true })
  writeFileSync(sourcePath, bytes)
  await db.run(
    "INSERT INTO books (id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at) VALUES (?, ?, ?, ?, ?, 'pending', 'test', 1, ?)",
    bookId,
    bookId,
    "Recovery race",
    hash,
    sourcePath,
    Date.now(),
  )
  await db.run(
    "INSERT INTO ingest_jobs (id, book_id, stage, status, progress, started_at) VALUES (?, ?, 'parse', 'running', 0, ?)",
    jobId,
    bookId,
    Date.now(),
  )

  let notifyLookup!: () => void
  const lookupEntered = new Promise<void>((resolve) => {
    notifyLookup = resolve
  })
  let releaseLookup!: () => void
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve
  })
  const delayedDb = {
    ...db,
    get: async <T>(sql: string, ...params: unknown[]) => {
      if (sql.includes("FROM ingest_jobs j JOIN books b")) {
        notifyLookup()
        await lookupGate
      }
      return db.get<T>(sql, ...params)
    },
  } as Store.BooksDbHandle

  try {
    const recovery = resumeIngestJob(delayedDb, jobId, dir)
    await lookupEntered
    const cancellation = cancelIngestJob(db, jobId)
    releaseLookup()

    expect(await cancellation).toBe(true)
    expect(await recovery).toBe(false)
    expect((await db.get<{ status: string }>("SELECT status FROM ingest_jobs WHERE id = ?", jobId))?.status).toBe("cancelled")
    expect((await db.get<{ status: string }>("SELECT status FROM books WHERE id = ?", bookId))?.status).toBe("cancelled")
  } finally {
    releaseLookup()
    await db.run("DELETE FROM books WHERE id = ?", bookId)
    rmSync(sourcePath, { force: true })
  }
})

test("model not downloaded → clear not-ready answer, never an ungrounded LLM call", async () => {
  const meta = { mode: "targeted" as const, bookIds: ["x"], books: [{ id: "x", slug: "x", title: "X", lang: "en" }] }
  const turn = await prepareTargetedTurn({ meta, query: "explain mitosis", recentUserTurns: [], ensureFn: async () => false })
  expect(turn.decision).toBe("not-ready")
  expect(turn.refusal).toContain("Start Setup")
})
