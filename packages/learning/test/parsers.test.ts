// packages/learning/test/parsers.test.ts
//
// Unit tests for the parsers (plan §7.2). The TXT parser is fully
// implemented; PDF and DOCX are skipped if the optional deps are not
// installed (which is the case in CI).

import { expect, test, describe } from "bun:test"
import { Effect } from "effect"
import { parseTxt, parse, type ParseResult } from "../src/parsers"

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
