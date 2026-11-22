// packages/learning/test/sqlite-vec.test.ts
//
// Error-hardening tests (sprint 2, T5) for the optional sqlite-vec backend.
// The vec0 extension is never present in CI, which is exactly the environment
// these tests target: availability probing and misconfigured extension paths
// must degrade to `false` / typed SqliteVecError WITHOUT vanishing silently —
// every degraded path records a `sqlite-vec` diagnostic first.

import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Database as BunDatabase } from "bun:sqlite"
import { createVecTable, isAvailable, type SqliteVecConfig } from "../src/sqlite-vec"
import type { BooksDbHandle } from "../src/store"
import { flushDiagnostics } from "../src/diagnostics"

// Same promise-wrapped handle shape the runtime uses (see store/index.ts BooksDbHandle).
// The runtime handle IS the bun:sqlite Database, which exposes loadExtension; the wrapper
// mirrors that so the extension-path code path is reachable in tests.
type TestHandle = BooksDbHandle & { loadExtension(path: string, entryPoint?: string): unknown }
const wrapDb = (db: BunDatabase): TestHandle => ({
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
  loadExtension: (path: string, entryPoint?: string) =>
    (db as unknown as { loadExtension(p: string, e?: string): unknown }).loadExtension(path, entryPoint),
})

describe("sqlite-vec error hardening", () => {
  let tempDir = ""
  let db: BunDatabase
  const envBackup = new Map<string, string | undefined>()
  const diagFile = () => join(tempDir, "sqlite-vec-debug.jsonl")
  /** The JSONL file is only created on the first written record. */
  const readDiag = () => {
    try {
      return readFileSync(diagFile(), "utf8")
    } catch {
      return ""
    }
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tl-sqlite-vec-hardening-"))
    db = new BunDatabase(":memory:")
    for (const key of [
      "DIVEEOI_TL_DEBUG",
      "DIVEEOI_TL_DEBUG_LEVEL",
      "DIVEEOI_TL_DEBUG_FILE",
      "DIVEEOI_TL_DEBUG_CONTENT",
      "DIVEEOI_TL_DEBUG_CONSOLE",
    ]) {
      envBackup.set(key, process.env[key])
    }
    process.env.DIVEEOI_TL_DEBUG = "sqlite-vec"
    process.env.DIVEEOI_TL_DEBUG_FILE = diagFile()
    delete process.env.DIVEEOI_TL_DEBUG_LEVEL
    process.env.DIVEEOI_TL_DEBUG_CONTENT = "1"
    delete process.env.DIVEEOI_TL_DEBUG_CONSOLE
  })

  afterEach(async () => {
    db.close()
    await flushDiagnostics()
    for (const [key, value] of envBackup) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("isAvailable returns false without the extension and stays quiet on the normal path", async () => {
    const result = await Effect.runPromise(isAvailable(wrapDb(db)))
    expect(result).toBe(false)
    await flushDiagnostics()
    // Absence of the optional extension is the NORMAL path — no diagnostics expected.
    const text = readDiag()
    expect(text).not.toContain("availability.probeFailed")
    expect(text).not.toContain("extension.loadFailed")
  })

  test("a configured extension path that fails to load is recorded as a diagnostic", async () => {
    const config: SqliteVecConfig = {
      dimensions: 8,
      extensionPath: join(tempDir, "does-not-exist.so"),
    }
    const result = await Effect.runPromise(isAvailable(wrapDb(db), config))
    expect(result).toBe(false)
    await flushDiagnostics()
    const text = readDiag()
    expect(text).toContain("extension.loadFailed")
    expect(text).toContain("does-not-exist.so")
  })

  test("createVecTable surfaces a typed SqliteVecError when the extension is unavailable", async () => {
    try {
      await Effect.runPromise(createVecTable(wrapDb(db), { dimensions: 8 }))
      expect.unreachable()
    } catch (err) {
      const e = err as { _tag?: string; message?: string }
      expect(e._tag).toBe("TargetedLearning.SqliteVecError")
      expect(e.message).toContain("sqlite-vec extension is not available")
    }
  })
})
