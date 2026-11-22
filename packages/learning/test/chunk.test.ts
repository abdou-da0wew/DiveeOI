// packages/learning/test/chunk.test.ts
//
// Unit tests for the chunker (plan §7.5). Uses a synthetic ParseResult
// to verify parent/child splitting, sentence boundaries, and heading
// path prepending.

import { expect, test, describe } from "bun:test"
import { Effect } from "effect"
import { chunk, type ChunkOptions, setTokenizer } from "../src/chunk"
import { parseTxt } from "../src/parsers"
import type { ParseResult } from "../src/parsers"

const defaultOptions: ChunkOptions = {
  childTargetTokens: 30,
  childMaxTokens: 50,
  childOverlapTokens: 5,
  minChunkTokens: 5,
  parentMaxTokens: 200,
  prependHeadingPath: true,
  stripHeadersFooters: true,
}

// Stub tokenizer that estimates ~1 token per word.
setTokenizer({
  encode: (text: string) => ({
    length: text.trim().split(/\s+/).filter(Boolean).length,
  }),
})

const makeParseResult = (text: string, outline: { title: string; page: number; level: number }[] = []): ParseResult => ({
  pages: [{ page: 1, text }],
  outline: outline as never,
  language: undefined,
  textDensity: 1.0,
  metadata: { pages: 1 },
})

describe("chunker", () => {
  test("empty text produces no sections or chunks", async () => {
    const result = await Effect.runPromise(chunk(makeParseResult(""), "test-book", defaultOptions))
    // Even with empty text we get one section with empty content.
    expect(result.sections.length).toBe(1)
    expect(result.chunks.length).toBe(0)
  })

  test("short text produces one section with one or two children", async () => {
    const text = "This is a short sentence. Here is another one. And a third for good measure."
    const result = await Effect.runPromise(chunk(makeParseResult(text), "test-book", defaultOptions))
    expect(result.sections.length).toBe(1)
    expect(result.chunks.length).toBeGreaterThan(0)
    // Each chunk's text should be a real sentence
    for (const c of result.chunks) {
      expect(c.text.length).toBeGreaterThan(0)
    }
  })

  test("long text produces multiple children when target is exceeded", async () => {
    const sentences: string[] = []
    for (let i = 0; i < 30; i++) {
      sentences.push(`Sentence number ${i} is here with some content to make it longer.`)
    }
    const text = sentences.join(" ")
    const result = await Effect.runPromise(chunk(makeParseResult(text), "test-book", defaultOptions))
    expect(result.chunks.length).toBeGreaterThan(1)
  })

  test("child chunks respect max tokens", async () => {
    const sentences: string[] = []
    for (let i = 0; i < 50; i++) {
      sentences.push(`Sentence ${i} here.`)
    }
    const text = sentences.join(" ")
    const result = await Effect.runPromise(chunk(makeParseResult(text), "test-book", defaultOptions))
    for (const c of result.chunks) {
      // Allow some slack since the estimator is approximate
      expect(c.tokenCount).toBeLessThanOrEqual(defaultOptions.childMaxTokens + 10)
    }
  })

  test("heading path is prepended when prependHeadingPath is true", async () => {
    const text = "Some content about photosynthesis."
    const outline = [{ title: "Chapter 1: Biology", page: 1, level: 1 }]
    const result = await Effect.runPromise(chunk(makeParseResult(text, outline), "test-book", defaultOptions))
    expect(result.sections.length).toBeGreaterThan(0)
    const section = result.sections[0]!
    expect(section.headingPath).toContain("Chapter 1")
  })

  test("heading path is NOT prepended when prependHeadingPath is false", async () => {
    const text = "Some content about photosynthesis."
    const outline = [{ title: "Chapter 1: Biology", page: 1, level: 1 }]
    const result = await Effect.runPromise(
      chunk(makeParseResult(text, outline), "test-book", { ...defaultOptions, prependHeadingPath: false }),
    )
    const section = result.sections[0]!
    expect(section.headingPath).toBeUndefined()
  })

  test("child chunk IDs are unique within a section", async () => {
    const text = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five."
    const result = await Effect.runPromise(chunk(makeParseResult(text), "test-book", defaultOptions))
    const ids = result.chunks.map((c) => c.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  test("a section smaller than minChunkTokens still yields one child chunk (no silent content drop)", async () => {
    // Post-Bug-#2 tiling a short chapter is its own section; minChunkTokens
    // guards splitting, it must not drop a section's only content.
    const text = "Tiny note with a few words only."
    const result = await Effect.runPromise(
      chunk(makeParseResult(text), "tiny-book", { ...defaultOptions, minChunkTokens: 30 }),
    )
    expect(result.sections.length).toBe(1)
    expect(result.chunks.length).toBe(1)
    expect(result.chunks[0]!.text).toBe(text)
  })

  test("trailing runt of an already-chunked section is still dropped", async () => {
    const sentences: string[] = []
    for (let i = 0; i < 10; i++) sentences.push(`Sentence ${i} here with a bit of padding to reach the target size.`)
    const result = await Effect.runPromise(chunk(makeParseResult(sentences.join(" ")), "runt-book", defaultOptions))
    expect(result.chunks.length).toBeGreaterThan(1)
    const last = result.chunks[result.chunks.length - 1]!
    expect(last.tokenCount).toBeGreaterThanOrEqual(defaultOptions.minChunkTokens)
  })

  test("section childIds point to actual chunk IDs", async () => {
    const text = "Sentence one. Sentence two. Sentence three."
    const result = await Effect.runPromise(chunk(makeParseResult(text), "test-book", defaultOptions))
    for (const section of result.sections) {
      for (const childId of section.childIds) {
        expect(result.chunks.find((c) => c.id === childId)).toBeDefined()
      }
    }
  })

  test("Arabic text splits on Arabic full stop (؟)", async () => {
    const text = "هذه جملة عربية. وهذه جملة أخرى. ماذا عن الثالثة؟ نعم."
    const result = await Effect.runPromise(chunk(makeParseResult(text), "test-book", defaultOptions))
    expect(result.chunks.length).toBeGreaterThan(0)
    // At least one chunk should contain Arabic text
    expect(result.chunks.some((c) => /[\u0600-\u06FF]/.test(c.text))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Bug #2 regression (2026-11-09 RSS → 15.8 GB): the TXT/DOCX parsers stamp
// every outline entry with `page: 1` on a single whole-book page, and
// buildSectionsFromOutline used to hand the ENTIRE page to EVERY heading —
// O(headings × bookSize) duplicated section text. Same-page outline entries
// must tile the page text BETWEEN headings instead (offset-based ranges),
// while genuine multi-page PDF outlines keep their whole-page ranges.
// ---------------------------------------------------------------------------

describe("outline page tiling (Bug #2 regression)", () => {
  test("page-1-stamped outline tiles the book between headings instead of duplicating it", async () => {
    const chapters = 8
    const body = (h: number) =>
      Array.from(
        { length: 6 },
        (_, s) => `Reading ${h + 1}.${s} explains the observed mechanism with measured accuracy across repeated trials.`,
      ).join(" ")
    const text =
      Array.from({ length: chapters }, (_, h) => `Chapter ${h + 1}: Foundations\n\n${body(h)}`).join("\n\n") +
      "\n\nClosing remarks complete the book."

    // Real parser path: the TXT parser stamps every heading with page 1.
    const parsed = await Effect.runPromise(parseTxt(text))
    expect(parsed.outline.length).toBe(chapters)
    expect(parsed.outline.every((o) => o.page === 1)).toBe(true)
    expect(parsed.pages.length).toBe(1)

    const result = await Effect.runPromise(chunk(parsed, "bug2-book", { ...defaultOptions, parentMaxTokens: 100_000 }))

    // One section per heading — not one per heading × parent slices of a whole-book text.
    expect(result.sections.length).toBe(chapters)

    // Total section text ≈ book text (exactly the book text here), NOT chapters × book text.
    const total = result.sections.reduce((a, s) => a + s.text.length, 0)
    expect(total).toBe(text.length)
    expect(result.sections.map((s) => s.text).join("")).toBe(text)

    // Each section owns its slice: non-empty and carrying its own heading.
    result.sections.forEach((section, i) => {
      expect(section.text.length).toBeGreaterThan(0)
      expect(section.text).toContain(`Chapter ${i + 1}: Foundations`)
      expect(section.text).not.toContain(`Chapter ${i > 0 ? i : chapters + 1}: Foundations`)
    })
  })

  test("genuine multi-page outline keeps its legacy whole-page section ranges", async () => {
    const parseResult: ParseResult = {
      pages: [
        { page: 1, text: "Chapter A\nAlpha page body text." },
        { page: 2, text: "Chapter B\nBeta page body text." },
        { page: 3, text: "Chapter C\nGamma page body text." },
      ],
      outline: [
        { title: "Chapter A", page: 1, level: 1 },
        { title: "Chapter B", page: 2, level: 1 },
        { title: "Chapter C", page: 3, level: 1 },
      ],
      language: undefined,
      textDensity: 1,
      metadata: { pages: 3 },
    }
    const result = await Effect.runPromise(chunk(parseResult, "mp-book", defaultOptions))
    expect(result.sections.length).toBe(3)
    // Section i spans pages [own .. bound] (the historical whole-page semantics,
    // byte-identical) and the page fields are unchanged.
    expect(result.sections[0]!.text).toBe("Chapter A\nAlpha page body text.\n\nChapter B\nBeta page body text.")
    expect(result.sections[1]!.text).toBe("Chapter B\nBeta page body text.\n\nChapter C\nGamma page body text.")
    expect(result.sections[2]!.text).toBe("Chapter C\nGamma page body text.")
    expect(result.sections.map((s) => [s.pageStart, s.pageEnd])).toEqual([
      [1, 2],
      [2, 3],
      [3, 3],
    ])
  })

  test("two headings on one page of a multi-page outline split that page between them", async () => {
    const parseResult: ParseResult = {
      pages: [
        { page: 1, text: "Chapter A\nAlpha page body." },
        { page: 2, text: "Chapter B\nBeta body content.\nChapter C\nGamma-gamma body content." },
        { page: 3, text: "Chapter D\nDelta page body." },
      ],
      outline: [
        { title: "Chapter A", page: 1, level: 1 },
        { title: "Chapter B", page: 2, level: 1 },
        { title: "Chapter C", page: 2, level: 1 },
        { title: "Chapter D", page: 3, level: 1 },
      ],
      language: undefined,
      textDensity: 1,
      metadata: { pages: 3 },
    }
    const result = await Effect.runPromise(chunk(parseResult, "sp-book", defaultOptions))
    expect(result.sections.length).toBe(4)
    const [, b, c] = result.sections
    // Page fields keep their legacy meaning.
    expect(result.sections.map((s) => [s.pageStart, s.pageEnd])).toEqual([
      [1, 2],
      [2, 2],
      [2, 3],
      [3, 3],
    ])
    // B owns page 2 from its start up to C's heading — not the whole page.
    expect(b!.text).toContain("Chapter B")
    expect(b!.text).toContain("Beta body content.")
    expect(b!.text).not.toContain("Chapter C")
    expect(b!.text.length).toBeLessThan(parseResult.pages[1]!.text.length)
    // C starts at its own heading and owns the rest of page 2 (plus the legacy
    // whole-page run through its cross-page bound on page 3).
    expect(c!.text.startsWith("Chapter C")).toBe(true)
    expect(c!.text).toContain("Gamma-gamma body content.")
    expect(c!.text).not.toContain("Beta body content.")
  })

  test("hierarchical DOCX-style outline on one page: parent spans children, chunk sectionIds stay resolvable", async () => {
    const text = [
      "Unit 1: Biology",
      "Intro to the unit with body text.",
      "1.1 Cells",
      "Cells are the basic unit of life and carry out the chemical reactions of metabolism.",
      "1.2 Tissues",
      "Tissues are groups of similar cells that work together to perform a function.",
      "Unit 2: Geology",
      "Rocks and minerals form the solid structure of the planet Earth itself.",
    ].join("\n")
    const parseResult: ParseResult = {
      pages: [{ page: 1, text }],
      outline: [
        { title: "Unit 1: Biology", page: 1, level: 1 },
        { title: "1.1 Cells", page: 1, level: 2 },
        { title: "1.2 Tissues", page: 1, level: 2 },
        { title: "Unit 2: Geology", page: 1, level: 1 },
      ],
      language: undefined,
      textDensity: 1,
      metadata: { pages: 1 },
    }
    // Tiny parentMaxTokens forces parent slices (-p0/-p1 ids): every child
    // chunk's sectionId must still resolve to an existing section row — the
    // historic FK contract around split-section base ids.
    const result = await Effect.runPromise(chunk(parseResult, "h-book", { ...defaultOptions, parentMaxTokens: 40 }))
    const sectionIds = new Set(result.sections.map((s) => s.id))
    expect(result.chunks.length).toBeGreaterThan(0)
    for (const c of result.chunks) expect(sectionIds.has(c.sectionId)).toBe(true)

    const cells = result.sections.filter((s) => s.title === "1.1 Cells")
    const tissues = result.sections.filter((s) => s.title === "1.2 Tissues")
    expect(cells.length).toBe(1)
    expect(tissues.length).toBe(1)
    // Each h2 owns exactly the text between its heading and the next bounding heading
    // (including the trailing newline before the next heading line — the slices tile the text).
    expect(cells[0]!.text).toBe(
      "1.1 Cells\nCells are the basic unit of life and carry out the chemical reactions of metabolism.\n",
    )
    expect(tissues[0]!.text).toBe(
      "1.2 Tissues\nTissues are groups of similar cells that work together to perform a function.\n",
    )
    // Parent semantics survive: the Unit 1 section still contains both children.
    const unit1 = result.sections.filter((s) => s.title === "Unit 1: Biology").map((s) => s.text).join("\n")
    expect(unit1).toContain("1.1 Cells")
    expect(unit1).toContain("1.2 Tissues")
    // Heading path still chains through the (document-order) ancestor.
    const cellsChunk = result.chunks.find((c) => sectionIds.has(c.sectionId) && c.headingPath?.includes("1.1 Cells"))
    expect(cellsChunk?.headingPath).toContain("Unit 1: Biology > 1.1 Cells")
  })

  test("headings that cannot be located on their page keep the legacy whole-page range", async () => {
    // Documented fallback: when a heading text is absent from its page (odd PDF
    // bookmarks), the section falls back to the historical page range. Real
    // TXT/DOCX headings are exact lines, so this is bounded to edge inputs.
    const text = "One two three. Four five six."
    const parseResult: ParseResult = {
      pages: [{ page: 1, text }],
      outline: [
        { title: "Missing A", page: 1, level: 1 },
        { title: "Missing B", page: 1, level: 1 },
        { title: "Missing C", page: 1, level: 1 },
      ],
      language: undefined,
      textDensity: 1,
      metadata: { pages: 1 },
    }
    const result = await Effect.runPromise(chunk(parseResult, "uf-book", defaultOptions))
    expect(result.sections.length).toBe(3)
    for (const s of result.sections) expect(s.text).toBe(text)
  })
})
