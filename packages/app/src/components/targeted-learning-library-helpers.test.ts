import { describe, expect, test } from "bun:test"
import { displayBookError } from "./targeted-learning-library-helpers"

const FALLBACK = "Indexing failed. No error details were reported."

const failed = (error?: string | null) => ({
  id: "book-1",
  slug: "some-book",
  title: "Some Book",
  status: "failed",
  chunkCount: 0,
  error,
})

const book = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "book-1",
  slug: "some-book",
  title: "Some Book",
  status,
  chunkCount: 0,
  error: null,
  ...extra,
})

describe("displayBookError", () => {
  test("returns the backend error for a failed book", () => {
    expect(displayBookError(failed("PDF parse error on page 42"), FALLBACK)).toBe(
      "PDF parse error on page 42",
    )
  })

  test("trims surrounding whitespace from the backend error", () => {
    expect(displayBookError(failed("  boom  "), FALLBACK)).toBe("boom")
  })

  test("falls back when the error is missing, null, or empty", () => {
    expect(displayBookError(failed(undefined), FALLBACK)).toBe(FALLBACK)
    expect(displayBookError(failed(null), FALLBACK)).toBe(FALLBACK)
    expect(displayBookError(failed(""), FALLBACK)).toBe(FALLBACK)
    expect(displayBookError(failed("   "), FALLBACK)).toBe(FALLBACK)
  })

  test("never renders a literal null/undefined string", () => {
    expect(displayBookError(failed("null"), FALLBACK)).toBe(FALLBACK)
    expect(displayBookError(failed("undefined"), FALLBACK)).toBe(FALLBACK)
    expect(displayBookError(failed("  null "), FALLBACK)).toBe(FALLBACK)
  })

  test("returns an empty string for non-failed books", () => {
    expect(displayBookError(book("ready", { chunkCount: 3 }), FALLBACK)).toBe("")
    expect(displayBookError(book("indexing", { progress: 40 }), FALLBACK)).toBe("")
    expect(displayBookError(book("ready", { error: "stale" }), FALLBACK)).toBe("")
  })
})
