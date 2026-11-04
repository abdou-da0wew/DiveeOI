// packages/learning/test/native-engine.test.ts
//
// The native engine client is best-effort by design: these tests drive it with a fake
// `divee-retrieval --serve` child (no Rust build required) and prove that every failure mode
// degrades to `null` instead of breaking a chat turn, and that `retrieve()` really prefers it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import {
  NATIVE_BIN_ENV,
  booksDbPath,
  locateNativeEngine,
  nativeEngineStatus,
  queryNativeEngine,
  shutdownNativeEngine,
} from "../src/retrieve/native-engine"
import { retrieve, type RetrievalOptions } from "../src/retrieve/hybrid"
import type { BooksDbHandle } from "../src/store"

const FAKE_ENGINE = (execPath: string) => `#!${execPath}
const decoder = new TextDecoder()
let buffer = ""
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true })
  let index
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    const request = JSON.parse(line)
    if (request.query === "hang") continue
    if (request.query === "fail") {
      console.log(JSON.stringify({ id: request.id, error: "engine says no" }))
      continue
    }
    if (request.query === "silence") {
      console.log("not json at all")
      continue
    }
    console.log(JSON.stringify({
      id: request.id,
      hits: [{
        chunk_id: "chunk-" + request.query,
        book_id: (request.books && request.books[0]) || "book",
        section_id: "sec",
        page: 7,
        text: "passage for " + request.query,
        bm25_score: 1.5,
        dense_score: 0.81,
        fused_score: 0.032,
      }],
      best_dense_score: 0.81,
      best_fused_score: 0.032,
      elapsed_ms: 0.4,
    }))
  }
}
`

let dir: string
let binary: string

beforeEach(() => {
  shutdownNativeEngine()
  dir = mkdtempSync(join(tmpdir(), "tl-native-engine-"))
  binary = join(dir, "divee-retrieval")
  writeFileSync(binary, FAKE_ENGINE(process.execPath), "utf8")
  chmodSync(binary, 0o755)
})

afterEach(() => {
  shutdownNativeEngine()
  delete process.env[NATIVE_BIN_ENV]
  delete process.env.DIVEEOI_TL_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

const query = (text: string, overrides: Partial<Parameters<typeof queryNativeEngine>[0]> = {}) =>
  queryNativeEngine(
    {
      query: text,
      books: ["bio"],
      vector: new Float32Array([0.9, 0.1, 0, 0]),
      limit: 5,
      bm25Limit: 10,
      denseLimit: 10,
      rrfK: 60,
      bm25Weight: 1,
      denseWeight: 1,
      ...overrides,
    },
    { binary, dbPath: join(dir, "books.db") },
  )

describe("native engine discovery", () => {
  test("the binary override wins and a missing binary resolves to null", () => {
    expect(locateNativeEngine(binary)).toBe(binary)
    expect(locateNativeEngine(join(dir, "missing"))).toBeNull()
  })

  test("books.db follows DIVEEOI_TL_DATA_DIR, then the live runtime", () => {
    expect(booksDbPath()).toBeNull()
    process.env.DIVEEOI_TL_DATA_DIR = dir
    expect(booksDbPath()).toBe(join(dir, "books.db"))
  })

  test("engine: typescript never spawns a process", async () => {
    expect(await queryNativeEngine({ query: "x", books: [], vector: null, limit: 1, bm25Limit: 1, denseLimit: 1, rrfK: 60, bm25Weight: 1, denseWeight: 1 }, { engine: "typescript", binary })).toBeNull()
    expect(nativeEngineStatus().running).toBe(false)
  })

  test("a missing binary falls back to null", async () => {
    expect(await queryNativeEngine({ query: "x", books: [], vector: null, limit: 1, bm25Limit: 1, denseLimit: 1, rrfK: 60, bm25Weight: 1, denseWeight: 1 }, { binary: join(dir, "nope") })).toBeNull()
  })
})

describe("native engine queries", () => {
  test("hits, scores and page come back mapped", async () => {
    const result = await query("heart")
    expect(result).not.toBeNull()
    expect(result!.hits).toHaveLength(1)
    expect(result!.hits[0]!.chunk_id).toBe("chunk-heart")
    expect(result!.hits[0]!.book_id).toBe("bio")
    expect(result!.hits[0]!.page).toBe(7)
    expect(result!.bestDenseScore).toBeCloseTo(0.81, 5)
    expect(result!.bestFusedScore).toBeCloseTo(0.032, 5)
  })

  test("concurrent queries stay correlated by id", async () => {
    const [first, second] = await Promise.all([query("one"), query("two")])
    expect(first!.hits[0]!.chunk_id).toBe("chunk-one")
    expect(second!.hits[0]!.chunk_id).toBe("chunk-two")
  })

  test("an engine-reported error degrades to null", async () => {
    expect(await query("fail")).toBeNull()
    expect(nativeEngineStatus().lastFailure).toContain("engine says no")
  })

  test("a malformed response line is skipped, then the timeout degrades to null", async () => {
    const result = await queryNativeEngine(
      { query: "silence", books: [], vector: null, limit: 1, bm25Limit: 1, denseLimit: 1, rrfK: 60, bm25Weight: 1, denseWeight: 1 },
      { binary, dbPath: join(dir, "books.db"), timeoutMs: 120 },
    )
    expect(result).toBeNull()
  })

  test("a wedged engine is killed and hidden behind a cooldown", async () => {
    const options = { binary, dbPath: join(dir, "books.db"), timeoutMs: 100 }
    const request = { query: "hang", books: [], vector: null, limit: 1, bm25Limit: 1, denseLimit: 1, rrfK: 60, bm25Weight: 1, denseWeight: 1 }
    expect(await queryNativeEngine(request, options)).toBeNull()
    // The cooldown means the next attempt does not even try to spawn.
    expect(await queryNativeEngine({ ...request, query: "fine" }, options)).toBeNull()
  })

  test("shutdown forgets the session so the next call starts fresh", async () => {
    expect(await query("before")).not.toBeNull()
    shutdownNativeEngine()
    expect(await query("after")).not.toBeNull()
  })
})

describe("hybrid retrieval through the engine", () => {
  const calls: string[] = []
  const recordingDb = (): BooksDbHandle => ({
    run: () => Promise.resolve(),
    all: <T,>(sql: string) => {
      calls.push(sql)
      return Promise.resolve([] as T[])
    },
    get: <T,>() => Promise.resolve(undefined as T | undefined),
    _execRaw: () => Promise.resolve(),
  })

  const options = (overrides: Partial<RetrievalOptions> = {}): RetrievalOptions => ({
    bookIds: ["bio"],
    query: "photosynthesis",
    bm25TopK: 10,
    denseTopK: 10,
    rrfK: 60,
    weightBm25: 1,
    weightDense: 1,
    autoWeightByLanguage: true,
    finalTopK: 5,
    parentExpansion: false,
    parentContextMaxTokens: 1000,
    queryRewrite: "off",
    rewriteTurns: 0,
    recentUserTurns: [],
    gate: {
      enabled: true,
      minDenseScore: 0.5,
      minFusedScore: 0.1,
      allowSmallTalk: true,
      language: "en",
      libraryAvailable: true,
      refusalMessages: { en: "not covered", ar: "غير موجود" },
    },
    ...overrides,
  })

  test("engine: typescript keeps the TypeScript scan (the fallback path)", async () => {
    calls.length = 0
    const result = await Effect.runPromise(
      retrieve(recordingDb(), options({ engine: "typescript" }), new Float32Array([1, 0])),
    )
    expect(calls.some((sql) => sql.includes("chunks_fts"))).toBe(true)
    expect(calls.some((sql) => sql.includes("chunk_vecs"))).toBe(true)
    expect(result.gateDecision).toBe("refused")
  })

  test("with the engine available, hits come from it and SQL is not scanned", async () => {
    shutdownNativeEngine()
    process.env[NATIVE_BIN_ENV] = binary
    calls.length = 0
    locateNativeEngine()
    const result = await Effect.runPromise(
      retrieve(recordingDb(), options({ engine: "auto", nativeDbPath: join(dir, "books.db") }), new Float32Array([1, 0])),
    )
    delete process.env[NATIVE_BIN_ENV]
    expect(result.gateDecision).toBe("pass")
    expect(result.candidates.map((candidate) => candidate.chunkId)).toEqual(["chunk-photosynthesis"])
    expect(calls.some((sql) => sql.includes("chunks_fts"))).toBe(false)
    expect(calls.some((sql) => sql.includes("chunk_vecs"))).toBe(false)
  })
})
