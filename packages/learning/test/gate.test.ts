// packages/learning/test/gate.test.ts
//
// Unit tests for the retrieval gate (plan §8.3).
// Covers: pass, refused, small-talk bypass, library-unavailable.

import { expect, test, describe } from "bun:test"
import { evaluate, type GateInput } from "../src/retrieve/gate"

const baseInput: GateInput = {
  bestDenseScore: 0.5,
  bestFusedScore: 0.2,
  query: "what is photosynthesis",
  language: "en",
  enabled: true,
  minDenseScore: 0.35,
  minFusedScore: 0.1,
  allowSmallTalk: true,
  refusalMessages: {
    en: "This isn't covered in the selected book(s).",
    ar: "هذا الموضوع غير موجود في الكتاب أو الكتب المحددة.",
  },
  libraryAvailable: true,
}

describe("retrieval gate", () => {
  test("passes when both scores are above thresholds", async () => {
    const result = await Effect.runPromise(evaluate(baseInput))
    expect(result.decision).toBe("pass")
  })

  test("refuses when dense score is below threshold", async () => {
    const result = await Effect.runPromise(
      evaluate({ ...baseInput, bestDenseScore: 0.1, bestFusedScore: 0.05 }),
    )
    expect(result.decision).toBe("refused")
    expect(result.message).toContain("isn't covered")
  })

  test("returns Arabic refusal for Arabic queries", async () => {
    const result = await Effect.runPromise(
      evaluate({
        ...baseInput,
        query: "ما هو التمثيل الضوئي",
        language: "ar",
        bestDenseScore: 0.1,
        bestFusedScore: 0.05,
      }),
    )
    expect(result.decision).toBe("refused")
    expect(result.message).toContain("غير موجود")
  })

  test("small talk bypasses the gate", async () => {
    const result = await Effect.runPromise(
      evaluate({ ...baseInput, query: "hi", bestDenseScore: 0.0, bestFusedScore: 0.0 }),
    )
    expect(result.decision).toBe("small-talk")
  })

  test("Arabic small talk bypasses the gate", async () => {
    const result = await Effect.runPromise(
      evaluate({ ...baseInput, query: "مرحبا", language: "ar", bestDenseScore: 0.0, bestFusedScore: 0.0 }),
    )
    expect(result.decision).toBe("small-talk")
  })

  test("disabled gate always passes", async () => {
    const result = await Effect.runPromise(
      evaluate({ ...baseInput, enabled: false, bestDenseScore: 0.0, bestFusedScore: 0.0 }),
    )
    expect(result.decision).toBe("pass")
  })

  test("library unavailable short-circuits to library-unavailable", async () => {
    const result = await Effect.runPromise(
      evaluate({ ...baseInput, libraryAvailable: false }),
    )
    expect(result.decision).toBe("library-unavailable")
  })

  test("long query is not treated as small talk", async () => {
    const longGreeting = "hello there, I was wondering if you could help me understand a few things about the book"
    const result = await Effect.runPromise(
      evaluate({ ...baseInput, query: longGreeting, bestDenseScore: 0.0, bestFusedScore: 0.0 }),
    )
    expect(result.decision).toBe("refused")
  })

  test("allowSmallTalk=false disables the bypass", async () => {
    const result = await Effect.runPromise(
      evaluate({
        ...baseInput,
        query: "hi",
        allowSmallTalk: false,
        bestDenseScore: 0.0,
        bestFusedScore: 0.0,
      }),
    )
    expect(result.decision).toBe("refused")
  })
})

// We need Effect for runPromise.
import { Effect } from "effect"
