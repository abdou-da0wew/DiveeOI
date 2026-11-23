import { expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Database as BunDatabase } from "bun:sqlite"
import * as Store from "../src/store"

const open = () => Effect.runPromise(Effect.gen(function* () { return yield* Store.Service }).pipe(Effect.provide(Store.BooksStoreLayer)))

test("a healthy books.db survives a restart (is not flagged corrupt and moved aside)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tl-reopen-"))
  process.env.DIVEEOI_TL_DATA_DIR = dir
  try {
    const first: any = await open()
    expect(first.available).toBe(true)
    await first.db.run("INSERT INTO books (id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at) VALUES ('b1','s','T','h','','ready','x','1',1)")
    const second: any = await open() // simulates a server restart
    expect(second.available).toBe(true)
    expect(second.unavailabilityReason ?? null).toBeNull()
    expect((await second.db.get("SELECT count(*) AS n FROM books")).n).toBe(1)
    expect(readdirSync(dir).some((f) => f.includes(".corrupt-"))).toBe(false)
  } finally {
    delete process.env.DIVEEOI_TL_DATA_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a books.db without a meta table still opens available (pre-versioning DB, error-hardened fallback)", async () => {
  // Pins the store hardening (2026-11-23): the schema_version SELECT failure is a typed
  // Error now, but the orElseSucceed fallback semantics are unchanged — a DB created
  // before versioning exists must keep opening instead of degrading.
  const dir = mkdtempSync(join(tmpdir(), "tl-reopen-nometa-"))
  process.env.DIVEEOI_TL_DATA_DIR = dir
  try {
    const legacy = new BunDatabase(join(dir, "books.db"))
    legacy.exec("CREATE TABLE books (id TEXT PRIMARY KEY)")
    legacy.close()
    const store: any = await open()
    expect(store.available).toBe(true)
    expect(store.unavailabilityReason ?? null).toBeNull()
  } finally {
    delete process.env.DIVEEOI_TL_DATA_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a books.db with an older schema_version is upgraded in meta on reopen", async () => {
  // Pins the upgrade write (store/index.ts): dbVersion < current → INSERT OR REPLACE,
  // and the write failure now surfaces a descriptive error instead of `undefined`.
  const dir = mkdtempSync(join(tmpdir(), "tl-reopen-upgrade-"))
  process.env.DIVEEOI_TL_DATA_DIR = dir
  try {
    const legacy = new BunDatabase(join(dir, "books.db"))
    legacy.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    legacy.run("INSERT INTO meta (key, value) VALUES ('schema_version', '0')")
    legacy.close()
    const store: any = await open()
    expect(store.available).toBe(true)
    const upgraded = await store.db.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    )
    // Compare against what a fresh store writes, so the pin survives a SCHEMA_VERSION bump.
    const freshDir = mkdtempSync(join(tmpdir(), "tl-reopen-fresh-"))
    try {
      process.env.DIVEEOI_TL_DATA_DIR = freshDir
      const fresh: any = await open()
      const expected = await fresh.db.get<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'schema_version'",
      )
      expect(upgraded?.value).toBe(expected?.value)
      await fresh.db.run("DELETE FROM books") // no-op; keeps fresh handle well-typed
    } finally {
      process.env.DIVEEOI_TL_DATA_DIR = dir
      rmSync(freshDir, { recursive: true, force: true })
    }
  } finally {
    delete process.env.DIVEEOI_TL_DATA_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})
