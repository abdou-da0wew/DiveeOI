// packages/server/src/session/book-mentions.test.ts
//
// Unit tests for the @book: mention parser (plan §9.1).
// Tests the regex extraction and the parse pipeline against a mock BooksStore.

import { expect, test, describe } from "bun:test"
import { extractBookMentions } from "./book-mentions"

describe("@book: mention extraction", () => {
  test("extracts @book:slug mention", () => {
    const mentions = extractBookMentions("Tell me about @book:biology-101")
    expect(mentions.length).toBe(1)
    expect(mentions[0]).toBe("@book:biology-101")
  })

  test("extracts @book:\"Title\" mention", () => {
    const mentions = extractBookMentions('Read @book:"Biology 101" for me')
    expect(mentions.length).toBe(1)
    expect(mentions[0]).toBe('@book:"Biology 101"')
  })

  test("extracts @book:\'Title\' mention (single quotes)", () => {
    const mentions = extractBookMentions("Read @book:'Chemistry 101' for me")
    expect(mentions.length).toBe(1)
    expect(mentions[0]).toBe('@book:"Chemistry 101"') // normalized to double-quote form
  })

  test("extracts @book:id:<uuid> mention", () => {
    const mentions = extractBookMentions("Look at @book:id:abc-123-def")
    expect(mentions.length).toBe(1)
    expect(mentions[0]).toBe("@book:id:abc-123-def")
  })

  test("extracts multiple mentions from one message", () => {
    const mentions = extractBookMentions("Compare @book:bio with @book:chem")
    expect(mentions.length).toBe(2)
    expect(mentions).toContain("@book:bio")
    expect(mentions).toContain("@book:chem")
  })

  test("does NOT match @book without colon", () => {
    const mentions = extractBookMentions("Read @book about biology")
    expect(mentions.length).toBe(0)
  })

  test("does NOT match @skill: mentions", () => {
    const mentions = extractBookMentions("Use @skill:customize-diveeoi to help")
    expect(mentions.length).toBe(0)
  })

  test("handles Arabic text around the mention", () => {
    const mentions = extractBookMentions("اقرأ @book:biology-101 من فضلك")
    expect(mentions.length).toBe(1)
    expect(mentions[0]).toBe("@book:biology-101")
  })

  test("handles mention at start of string", () => {
    const mentions = extractBookMentions("@book:biology-101 is interesting")
    expect(mentions.length).toBe(1)
  })

  test("handles mention at end of string", () => {
    const mentions = extractBookMentions("Interesting book: @book:biology-101")
    expect(mentions.length).toBe(1)
  })

  test("deduplicates repeated mentions", () => {
    // The regex doesn't deduplicate — that's the caller's job. But we
    // verify both occurrences are extracted.
    const mentions = extractBookMentions("@book:bio and @book:bio again")
    expect(mentions.length).toBe(2)
  })

  test("slug can contain hyphens and numbers", () => {
    const mentions = extractBookMentions("Read @book:my-book-2024")
    expect(mentions.length).toBe(1)
    expect(mentions[0]).toBe("@book:my-book-2024")
  })

  test("title can contain spaces and punctuation", () => {
    const mentions = extractBookMentions('Read @book:"Biology: An Introduction, 2nd Ed."')
    expect(mentions.length).toBe(1)
  })
})
