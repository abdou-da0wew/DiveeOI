import { expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
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
