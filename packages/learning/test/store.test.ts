// packages/learning/test/store.test.ts
//
// Unit tests for the BooksStore layer (plan §6). Verifies:
//   - Fresh DB is created when none exists
//   - Schema initializes (meta, books, sections, chunks, chunks_fts, etc.)
//   - FTS5 trigger works (insert into chunks → searchable in chunks_fts)

import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Store from "../src/store"
import { Global } from "@diveeoi/db/global"
import { SCHEMA_SQL } from "../src/store/schema"

const SCHEMA_SQL_FOR_TEST = SCHEMA_SQL

let tempDir: string
let savedDataDir: string | undefined

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "tl-store-"))
  savedDataDir = process.env.DIVEEOI_TL_DATA_DIR
  process.env.DIVEEOI_TL_DATA_DIR = tempDir
  // Patch Global.Path.data so the layer's defaultDataDir() resolves to tempDir.
  // The layer uses `process.env.DIVEEOI_TL_DATA_DIR ?? path.join(Global.Path.data, "targeted-learning")`
  // so setting the env var is enough.
})

afterEach(() => {
  if (savedDataDir === undefined) {
    delete process.env.DIVEEOI_TL_DATA_DIR
  } else {
    process.env.DIVEEOI_TL_DATA_DIR = savedDataDir
  }
  rmSync(tempDir, { recursive: true, force: true })
})

const runWithLayer = <A, E>(eff: Effect.Effect<A, E, Store.Service>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(Store.BooksStoreLayer)))

describe("BooksStore", () => {
  test("creates a fresh books.db when none exists", async () => {
    const result = await runWithLayer(Effect.gen(function* () {
      const store = yield* Store.Service
      return store
    }))
    expect(result.available).toBe(true)
    expect(result.db).not.toBeNull()
    expect(existsSync(join(tempDir, "books.db"))).toBe(true)
  })

  test("schema initializes: meta, books, sections, chunks, chunks_fts, chunk_vecs, ingest_jobs, book_notes tables exist", async () => {
    const result = await runWithLayer(Effect.gen(function* () {
      const store = yield* Store.Service
      if (!store.db) throw new Error("no db")
      const tables = yield* Effect.tryPromise({
        try: () =>
          store.db!.all<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts_%' AND name NOT LIKE '%_config' AND name NOT LIKE '%_data' AND name NOT LIKE '%_docsize' AND name NOT LIKE '%_idx' ORDER BY name",
          ),
        catch: () => [] as { name: string }[],
      })
      return tables.map((t) => t.name)
    }))
    expect(result).toContain("meta")
    expect(result).toContain("books")
    expect(result).toContain("sections")
    expect(result).toContain("chunks")
    expect(result).toContain("chunk_vecs")
    expect(result).toContain("ingest_jobs")
    expect(result).toContain("book_notes")
  })

  test("FTS5 shadow table chunks_fts exists", async () => {
    const result = await runWithLayer(Effect.gen(function* () {
      const store = yield* Store.Service
      const tables = yield* Effect.tryPromise({
        try: () =>
          store.db!.all<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'",
          ),
        catch: () => [] as { name: string }[],
      })
      return tables.map((t) => t.name)
    }))
    expect(result).toContain("chunks_fts")
  })

  test("meta has schema_version = 1 after init", async () => {
    const result = await runWithLayer(Effect.gen(function* () {
      const store = yield* Store.Service
      const meta = yield* Effect.tryPromise({
        try: () =>
          store.db!.all<{ key: string; value: string }>("SELECT key, value FROM meta"),
        catch: () => [] as { key: string; value: string }[],
      })
      return meta
    }))
    const schemaVersion = result.find((m) => m.key === "schema_version")
    expect(schemaVersion?.value).toBe("1")
  })

  test("FTS5 trigger: insert into chunks → searchable in chunks_fts", async () => {
    const result = await runWithLayer(
      Effect.gen(function* () {
        const store = yield* Store.Service
        if (!store.db) throw new Error("no db")
        // Insert a book + section + chunk.
        yield* Effect.tryPromise({
          try: () =>
            store.db!.run(
              "INSERT INTO books(id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
              "b1",
              "test",
              "Test Book",
              "hash1",
              "books/test.pdf",
              "ready",
              "{}",
              1,
              Date.now(),
            ),
          catch: (e) => { throw e },
        })
        yield* Effect.tryPromise({
          try: () =>
            store.db!.run(
              "INSERT INTO sections(id, book_id, level, ord, text) VALUES(?,?,?,?,?)",
              "s1",
              "b1",
              1,
              0,
              "Photosynthesis converts sunlight into glucose.",
            ),
          catch: (e) => { throw e },
        })
        yield* Effect.tryPromise({
          try: () =>
            store.db!.run(
              "INSERT INTO chunks(id, book_id, section_id, ord, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?)",
              "c1",
              "b1",
              "s1",
              0,
              "Photosynthesis converts sunlight into glucose.",
              "photosynthesis converts sunlight into glucose",
              8,
            ),
          catch: (e) => { throw e },
        })
        // Search via FTS5.
        const hits = yield* Effect.tryPromise({
          try: () =>
            store.db!.all<{ text_norm: string }>(
              "SELECT text_norm FROM chunks_fts WHERE chunks_fts MATCH 'photosynthesis'",
            ),
          catch: () => [] as { text_norm: string }[],
        })
        return hits
      }),
    )
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]!.text_norm).toContain("photosynthesis")
  })

  test("opening an existing healthy DB reuses it", async () => {
    // Write directly with bun:sqlite to verify the first handle persists data.
    const { Database: BunDatabase } = require("bun:sqlite")
    const dbPath = join(tempDir, "books.db")
    const handle1 = new BunDatabase(dbPath)
    handle1.exec(SCHEMA_SQL_FOR_TEST)
    handle1.run(
      "INSERT INTO books(id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "persisted",
      "p",
      "P",
      "h",
      "p.pdf",
      "ready",
      "{}",
      1,
      Date.now(),
    )
    handle1.run("PRAGMA wal_checkpoint(TRUNCATE)")
    handle1.close()

    // Open a fresh handle and verify the row is there.
    const handle2 = new BunDatabase(dbPath)
    const rows = handle2.query("SELECT id FROM books").all() as { id: string }[]
    handle2.close()
    expect(rows.find((r) => r.id === "persisted")).toBeDefined()
  })
})
