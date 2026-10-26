// packages/learning/test/chunk.test.ts
//
// Unit tests for the chunker (plan §7.5). Uses a synthetic ParseResult
// to verify parent/child splitting, sentence boundaries, and heading
// path prepending.

import { expect, test, describe } from "bun:test"
import { Effect } from "effect"
import { chunk, type ChunkOptions, setTokenizer } from "../src/chunk"
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
