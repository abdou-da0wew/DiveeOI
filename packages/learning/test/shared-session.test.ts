// workersPerBook > 1 without Worker threads: several batches in flight on ONE shared embedder.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Store from "../src/store"
import { setRuntime } from "../src/runtime"
import { PINNED_MANIFEST } from "../src/manifest/pinned"
import { startIngest } from "../src/ingest/run"

let dir: string
let store: any
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tl-shared-"))
  process.env.DIVEEOI_TL_DATA_DIR = dir
  store = await Effect.runPromise(Effect.gen(function* () { return yield* Store.Service }).pipe(Effect.provide(Store.BooksStoreLayer)))
  setRuntime({ dataDir: dir, modelDir: join(dir, "models"), booksStore: store, manifest: PINNED_MANIFEST })
})
afterAll(() => {
  delete process.env.DIVEEOI_TL_DATA_DIR
  setRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

const BOOK = Array.from({ length: 40 }, (_, i) => `Chapter ${i + 1} Topic ${i}\n\nThis section explains topic number ${i} with several sentences about subject ${i}. It continues with details for topic ${i}.`).join("\n\n")
const run = async (workers: number) => {
  let inFlight = 0
  let max = 0
  const seen: string[] = []
  const r = await startIngest({
    db: store.db, dataDir: dir, filename: `w${workers}.txt`, bytes: new TextEncoder().encode(BOOK + `\n\nvariant ${workers}`),
    settings: { indexing: { workersPerBook: workers }, embedding: { batchSize: 4 } },
    embedFn: async (texts) => {
      inFlight++
      max = Math.max(max, inFlight)
      seen.push(...texts)
      await new Promise((res) => setTimeout(res, 15))
      inFlight--
      return texts.map((t) => { const v = new Float32Array(1024); v[t.length % 1024] = 1; return v })
    },
    ensureFn: async () => undefined,
  })
  for (let i = 0; i < 200; i++) {
    const row = await store.db.get("SELECT status, error FROM books WHERE id = ?", r.bookId)
    if (row.status === "ready" || row.status === "failed") {
      const n = await store.db.get("SELECT (SELECT count(*) FROM chunks WHERE book_id = ?) c, (SELECT count(*) FROM chunk_vecs WHERE chunk_id IN (SELECT id FROM chunks WHERE book_id = ?)) v", r.bookId, r.bookId)
      return { row, max, texts: seen.length, ...n }
    }
    await new Promise((res) => setTimeout(res, 50))
  }
  throw new Error("timeout")
}

test("workersPerBook=1 embeds one batch at a time", async () => {
  const r = await run(1)
  expect(r.row.status).toBe("ready")
  expect(r.max).toBe(1)
})

test("workersPerBook=3 keeps 3 batches in flight on the same embedder; every passage is embedded once", async () => {
  const r = await run(3)
  expect(r.row.error ?? "").toBe("")
  expect(r.row.status).toBe("ready")
  expect(r.max).toBe(3)
  expect(r.v).toBe(r.c)
  expect(r.texts).toBe(r.c) // split, not doubled
})
