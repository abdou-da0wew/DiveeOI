import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Store from "../src/store"
import { setRuntime } from "../src/runtime"
import { PINNED_MANIFEST } from "../src/manifest/pinned"
import { withDefaults } from "../src/settings/defaults"
import { startIngest } from "../src/ingest/run"
import {
  deleteStudentMemory,
  listBookNotes,
  listStudentMemories,
  pinStudentMemory,
  relevantBookNotes,
  studentProfileBlock,
  writeBookNote,
  writeStudentMemory,
} from "../src/memory/service"
import { recordRetrieved, resetRetrieved } from "../src/grounding/turn-state"
import { verifyAnswer, verifyAnswerNote } from "../src/grounding/post"

let dir: string
let store: any
let bookId = ""
let chunkId = ""
const hashEmbed = (text: string) => {
  const v = new Float32Array(1024)
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 2166136261
    for (const ch of w) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
    v[Math.abs(h) % 1024] += 1
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
  return v.map((x) => x / n)
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tl-mem-"))
  process.env.DIVEEOI_TL_DATA_DIR = dir
  store = await Effect.runPromise(Effect.gen(function* () { return yield* Store.Service }).pipe(Effect.provide(Store.BooksStoreLayer)))
  setRuntime({ dataDir: dir, modelDir: join(dir, "models"), booksStore: store, manifest: PINNED_MANIFEST })
  const r = await startIngest({
    db: store.db,
    dataDir: dir,
    filename: "math.txt",
    bytes: new TextEncoder().encode("Chapter 1 Fractions\n\nA fraction represents a part of a whole. The numerator is the top number and the denominator is the bottom number of the fraction.\n"),
    title: "Math 5",
    embedFn: async (t) => t.map(hashEmbed),
    ensureFn: async () => undefined,
    // chunk.test.ts installs a 1-word ≈ 1-token stub tokenizer process-globally;
    // with the default minChunkTokens (30) this tiny fixture ingests zero chunks.
    settings: withDefaults({ chunking: { minChunkTokens: 5 } }),
  })
  bookId = r.bookId
  let ready = false
  for (let i = 0; i < 400; i++) {
    const row = await store.db.get("SELECT status FROM books WHERE id = ?", bookId)
    if (row.status === "ready") {
      ready = true
      break
    }
    await new Promise((x) => setTimeout(x, 50))
  }
  if (!ready) {
    const err = await store.db.get("SELECT status, error FROM books WHERE id = ?", bookId)
    throw new Error(`book ingest did not finish within 25s during memory-verify setup: status=${err?.status} error=${err?.error}`)
  }
  chunkId = (await store.db.get("SELECT id FROM chunks WHERE book_id = ? LIMIT 1", bookId)).id
}, 30_000)
afterAll(() => {
  delete process.env.DIVEEOI_TL_DATA_DIR
  setRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

test("student memory: write, dedupe, kind guard, per-turn limit, pin order, delete", async () => {
  const a = await writeStudentMemory({ kind: "style", text: "Prefers step-by-step worked examples", turnKey: "t1" })
  expect(a.ok && !a.merged).toBe(true)
  const dup = await writeStudentMemory({ kind: "style", text: "prefers step-by-step worked examples", turnKey: "t1" })
  expect(dup.ok && dup.merged).toBe(true)
  const bad = await writeStudentMemory({ kind: "fact", text: "The capital of France is Paris", turnKey: "t1" })
  expect(bad.ok).toBe(false)
  await writeStudentMemory({ kind: "goal", text: "Wants to pass the grade 5 exam in June", turnKey: "t2" })
  await writeStudentMemory({ kind: "level", text: "Struggles with dividing fractions", turnKey: "t2" })
  await writeStudentMemory({ kind: "preference", text: "Explain in Arabic first then English", turnKey: "t2" })
  const limited = await writeStudentMemory({ kind: "gap", text: "Mixes up numerator and denominator", turnKey: "t2" })
  expect(limited.ok).toBe(false) // 4th write in one turn
  const rows = listStudentMemories()
  expect(rows.length).toBe(4)
  const goal = rows.find((r) => r.kind === "goal")!
  expect(pinStudentMemory(goal.id, true)).toBe(true)
  const block = studentProfileBlock()!
  expect(block).toContain("<student_profile>")
  expect(block.indexOf("[goal]")).toBeLessThan(block.indexOf("[style]")) // pinned first
  expect(deleteStudentMemory(goal.id)).toBe(true)
  expect(listStudentMemories().length).toBe(3)
})

test("book notes: need real citations, are retrieved by relevance, go stale when the book changes", async () => {
  const noCite = await writeBookNote({ db: store.db, bookId, kind: "where", text: "Fractions are defined in chapter 1", citedChunkIds: [], turnKey: "n1" })
  expect(noCite.ok).toBe(false)
  const fake = await writeBookNote({ db: store.db, bookId, kind: "where", text: "Fractions are defined in chapter 1", citedChunkIds: ["bk_nope-s1-c1"], turnKey: "n1" })
  expect(fake.ok).toBe(false)
  const ok = await writeBookNote({ db: store.db, bookId, kind: "definition", text: "Numerator is the top number, denominator the bottom", citedChunkIds: [chunkId], turnKey: "n2" })
  expect(ok.ok).toBe(true)
  const dup = await writeBookNote({ db: store.db, bookId, kind: "definition", text: "numerator is the top number, denominator the bottom", citedChunkIds: [chunkId], turnKey: "n2" })
  expect(dup.ok && dup.merged).toBe(true)

  const block = await relevantBookNotes({ db: store.db, bookIds: [bookId], query: "what is the numerator of a fraction", queryVec: null })
  expect(block).toContain("<book_notes>")
  expect(block).toContain(chunkId)
  const unrelated = await relevantBookNotes({ db: store.db, bookIds: [bookId], query: "football transfer news", queryVec: null })
  expect(unrelated).toBeNull()

  await store.db.run("UPDATE books SET source_hash = 'changed' WHERE id = ?", bookId)
  expect(await relevantBookNotes({ db: store.db, bookIds: [bookId], query: "numerator of a fraction", queryVec: null })).toBeNull()
  expect((await listBookNotes(store.db, bookId))[0]!.stale).toBe(true)
})

test("verifier: accepts shown passages, flags never-shown or invented citations", async () => {
  resetRetrieved("s1")
  recordRetrieved("s1", [chunkId])
  const good = await verifyAnswerNote({ sessionId: "s1", answer: `The numerator is the top number [${chunkId}].` })
  expect(good).toBeNull()
  const invented = await verifyAnswerNote({ sessionId: "s1", answer: `Something else [bk_zzzz-s9-c9].` })
  expect(invented).toContain("could not be verified")
  resetRetrieved("s2") // passage exists but this turn never showed it
  const unseen = await verifyAnswerNote({ sessionId: "s2", answer: `The numerator is the top number [${chunkId}].` })
  expect(unseen).toContain("not shown to the model")
  const long = "x".repeat(300)
  expect(await verifyAnswerNote({ sessionId: "s1", answer: long })).toContain("cites no passages")
  expect(await verifyAnswerNote({ sessionId: "s1", answer: long, settings: { grounding: { verify: "off" } } })).toBeNull()
})

test("grounding retry returns one repair prompt, then falls back to a final warning", async () => {
  resetRetrieved("retry-session")
  const input = {
    sessionId: "retry-session",
    answer: "This claim cites an invented passage [bk_missing-s1-c1].",
    settings: { grounding: { verify: "retry" } },
  }
  const retry = await verifyAnswer(input)
  expect(retry.verified).toBe(false)
  expect(retry.retryPrompt).toContain("bk_missing-s1-c1")
  expect(retry.note).toBeUndefined()

  const final = await verifyAnswer({ ...input, allowRetry: false })
  expect(final.retryPrompt).toBeUndefined()
  expect(final.note).toContain("could not be verified")
})
