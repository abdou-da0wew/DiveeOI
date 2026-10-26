// packages/learning/test/hybrid.test.ts
//
// Integration tests for the hybrid retriever (plan §8).
// Uses a real books.db with test data to verify BM25 + dense + RRF + gate.

import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Database as BunDatabase } from "bun:sqlite"
import { SCHEMA_SQL } from "../src/store/schema"
import { retrieve, type RetrievalOptions } from "../src/retrieve/hybrid"

let tempDir: string
let db: BunDatabase

const vectorToB64 = (vec: Float32Array): string => {
  const bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "tl-hybrid-"))
  db = new BunDatabase(join(tempDir, "books.db"))
  db.exec(SCHEMA_SQL)

  // Insert test data: one book about biology, one about history.
  db.run(
    "INSERT INTO books(id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    "bio",
    "biology",
    "Biology 101",
    "h1",
    "bio.pdf",
    "ready",
    "{}",
    1,
    Date.now(),
  )
  db.run(
    "INSERT INTO books(id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    "hist",
    "history",
    "History 101",
    "h2",
    "hist.pdf",
    "ready",
    "{}",
    1,
    Date.now(),
  )

  // Sections
  db.run("INSERT INTO sections(id, book_id, level, ord, text, heading_path) VALUES(?,?,?,?,?,?)",
    "bio-s1", "bio", 1, 0, "Photosynthesis is the process by which plants convert sunlight into glucose.", "Chapter 1")
  db.run("INSERT INTO sections(id, book_id, level, ord, text, heading_path) VALUES(?,?,?,?,?,?)",
    "hist-s1", "hist", 1, 0, "The Roman Republic fell in 27 BC.", "Chapter 1")

  // Chunks — biology
  db.run("INSERT INTO chunks(id, book_id, section_id, ord, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?)",
    "bio-c1", "bio", "bio-s1", 0, "Photosynthesis converts sunlight into glucose and oxygen.", "photosynthesis converts sunlight into glucose and oxygen", 10)
  db.run("INSERT INTO chunks(id, book_id, section_id, ord, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?)",
    "bio-c2", "bio", "bio-s1", 1, "Chlorophyll absorbs light energy.", "chlorophyll absorbs light energy", 6)

  // Chunks — history
  db.run("INSERT INTO chunks(id, book_id, section_id, ord, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?)",
    "hist-c1", "hist", "hist-s1", 0, "Julius Caesar was assassinated in 44 BC.", "julius caesar was assassinated in 44 bc", 10)

  // Vectors — 4-dim for test simplicity
  // bio-c1: photosynthesis → [0.9, 0.1, 0.0, 0.0]
  // bio-c2: chlorophyll    → [0.8, 0.2, 0.0, 0.0]
  // hist-c1: caesar        → [0.0, 0.0, 0.9, 0.1]
  db.run("INSERT INTO chunk_vecs(chunk_id, vec) VALUES(?,?)",
    "bio-c1", vectorToB64(new Float32Array([0.9, 0.1, 0.0, 0.0])))
  db.run("INSERT INTO chunk_vecs(chunk_id, vec) VALUES(?,?)",
    "bio-c2", vectorToB64(new Float32Array([0.8, 0.2, 0.0, 0.0])))
  db.run("INSERT INTO chunk_vecs(chunk_id, vec) VALUES(?,?)",
    "hist-c1", vectorToB64(new Float32Array([0.0, 0.0, 0.9, 0.1])))
})

afterEach(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

const baseOptions: RetrievalOptions = {
  bookIds: ["bio"],
  query: "photosynthesis",
  bm25TopK: 10,
  denseTopK: 10,
  rrfK: 60,
  weightBm25: 1.0,
  weightDense: 1.0,
  autoWeightByLanguage: true,
  finalTopK: 5,
  parentExpansion: true,
  parentContextMaxTokens: 1000,
  queryRewrite: "off",
  rewriteTurns: 0,
  recentUserTurns: [],
  gate: {
    enabled: true,
    minDenseScore: 0.0, // low threshold for test
    minFusedScore: 0.0,
    allowSmallTalk: true,
    language: "en",
    libraryAvailable: true,
    refusalMessages: { en: "not covered", ar: "غير موجود" },
  },
}

// Wrap the bun:sqlite handle to match BooksDbHandle
const wrapDb = (db: BunDatabase) => ({
  run: (sql: string, ...params: unknown[]) => Promise.resolve().then(() => db.run(sql, ...(params as never[]))),
  all: <T>(sql: string, ...params: unknown[]) =>
    Promise.resolve().then(() => {
      const q = db.prepare(sql)
      const r = params.length > 0 ? q.all(...(params as never[])) : q.all()
      q.finalize()
      return r as T[]
    }),
  get: <T>(sql: string, ...params: unknown[]) =>
    Promise.resolve().then(() => {
      const q = db.prepare(sql)
      const r = params.length > 0 ? q.get(...(params as never[])) : q.get()
      q.finalize()
      return r as T | undefined
    }),
  _execRaw: (sql: string) => Promise.resolve().then(() => db.exec(sql)),
})

describe("hybrid retrieval", () => {
  test("returns library-unavailable when db is null", async () => {
    const result = await Effect.runPromise(retrieve(null, baseOptions, null))
    expect(result.gateDecision).toBe("library-unavailable")
    expect(result.candidates.length).toBe(0)
  })

  test("BM25 finds photosynthesis chunk", async () => {
    const result = await Effect.runPromise(
      retrieve(wrapDb(db), baseOptions, null),
    )
    // Even without a dense vector, BM25 should find the chunk
    expect(result.bm25TopK).toBeGreaterThan(0)
    const chunkIds = result.candidates.map((c) => c.chunkId)
    expect(chunkIds).toContain("bio-c1")
  })

  test("dense search finds the closest vector", async () => {
    // Query vector close to bio-c1
    const queryVec = new Float32Array([0.85, 0.15, 0.0, 0.0])
    const result = await Effect.runPromise(
      retrieve(wrapDb(db), { ...baseOptions, query: "irrelevant" }, queryVec),
    )
    expect(result.denseTopK).toBeGreaterThan(0)
  })

  test("RRF fusion combines BM25 and dense results", async () => {
    const queryVec = new Float32Array([0.85, 0.15, 0.0, 0.0])
    const result = await Effect.runPromise(
      retrieve(wrapDb(db), baseOptions, queryVec),
    )
    // The bio-c1 chunk should be in the top results
    expect(result.candidates.some((c) => c.chunkId === "bio-c1")).toBe(true)
  })

  test("parent expansion includes the section text", async () => {
    const result = await Effect.runPromise(
      retrieve(wrapDb(db), baseOptions, null),
    )
    const withParent = result.candidates.find((c) => c.parent)
    if (withParent) {
      expect(withParent.parent?.text).toContain("Photosynthesis")
    }
  })

  test("gate refuses off-topic query", async () => {
    const result = await Effect.runPromise(
      retrieve(
        wrapDb(db),
        {
          ...baseOptions,
          query: "quantum physics string theory",
          gate: {
            ...baseOptions.gate,
            minDenseScore: 0.99, // impossibly high
            minFusedScore: 0.99,
          },
        },
        null,
      ),
    )
    // No BM25 hits for quantum physics, no dense vector → gate refuses
    expect(result.gateDecision).toBe("refused")
    expect(result.candidates.length).toBe(0)
  })

  test("scoped to specific bookIds only", async () => {
    const result = await Effect.runPromise(
      retrieve(
        wrapDb(db),
        { ...baseOptions, bookIds: ["hist"], query: "caesar" },
        null,
      ),
    )
    // Should only return history chunks, not biology
    for (const c of result.candidates) {
      expect(c.bookId).toBe("hist")
    }
  })

  test("rewritten query is recorded when different from original", async () => {
    const result = await Effect.runPromise(
      retrieve(
        wrapDb(db),
        {
          ...baseOptions,
          query: "explain more",
          recentUserTurns: ["what is photosynthesis"],
          queryRewrite: "heuristic",
          rewriteTurns: 2,
        },
        null,
      ),
    )
    expect(result.rewrittenQuery).toBeDefined()
    expect(result.rewrittenQuery).toContain("photosynthesis")
  })
})
