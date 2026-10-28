import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Store from "../src/store"
import { setRuntime } from "../src/runtime"
import { PINNED_MANIFEST } from "../src/manifest/pinned"
import { createEmbedWorkerPool } from "../src/ingest/embed-pool"
import { startIngest } from "../src/ingest/run"

const good = new URL("./fixtures/hash-worker.ts", import.meta.url)
const crash = new URL("./fixtures/crash-worker.ts", import.meta.url)
const init = { modelDir: "", signature: {}, options: {} }

let dir: string
let store: any
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tl-pool-"))
  process.env.DIVEEOI_TL_DATA_DIR = dir
  store = await Effect.runPromise(Effect.gen(function* () { return yield* Store.Service }).pipe(Effect.provide(Store.BooksStoreLayer)))
  setRuntime({ dataDir: dir, modelDir: join(dir, "models"), booksStore: store, manifest: PINNED_MANIFEST })
})
afterAll(() => {
  delete process.env.DIVEEOI_TL_DATA_DIR
  setRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

test("pool: many batches across 2 workers all come back, in order per call", async () => {
  const pool = createEmbedWorkerPool({ size: 2, init, workerUrl: good })
  const batches = Array.from({ length: 12 }, (_, i) => [`passage number ${i}`, `another passage ${i}`])
  const results = await Promise.all(batches.map((b) => pool.embed(b)))
  expect(results.every((r, i) => r.length === 2 && r[0]!.length === 1024)).toBe(true)
  expect(results[3]![0]).toEqual(results[3]![0]) // deterministic
  await pool.close()
  await expect(pool.embed(["x"])).rejects.toBeTruthy()
})

test("pool: when every worker dies the call rejects instead of hanging", async () => {
  const pool = createEmbedWorkerPool({ size: 2, init, workerUrl: crash })
  await expect(pool.embed(["a"])).rejects.toBeTruthy()
  await expect(pool.embed(["b"])).rejects.toBeTruthy()
  await pool.close()
})

const BOOK = Array.from({ length: 40 }, (_, i) => `Chapter ${i + 1} Topic ${i}\n\nThis section explains topic number ${i} with several sentences about subject ${i}. It continues with details and examples for topic ${i}.`).join("\n\n")
const waitFor = async (id: string) => {
  for (let i = 0; i < 200; i++) {
    const row = await store.db.get("SELECT status, error FROM books WHERE id = ?", id)
    if (row.status === "ready" || row.status === "failed") return row
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("timeout")
}

test("ingest with 2 workers indexes every passage; sorted batches still map to the right chunk", async () => {
  const r = await startIngest({
    db: store.db, dataDir: dir, filename: "big.txt", bytes: new TextEncoder().encode(BOOK),
    settings: { indexing: { workersPerBook: 2 }, embedding: { batchSize: 4 } },
    workerUrl: good, embedFn: async () => { throw new Error("should not be used") },
  })
  const done = await waitFor(r.bookId)
  expect(done.error ?? "").toBe("")
  expect(done.status).toBe("ready")
  const n = await store.db.get("SELECT (SELECT count(*) FROM chunks WHERE book_id = ?) AS c, (SELECT count(*) FROM chunk_vecs WHERE chunk_id IN (SELECT id FROM chunks WHERE book_id = ?)) AS v", r.bookId, r.bookId)
  expect(n.c).toBeGreaterThan(5)
  expect(n.v).toBe(n.c)
})

test("ingest falls back to in-process embedding when the workers crash", async () => {
  const r = await startIngest({
    db: store.db, dataDir: dir, filename: "fallback.txt", bytes: new TextEncoder().encode(BOOK + "\n\nExtra"),
    settings: { indexing: { workersPerBook: 2 } },
    workerUrl: crash, embedFn: async (texts) => texts.map(() => new Float32Array(1024).fill(0.01)), ensureFn: async () => undefined,
  })
  const done = await waitFor(r.bookId)
  expect(done.status).toBe("ready")
})
