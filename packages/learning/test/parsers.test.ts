// packages/learning/test/parsers.test.ts
//
// Unit tests for the parsers (plan §7.2). The TXT parser is fully
// implemented; PDF and DOCX are skipped if the optional deps are not
// installed (which is the case in CI).

import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parseTxt, parse, parserLoaders, type ParseResult } from "../src/parsers"
import { flushDiagnostics } from "../src/diagnostics"

describe("TXT parser", () => {
  test("parses a plain text document", async () => {
    const text = "This is the first paragraph.\n\nThis is the second paragraph."
    const result = await Effect.runPromise(parseTxt(text))
    expect(result.pages.length).toBe(1)
    expect(result.metadata.pages).toBe(1)
    expect(result.textDensity).toBe(1.0)
  })

  test("detects English chapter heading", async () => {
    const text = "Chapter 1: Introduction\n\nThis is the intro.\n\nChapter 2: Next\n\nMore text."
    const result = await Effect.runPromise(parseTxt(text))
    expect(result.outline.length).toBeGreaterThanOrEqual(2)
    const titles = result.outline.map((o) => o.title)
    expect(titles.some((t) => t.includes("Chapter 1"))).toBe(true)
    expect(titles.some((t) => t.includes("Chapter 2"))).toBe(true)
  })

  test("detects Arabic chapter markers (الفصل)", async () => {
    const text = "الفصل الأول: المقدمة\n\nهذا النص.\n\nالفصل الثاني: التالي\n\nالمزيد."
    const result = await Effect.runPromise(parseTxt(text))
    expect(result.outline.length).toBeGreaterThanOrEqual(1)
    const titles = result.outline.map((o) => o.title)
    expect(titles.some((t) => t.includes("الفصل"))).toBe(true)
  })

  test("detects Arabic الباب marker", async () => {
    const text = "الباب الأول\n\nSome content.\n\nالباب الثاني\n\nMore content."
    const result = await Effect.runPromise(parseTxt(text))
    expect(result.outline.some((o) => o.title.includes("الباب"))).toBe(true)
  })

  test("detects ALL-CAPS headings of moderate length", async () => {
    const text = "INTRODUCTION\n\nThis is the intro.\n\nCONCLUSION\n\nThis is the end."
    const result = await Effect.runPromise(parseTxt(text))
    expect(result.outline.some((o) => o.title === "INTRODUCTION")).toBe(true)
    expect(result.outline.some((o) => o.title === "CONCLUSION")).toBe(true)
  })

  test("does NOT treat long all-caps text as a heading", async () => {
    const text =
      "THIS IS A REALLY LONG LINE THAT GOES ON AND ON FOR MORE THAN EIGHTY CHARACTERS SO IT SHOULD NOT BE TREATED AS A HEADING"
    const result = await Effect.runPromise(parseTxt(text))
    // The all-caps heuristic checks length < 80
    expect(result.outline.length).toBe(0)
  })

  test("dispatcher routes to parseTxt for 'txt' format", async () => {
    const text = "Hello world."
    const result = await Effect.runPromise(parse(new TextEncoder().encode(text), "txt"))
    expect(result.metadata.pages).toBe(1)
  })

  test("dispatcher returns ParseError for PDF without pdfjs-dist", async () => {
    try {
      await Effect.runPromise(parse(new Uint8Array([0]), "pdf"))
      // If pdfjs-dist IS installed, the parser returns a Phase 2 error which
      // is also a ParseError — both paths are acceptable.
    } catch (err: unknown) {
      const e = err as { format?: string; message?: string }
      expect(e.format).toBe("pdf")
    }
  })

  test("dispatcher returns ParseError for DOCX without mammoth", async () => {
    try {
      await Effect.runPromise(parse(new Uint8Array([0]), "docx"))
    } catch (err: unknown) {
      const e = err as { format?: string; message?: string }
      expect(e.format).toBe("docx")
    }
  })
})

describe("ParseResult shape", () => {
  test("has pages array, outline array, metadata struct", async () => {
    const result = await Effect.runPromise(parseTxt("hello"))
    expect(Array.isArray(result.pages)).toBe(true)
    expect(Array.isArray(result.outline)).toBe(true)
    expect(typeof result.metadata.pages).toBe("number")
    expect(typeof result.textDensity).toBe("number")
  })
})

// ---------------------------------------------------------------------------
// Error hardening (sprint 2, T5): the parser pipeline must never swallow a
// failure into a silent null. Core-content failures surface as typed
// ParseErrors carrying the real cause; genuinely optional data (outline,
// metadata, cleanup) keeps its fallback but records a `parsers` diagnostic
// first. These tests drive the failures through the same mechanisms the code
// uses: the Effect error channel (runPromise rejection) and the diagnostics
// JSONL log (flushDiagnostics + file read).
// ---------------------------------------------------------------------------

describe("parser error hardening", () => {
  let tempDir = ""
  const envBackup = new Map<string, string | undefined>()
  const loaderBackup = { pdfjs: parserLoaders.loadPdfjs, mammoth: parserLoaders.loadMammoth }
  const diagFile = () => join(tempDir, "parsers-debug.jsonl")

  const fakePdfjs = (doc: Record<string, unknown>): typeof import("pdfjs-dist") =>
    ({ getDocument: () => ({ promise: Promise.resolve(doc) }) }) as unknown as typeof import("pdfjs-dist")

  const pageWithText = {
    getTextContent: async () => ({
      items: [{ str: "hello", transform: [1, 0, 0, 1, 0, 10], width: 5, height: 1 }],
    }),
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tl-parser-hardening-"))
    for (const key of [
      "DIVEEOI_TL_DEBUG",
      "DIVEEOI_TL_DEBUG_LEVEL",
      "DIVEEOI_TL_DEBUG_FILE",
      "DIVEEOI_TL_DEBUG_CONTENT",
      "DIVEEOI_TL_DEBUG_CONSOLE",
    ]) {
      envBackup.set(key, process.env[key])
    }
    process.env.DIVEEOI_TL_DEBUG = "parsers"
    process.env.DIVEEOI_TL_DEBUG_FILE = diagFile()
    delete process.env.DIVEEOI_TL_DEBUG_LEVEL
    // Content logging on so assertions can check that the real cause reached the log.
    process.env.DIVEEOI_TL_DEBUG_CONTENT = "1"
    delete process.env.DIVEEOI_TL_DEBUG_CONSOLE
  })

  afterEach(async () => {
    await flushDiagnostics()
    for (const [key, value] of envBackup) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    parserLoaders.loadPdfjs = loaderBackup.pdfjs
    parserLoaders.loadMammoth = loaderBackup.mammoth
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("pdfjs-dist load failure surfaces a typed ParseError carrying the cause (not a null error)", async () => {
    parserLoaders.loadPdfjs = () => Promise.reject(new Error("simulated pdfjs load failure"))
    let caught: unknown
    try {
      await Effect.runPromise(parse(new Uint8Array([1]), "pdf"))
      expect.unreachable()
    } catch (err) {
      caught = err
    }
    const e = caught as { _tag?: string; format?: string; message?: string }
    expect(e._tag).toBe("TargetedLearning.ParseError")
    expect(e.format).toBe("pdf")
    expect(e.message).toContain("bun add pdfjs-dist")
    expect(e.message).toContain("simulated pdfjs load failure")
  })

  test("mammoth load failure surfaces a typed ParseError carrying the cause (not a null error)", async () => {
    parserLoaders.loadMammoth = () => Promise.reject(new Error("simulated mammoth load failure"))
    let caught: unknown
    try {
      await Effect.runPromise(parse(new Uint8Array([1]), "docx"))
      expect.unreachable()
    } catch (err) {
      caught = err
    }
    const e = caught as { _tag?: string; format?: string; message?: string }
    expect(e._tag).toBe("TargetedLearning.ParseError")
    expect(e.format).toBe("docx")
    expect(e.message).toContain("bun add mammoth")
    expect(e.message).toContain("simulated mammoth load failure")
  })

  test("PDF page load failure surfaces a typed ParseError with the page number", async () => {
    parserLoaders.loadPdfjs = async () =>
      fakePdfjs({
        numPages: 2,
        getPage: (n: number) => (n === 1 ? Promise.resolve(pageWithText) : Promise.reject(new Error("page 2 exploded"))),
        getOutline: async () => null,
        getMetadata: async () => ({ info: {} }),
        cleanup: async () => undefined,
        destroy: async () => undefined,
      })
    let caught: unknown
    try {
      await Effect.runPromise(parse(new Uint8Array([1]), "pdf"))
      expect.unreachable()
    } catch (err) {
      caught = err
    }
    const e = caught as { _tag?: string; format?: string; message?: string }
    expect(e._tag).toBe("TargetedLearning.ParseError")
    expect(e.format).toBe("pdf")
    expect(e.message).toContain("PDF page 2 failed to load")
    expect(e.message).toContain("page 2 exploded")
  })

  test("PDF text extraction failure surfaces a typed ParseError (a page is never silently emptied)", async () => {
    parserLoaders.loadPdfjs = async () =>
      fakePdfjs({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => {
            throw new Error("text extraction boom")
          },
        }),
        getOutline: async () => null,
        getMetadata: async () => ({ info: {} }),
        cleanup: async () => undefined,
        destroy: async () => undefined,
      })
    let caught: unknown
    try {
      await Effect.runPromise(parse(new Uint8Array([1]), "pdf"))
      expect.unreachable()
    } catch (err) {
      caught = err
    }
    const e = caught as { _tag?: string; format?: string; message?: string }
    expect(e.format).toBe("pdf")
    expect(e.message).toContain("PDF page 1 text extraction failed")
    expect(e.message).toContain("text extraction boom")
  })

  test("optional-data failures are recorded as diagnostics and never fail the parse", async () => {
    parserLoaders.loadPdfjs = async () =>
      fakePdfjs({
        numPages: 1,
        getPage: async () => pageWithText,
        getOutline: async () => [
          { title: "Chapter 1", dest: "c1-ref" },
          { title: "Chapter 2", dest: [{ fakeRef: true }] },
        ],
        getDestination: async () => {
          throw new Error("destination boom")
        },
        getPageIndex: async () => {
          throw new Error("page index boom")
        },
        getMetadata: async () => {
          throw new Error("metadata boom")
        },
        cleanup: async () => {
          throw new Error("cleanup boom")
        },
        destroy: async () => {
          throw new Error("destroy boom")
        },
      })

    // The parse SUCCEEDS: outline, metadata and cleanup are genuinely best-effort.
    const result = await Effect.runPromise(parse(new Uint8Array([1]), "pdf"))
    expect(result.pages[0]?.text).toContain("hello")
    expect(result.outline.map((o) => o.title)).toEqual(["Chapter 1", "Chapter 2"])
    expect(result.outline.every((o) => o.page === 1)).toBe(true)
    expect(result.metadata.title).toBeUndefined()
    expect(result.metadata.pages).toBe(1)

    // ...but every fallback was recorded, with the real cause, in the diagnostics log.
    await flushDiagnostics()
    const text = readFileSync(diagFile(), "utf8")
    for (const event of [
      "parse.outlineDestinationFailed",
      "parse.outlinePageIndexFailed",
      "parse.metadataFailed",
      "parse.cleanupFailed",
      "parse.destroyFailed",
    ]) {
      expect(text).toContain(event)
    }
    expect(text).toContain("destination boom")
    expect(text).toContain("metadata boom")
    expect(text).toContain("cleanup boom")
    expect(text).toContain("destroy boom")
  })

  test("DOCX text extraction failure surfaces a typed ParseError instead of an empty-text book", async () => {
    parserLoaders.loadMammoth = async () =>
      ({
        convertToHtml: async () => ({ value: "<h1>Title</h1><p>Body</p>", messages: [] }),
        extractRawText: async () => {
          throw new Error("raw text boom")
        },
      }) as unknown as typeof import("mammoth")
    let caught: unknown
    try {
      await Effect.runPromise(parse(new Uint8Array([1]), "docx"))
      expect.unreachable()
    } catch (err) {
      caught = err
    }
    const e = caught as { _tag?: string; format?: string; message?: string }
    expect(e.format).toBe("docx")
    expect(e.message).toContain("DOCX text extraction failed")
    expect(e.message).toContain("raw text boom")
  })
})
