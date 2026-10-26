// packages/learning/test/grounding.test.ts
//
// Unit tests for the grounding module (plan §9.4, §9.6). Verifies:
//   - prompt rules build the right Arabic/English system-prompt blocks
//   - tool allowlist allows the right tools and denies others
//   - the calculator is conditional on allowCalculator
//   - verifier catches missing chunks, un-retrieved chunks, and bad quoted spans
//   - buildRetryPrompt lists the failures correctly

import { expect, test, describe } from "bun:test"
import { Effect } from "effect"
import {
  buildGroundingPrompt,
  TARGETED_SESSION_TOOL_ALLOWLIST,
  isToolAllowed,
} from "../src/grounding/prompt-rules"
import { verify, buildRetryPrompt, type VerifyInput } from "../src/grounding/verifier"

describe("grounding prompt rules", () => {
  test("English prompt lists attached books", () => {
    const prompt = buildGroundingPrompt({
      bookTitles: ["Biology 101", "Chemistry 101"],
      language: "en",
      refusalMessages: { en: "not in book", ar: "غير موجود" },
    })
    expect(prompt).toContain("Biology 101")
    expect(prompt).toContain("Chemistry 101")
    expect(prompt).toContain("Book-grounded learning")
  })

  test("Arabic prompt lists attached books in Arabic", () => {
    const prompt = buildGroundingPrompt({
      bookTitles: ["علم الأحياء"],
      language: "ar",
      refusalMessages: { en: "not in book", ar: "غير موجود" },
    })
    expect(prompt).toContain("علم الأحياء")
    expect(prompt).toContain("تعلّم موجّه بالكتاب")
  })

  test("prompt includes the allowed-tools list", () => {
    const prompt = buildGroundingPrompt({
      bookTitles: ["X"],
      language: "en",
      refusalMessages: { en: "x", ar: "x" },
    })
    expect(prompt).toContain("book_outline")
    expect(prompt).toContain("book_search")
    expect(prompt).toContain("book_read_section")
    expect(prompt).toContain("book_find_term")
  })

  test("prompt includes the refusal message", () => {
    const prompt = buildGroundingPrompt({
      bookTitles: ["X"],
      language: "en",
      refusalMessages: { en: "NOT IN BOOK", ar: "x" },
    })
    expect(prompt).toContain("NOT IN BOOK")
  })
})

describe("tool allowlist", () => {
  test("book tools are allowed", () => {
    expect(isToolAllowed("book_outline", true)).toBe(true)
    expect(isToolAllowed("book_search", true)).toBe(true)
    expect(isToolAllowed("book_read_section", true)).toBe(true)
    expect(isToolAllowed("book_find_term", true)).toBe(true)
  })

  test("memory tools are allowed", () => {
    expect(isToolAllowed("student_memory_read", true)).toBe(true)
    expect(isToolAllowed("student_memory_write", true)).toBe(true)
    expect(isToolAllowed("book_note_read", true)).toBe(true)
    expect(isToolAllowed("book_note_write", true)).toBe(true)
  })

  test("calculator is conditional on allowCalculator", () => {
    expect(isToolAllowed("calculator", true)).toBe(true)
    expect(isToolAllowed("calculator", false)).toBe(false)
  })

  test("web search is denied", () => {
    expect(isToolAllowed("websearch", true)).toBe(false)
    expect(isToolAllowed("webfetch", true)).toBe(false)
  })

  test("shell, edit, write are denied", () => {
    expect(isToolAllowed("bash", true)).toBe(false)
    expect(isToolAllowed("shell", true)).toBe(false)
    expect(isToolAllowed("edit", true)).toBe(false)
    expect(isToolAllowed("write", true)).toBe(false)
  })

  test("any unknown tool is denied (allowlist, not blocklist)", () => {
    expect(isToolAllowed("totally_new_tool", true)).toBe(false)
    expect(isToolAllowed("mcp_custom_tool", true)).toBe(false)
  })

  test("skill tool is denied", () => {
    expect(isToolAllowed("skill", true)).toBe(false)
  })

  test("allowlist contains exactly the expected tools + calculator", () => {
    expect(TARGETED_SESSION_TOOL_ALLOWLIST.size).toBe(9)
    expect(TARGETED_SESSION_TOOL_ALLOWLIST.has("book_outline")).toBe(true)
    expect(TARGETED_SESSION_TOOL_ALLOWLIST.has("calculator")).toBe(true)
  })
})

describe("grounding verifier", () => {
  const baseInput: VerifyInput = {
    citations: [
      { chunkId: "c1", sourceHash: "h1", page: 5, quotedSpan: "photosynthesis converts sunlight" },
      { chunkId: "c2", sourceHash: "h1", page: 8, quotedSpan: "the mitochondria is the powerhouse" },
    ],
    retrievedChunkIds: new Set(["c1", "c2"]),
    chunksByText: new Map([
      ["c1", "Photosynthesis converts sunlight into glucose."],
      ["c2", "The mitochondria is the powerhouse of the cell."],
    ]),
    mode: "flag",
  }

  test("off mode returns no results and allVerified=true", async () => {
    const result = await Effect.runPromise(verify({ ...baseInput, mode: "off" }))
    expect(result.results.length).toBe(0)
    expect(result.allVerified).toBe(true)
  })

  test("all valid citations → allVerified=true", async () => {
    const result = await Effect.runPromise(verify(baseInput))
    expect(result.results.length).toBe(2)
    expect(result.allVerified).toBe(true)
  })

  test("cited chunk that doesn't exist → not verified", async () => {
    const result = await Effect.runPromise(
      verify({
        ...baseInput,
        citations: [{ chunkId: "c99", sourceHash: "h1", page: 1, quotedSpan: "x" }],
      }),
    )
    expect(result.allVerified).toBe(false)
    expect(result.results[0]!.chunkExists).toBe(false)
  })

  test("cited chunk that wasn't retrieved this turn → not verified", async () => {
    const result = await Effect.runPromise(
      verify({
        ...baseInput,
        citations: [{ chunkId: "c1", sourceHash: "h1", page: 5, quotedSpan: "photosynthesis" }],
        retrievedChunkIds: new Set([]), // nothing retrieved this turn
      }),
    )
    expect(result.allVerified).toBe(false)
    expect(result.results[0]!.chunkWasRetrievedThisTurn).toBe(false)
  })

  test("quoted span that doesn't appear in the chunk → not verified", async () => {
    const result = await Effect.runPromise(
      verify({
        ...baseInput,
        citations: [
          { chunkId: "c1", sourceHash: "h1", page: 5, quotedSpan: "this exact phrase is not in the chunk" },
        ],
      }),
    )
    expect(result.allVerified).toBe(false)
    expect(result.results[0]!.quotedSpanMatches).toBe(false)
  })

  test("whitespace differences in quoted span are tolerated", async () => {
    const result = await Effect.runPromise(
      verify({
        ...baseInput,
        citations: [
          {
            chunkId: "c1",
            sourceHash: "h1",
            page: 5,
            quotedSpan: "photosynthesis    converts   sunlight", // extra spaces
          },
        ],
      }),
    )
    expect(result.allVerified).toBe(true)
  })

  test("buildRetryPrompt lists the failed citations", () => {
    const failures = [
      {
        citation: { chunkId: "c1", sourceHash: "h1", page: 5, quotedSpan: "x" },
        chunkExists: true,
        chunkWasRetrievedThisTurn: false,
        quotedSpanMatches: true,
        verified: false,
      },
      {
        citation: { chunkId: "c99", sourceHash: "h1", page: 1, quotedSpan: "y" },
        chunkExists: false,
        chunkWasRetrievedThisTurn: true,
        quotedSpanMatches: true,
        verified: false,
      },
    ]
    const prompt = buildRetryPrompt(failures)
    expect(prompt).toContain("c1")
    expect(prompt).toContain("c99")
    expect(prompt).toContain("cited chunk does not exist")
    expect(prompt).toContain("cited chunk was not retrieved or read this turn")
  })
})
