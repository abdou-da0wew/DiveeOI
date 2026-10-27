// End-to-end (no model download): upload → ingest → mention → gate → grounded context.
// A deterministic bag-of-words hash stands in for bge-m3 so retrieval is meaningful.

import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Store from "../src/store"
import { setRuntime } from "../src/runtime"
import { PINNED_MANIFEST } from "../src/manifest/pinned"
import { deleteBook, startIngest } from "../src/ingest/run"
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

test("model not downloaded → clear not-ready answer, never an ungrounded LLM call", async () => {
  const meta = { mode: "targeted" as const, bookIds: ["x"], books: [{ id: "x", slug: "x", title: "X", lang: "en" }] }
  const turn = await prepareTargetedTurn({ meta, query: "explain mitosis", recentUserTurns: [], ensureFn: async () => false })
  expect(turn.decision).toBe("not-ready")
  expect(turn.refusal).toContain("Start Setup")
})
