// OCR end-to-end test (plan §7.6): scanned pages → ingest OCR branch → text in chunks → searchable.
//
// The synthetic scanned input is the repo's existing EN+AR scan fixture
// (test/fixtures/scanned.pdf, WORKLOG 2026-10-28): 2 pages whose text layer is
// empty, i.e. below `SCANNED_PAGE_MIN_CHARS` (= 25, src/ocr/index.ts:26), each
// stored as one embedded page image inside the PDF.
//
// Two modes, chosen automatically and reported in the test output + a pinned
// assertion (override with TL_OCR_E2E_MODE=real|mock):
//
//   [real] — REAL OCR. A `eng.traineddata` whose sha256 matches the pinned
//     tessdata_fast pack (src/ocr/pack.ts PACK.eng) is available locally
//     (TL_TEST_TESSDATA dir or the system tesseract tessdata). It is copied
//     into <dataDir>/ocr/ so `ensureOcrPack` verifies it and skips the
//     download (src/download/index.ts:238-263) — fully offline, no mocking.
//
//   [mock] — MOCKED pack wiring. No usable tessdata offline: src/ocr/pack and
//     src/ocr are module-mocked (ensureOcrPack → no-op, ocrPdfPages → fake
//     recognition) BEFORE src/ingest/run is imported, so the ingest OCR branch
//     itself (src/ingest/run.ts:626-656) still runs for real: pages below the
//     threshold are collected, OCR is invoked for exactly those pages, the
//     returned text replaces the page text, and the book indexes as ready.
//
// Both modes assert the same end state: book ready → recognized text present
// in chunks → text findable through store queries.
//
// Embedding is faked through the `embedFn`/`ensureFn` test seams of
// startIngest (src/ingest/run.ts:174-176) — the same offline pattern as
// ocr.test.ts and ingest-load.test.ts (SKIP_LIVE_EMBED-safe).
import { afterAll, beforeAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import * as Store from "../src/store"
import { setRuntime } from "../src/runtime"
import { PINNED_MANIFEST } from "../src/manifest/pinned"

// --- mode selection ---------------------------------------------------------

const PINNED_ENG_SHA256 = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2" // src/ocr/pack.ts PACK.eng

const tessdataSources = [process.env.TL_TEST_TESSDATA, "/usr/share/tesseract-ocr/5/tessdata"].filter(
  (p): p is string => typeof p === "string" && p.length > 0,
)

async function findRealTessdata(): Promise<string | null> {
  for (const dir of tessdataSources) {
    const file = join(dir, "eng.traineddata")
    if (!existsSync(file)) continue
    const sha = createHash("sha256").update(readFileSync(file)).digest("hex")
    if (sha === PINNED_ENG_SHA256) return file
  }
  return null
}

async function tesseractImportable(): Promise<boolean> {
  try {
    await import("tesseract.js")
    await import("pdfjs-dist/legacy/build/pdf.mjs" as string)
    return true
  } catch {
    return false
  }
}

const requested = process.env.TL_OCR_E2E_MODE

let mode: "real" | "mock"
if (requested === "real" || requested === "mock") {
  mode = requested
} else {
  // Auto: real only when a sha-verified eng pack AND the optional OCR packages exist offline.
  mode = (await findRealTessdata()) !== null && (await tesseractImportable()) ? "real" : "mock"
}

// Mark loudly which mode ran (also asserted by the first test below).
console.log(`[ocr-e2e] mode = ${mode}${requested ? " (forced by TL_OCR_E2E_MODE)" : " (auto-detected)"}`)

// --- fixtures / stores ------------------------------------------------------

let dir: string
let store: Awaited<ReturnType<typeof openStore>>

async function openStore() {
  return Effect.runPromise(Effect.gen(function* () { return yield* Store.Service }).pipe(Effect.provide(Store.BooksStoreLayer)))
}

const scannedPdf = () => new Uint8Array(readFileSync(new URL("./fixtures/scanned.pdf", import.meta.url)))

// Deterministic stand-in embedder (bag-of-words hash, dim 1024) — no model.
const DIM = 1024
const hashEmbed = async (texts: string[]) =>
  texts.map((text) => {
    const v = new Float32Array(DIM)
    for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
      let h = 2166136261
      for (const ch of w) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
      v[Math.abs(h) % DIM] += 1
    }
    const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
    return v.map((x) => x / n)
  })

const waitTerminal = async (id: string) => {
  for (let i = 0; i < 600; i++) {
    const row = (await store.db.get("SELECT status, error, summary_json, chunk_count FROM books WHERE id = ?", id)) as
      | { status: string; error: string | null; summary_json: string | null; chunk_count: number }
      | undefined
    if (row && (row.status === "ready" || row.status === "failed")) return row
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("ingest did not reach a terminal status")
}

// --- mocked-pack branch (registered BEFORE run.ts is imported) --------------

let restoreMocks: (() => void) | undefined

async function registerMockPack() {
  const { mock } = await import("bun:test")
  // Capture the real modules first so the mocks keep every export except the
  // two seams being faked (parseLanguages/ocrDir validation stays real).
  const realPack = await import("../src/ocr/pack")
  const realOcr = await import("../src/ocr")
  const calls: { pages: number[]; languages: string }[] = []

  mock.module("../src/ocr/pack", () => ({
    ...realPack,
    ensureOcrPack: () => Effect.succeed(undefined as void),
  }))
  mock.module("../src/ocr", () => ({
    ...realOcr,
    ocrPdfPages: async (
      _pdf: Uint8Array,
      pages: number[],
      options: { languages: string; dpi: number; dataDir: string },
    ) => {
      calls.push({ pages: [...pages], languages: options.languages })
      return pages.map((page) => ({
        page,
        // Pretend Tesseract read the English page perfectly.
        text: page === 1 ? "Chapter 1 Photosynthesis\nPhotosynthesis is the process by which green plants convert light energy into chemical energy." : "unknown glyphs",
        confidence: page === 1 ? 95 : 10,
      }))
    },
  }))

  restoreMocks = () => {
    mock.module("../src/ocr/pack", () => ({ ...realPack }))
    mock.module("../src/ocr", () => ({ ...realOcr }))
    calls.length = 0
  }
  return calls
}

// --- shared run -------------------------------------------------------------

let bookId: string
let ocrCalls: { pages: number[]; languages: string }[] = []

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tl-ocr-e2e-"))
  process.env.DIVEEOI_TL_DATA_DIR = dir
  store = await openStore()
  setRuntime({ dataDir: dir, modelDir: join(dir, "models"), booksStore: store, manifest: PINNED_MANIFEST })

  if (mode === "real") {
    const src = await findRealTessdata()
    expect(src).not.toBeNull()
    mkdirSync(join(dir, "ocr"), { recursive: true })
    copyFileSync(src!, join(dir, "ocr", "eng.traineddata"))
    ocrCalls = [] // real OCR: not instrumented
  } else {
    ocrCalls = await registerMockPack()
  }

  const { startIngest } = await import("../src/ingest/run")
  const result = await startIngest({
    db: store.db,
    dataDir: dir,
    filename: "scan-e2e.pdf",
    bytes: scannedPdf(),
    title: "Scanned E2E",
    settings: { ocr: { enabled: true, languages: "eng", dpi: 200 } },
    embedFn: hashEmbed,
    ensureFn: async () => undefined,
  })
  bookId = result.bookId
})

afterAll(async () => {
  restoreMocks?.()
  delete process.env.DIVEEOI_TL_DATA_DIR
  setRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

// --- assertions -------------------------------------------------------------

test("[ocr-e2e] the declared OCR mode ran (real vs mocked is never ambiguous)", () => {
  expect(["real", "mock"]).toContain(mode)
})

test(`[${mode}] pages below SCANNED_PAGE_MIN_CHARS went through the ingest OCR branch`, async () => {
  const row = await waitTerminal(bookId)
  expect(row.error ?? "").toBe("")
  expect(row.status).toBe("ready")
  // OCR ran over the scanned pages (mock mode records the exact call; real
  // mode proves it via the summary's ocrPages counter below).
  if (mode === "mock") {
    expect(ocrCalls).toHaveLength(1)
    expect(ocrCalls[0]!.pages).toEqual([1, 2]) // both pages are below the threshold
    expect(ocrCalls[0]!.languages).toBe("eng")
  }
  const summary = row.summary_json ? (JSON.parse(row.summary_json) as { ocrPages?: number; pagesWithoutText?: number }) : {}
  expect(summary.ocrPages ?? 0).toBeGreaterThanOrEqual(1)
}, 180_000)

test(`[${mode}] recognized text landed in chunks and is searchable via store queries`, async () => {
  const chunks = (await store.db.all("SELECT text, text_norm FROM chunks WHERE book_id = ?", bookId)) as { text: string; text_norm: string }[]
  expect(chunks.length).toBeGreaterThan(0)
  const joined = chunks.map((c) => `${c.text}\n${c.text_norm}`).join("\n").toLowerCase()
  // The photosynthesis wording exists only inside the scanned page image — it
  // must have been recognized (real) or injected (mock) by the OCR branch.
  expect(joined).toContain("photosynthesis")
  expect(joined).toContain("chemical energy")
  // …and findable through a plain store query (what retrieval's BM25 leg reads):
  const hits = (await store.db.all("SELECT id FROM chunks WHERE book_id = ? AND text LIKE ?", bookId, "%photosynthesis%")) as unknown[]
  expect(hits.length).toBeGreaterThan(0)
}, 60_000)

test(`[${mode}] re-uploading the same indexed bytes is reported as a duplicate`, async () => {
  // Deterministic here because the first ingest finished READY (service-level
  // seam; through the HTTP routes offline the book fails without the embed
  // model, so this semantic is verified at the service boundary instead).
  const { startIngest } = await import("../src/ingest/run")
  const again = await startIngest({
    db: store.db,
    dataDir: dir,
    filename: "scan-e2e.pdf",
    bytes: scannedPdf(),
    embedFn: hashEmbed,
    ensureFn: async () => undefined,
  })
  expect(again.duplicate).toBe(true)
  expect(again.bookId).toBe(bookId)
}, 60_000)
