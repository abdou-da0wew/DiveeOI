// packages/learning/test/rewrite.test.ts
//
// Unit tests for the query rewriter (plan §8.2).

import { expect, test, describe } from "bun:test"
import { Effect } from "effect"
import { rewrite, isAnaphoric, type RewriteInput } from "../src/retrieve/rewrite"

describe("query rewriter", () => {
  test("off mode returns the query unchanged", async () => {
    const result = await Effect.runPromise(
      rewrite({ query: "explain more", recentUserTurns: ["what is photosynthesis"], mode: "off", rewriteTurns: 2 }),
    )
    expect(result).toBe("explain more")
  })

  test("non-anaphoric query is returned unchanged in heuristic mode", async () => {
    const result = await Effect.runPromise(
      rewrite({
        query: "what is the chemical formula for glucose",
        recentUserTurns: ["photosynthesis is interesting"],
        mode: "heuristic",
        rewriteTurns: 2,
      }),
    )
    expect(result).toBe("what is the chemical formula for glucose")
  })

  test("anaphoric query gets the last turn appended", async () => {
    const result = await Effect.runPromise(
      rewrite({
        query: "explain more",
        recentUserTurns: ["what is photosynthesis"],
        mode: "heuristic",
        rewriteTurns: 2,
      }),
    )
    expect(result).toContain("photosynthesis")
    expect(result).toContain("explain more")
  })

  test("anaphoric query with no recent turns is returned unchanged", async () => {
    const result = await Effect.runPromise(
      rewrite({ query: "explain more", recentUserTurns: [], mode: "heuristic", rewriteTurns: 2 }),
    )
    expect(result).toBe("explain more")
  })

  test("llm mode currently returns the query unchanged (Phase 3 implements)", async () => {
    const result = await Effect.runPromise(
      rewrite({ query: "explain more", recentUserTurns: ["photosynthesis"], mode: "llm", rewriteTurns: 2 }),
    )
    // Until Phase 3 wires the LLM, llm mode just returns the query
    expect(result).toBe("explain more")
  })
})

describe("isAnaphoric", () => {
  test("'explain' is detected as anaphoric", () => {
    expect(isAnaphoric("explain")).toBe(true)
    expect(isAnaphoric("explain more")).toBe(true)
  })

  test("'simpler' is detected as anaphoric", () => {
    expect(isAnaphoric("simpler")).toBe(true)
  })

  test("Arabic 'اشرح' is detected as anaphoric", () => {
    expect(isAnaphoric("اشرح")).toBe(true)
    expect(isAnaphoric("وضّح أكثر")).toBe(true)
  })

  test("long query is NOT anaphoric", () => {
    const longQuery = "what is the chemical formula for glucose and how does it relate to photosynthesis in plants"
    expect(isAnaphoric(longQuery)).toBe(false)
  })

  test("substantive question is NOT anaphoric", () => {
    expect(isAnaphoric("what is photosynthesis")).toBe(false)
  })
})
