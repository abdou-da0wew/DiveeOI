// OCR of a scanned PDF (no text layer): English page + Arabic page.
// Needs the optional OCR packages and local language data; set TL_TEST_TESSDATA to a folder holding
// ara.traineddata and eng.traineddata (the pinned tessdata_fast files) to run it.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Store from "../src/store"
import { setRuntime } from "../src/runtime"
import { PINNED_MANIFEST } from "../src/manifest/pinned"
import { startIngest } from "../src/ingest/run"
import { parseLanguages } from "../src/ocr/pack"

const tessdata = process.env.TL_TEST_TESSDATA
const run = tessdata && existsSync(join(tessdata, "ara.traineddata")) ? test : test.skip

test("OCR language spec is validated", () => {
  expect(parseLanguages("ara+eng")).toEqual(["ara", "eng"])
  expect(() => parseLanguages("xx")).toThrow("not supported")
})

let dir: string
let store: any
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tl-ocr-"))
  process.env.DIVEEOI_TL_DATA_DIR = dir
  store = await Effect.runPromise(Effect.gen(function* () { return yield* Store.Service }).pipe(Effect.provide(Store.BooksStoreLayer)))
  setRuntime({ dataDir: dir, modelDir: join(dir, "models"), booksStore: store, manifest: PINNED_MANIFEST })
  if (tessdata) {
    mkdirSync(join(dir, "ocr"), { recursive: true })
    for (const l of ["ara", "eng"]) if (existsSync(join(tessdata, `${l}.traineddata`))) copyFileSync(join(tessdata, `${l}.traineddata`), join(dir, "ocr", `${l}.traineddata`))
  }
})
afterAll(() => {
  delete process.env.DIVEEOI_TL_DATA_DIR
  setRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

const pdf = () => new Uint8Array(readFileSync(new URL("./fixtures/scanned.pdf", import.meta.url)))
const wait = async (id: string) => {
  for (let i = 0; i < 600; i++) {
    const row = await store.db.get("SELECT status, error FROM books WHERE id = ?", id)
    if (row.status === "ready" || row.status === "failed") return row
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("timeout")
}

test("scanned PDF with OCR off fails with an actionable message", async () => {
  const r = await startIngest({ db: store.db, dataDir: dir, filename: "scan-off.pdf", bytes: pdf(), embedFn: async (t) => t.map(() => new Float32Array(1024)), ensureFn: async () => undefined })
  const row = await wait(r.bookId)
  expect(row.status).toBe("failed")
  expect(row.error).toContain("OCR")
})

run("scanned PDF with OCR on is read in English and Arabic", async () => {
  const r = await startIngest({
    db: store.db, dataDir: dir, filename: "scan-on.pdf", bytes: pdf(), title: "Scanned",
    settings: { ocr: { enabled: true, languages: "ara+eng", dpi: 200 } },
    embedFn: async (t) => t.map(() => new Float32Array(1024).fill(0.01)), ensureFn: async () => undefined,
  })
  const row = await wait(r.bookId)
  expect(row.error ?? "").toBe("")
  expect(row.status).toBe("ready")
  const text = (await store.db.all("SELECT text FROM chunks WHERE book_id = ?", r.bookId)).map((c: any) => c.text).join(" ").toLowerCase()
  expect(text).toContain("photosynthesis")
  expect(text).toContain("chemical energy")
  expect(text).toContain("الضوئي")
}, 120_000)
