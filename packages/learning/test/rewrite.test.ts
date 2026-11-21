// packages/learning/test/rewrite.test.ts
//
// Unit tests for the query rewriter (plan §8.2), including the LLM mode
// and its resilience contract: every LLM failure falls back to the
// heuristic rewrite, so `rewrite` never fails.

import { expect, test, describe } from "bun:test"
import { Effect } from "effect"
import {
  rewrite,
  buildRewritePrompt,
  isAnaphoric,
  type RewriteInput,
  type RewriteLLMClient,
} from "../src/retrieve/rewrite"

const baseInput = (overrides: Partial<RewriteInput>): RewriteInput => ({
  query: "explain more",
  recentUserTurns: ["what is photosynthesis"],
  mode: "heuristic",
  rewriteTurns: 2,
  ...overrides,
})

const run = (input: RewriteInput): Promise<string> => Effect.runPromise(rewrite(input))

const calledClient = (result: Effect.Effect<string, unknown>): [RewriteLLMClient, { prompts: string[] }] => {
  const calls: { prompts: string[] } = { prompts: [] }
  const client: RewriteLLMClient = {
    rewrite: ({ prompt }) => {
      calls.prompts.push(prompt)
      return result
    },
  }
  return [client, calls]
}

describe("query rewriter", () => {
  test("off mode returns the query unchanged", async () => {
    const result = await run(baseInput({ mode: "off" }))
    expect(result).toBe("explain more")
  })

  test("non-anaphoric query is returned unchanged in heuristic mode", async () => {
    const result = await run(
      baseInput({
        query: "what is the chemical formula for glucose",
        recentUserTurns: ["photosynthesis is interesting"],
      }),
    )
    expect(result).toBe("what is the chemical formula for glucose")
  })

  test("anaphoric query gets the last turn appended", async () => {
    const result = await run(baseInput({}))
    expect(result).toContain("photosynthesis")
    expect(result).toContain("explain more")
  })

  test("anaphoric query with no recent turns is returned unchanged", async () => {
    const result = await run(baseInput({ recentUserTurns: [] }))
    expect(result).toBe("explain more")
  })
})

describe("query rewriter: llm mode", () => {
  test("a. client is called and its rewritten query is returned (trimmed)", async () => {
    const [client, calls] = calledClient(Effect.succeed("  photosynthesis explained simply  "))
    const result = await run(baseInput({ mode: "llm", llm: client }))
    expect(result).toBe("photosynthesis explained simply")
    expect(calls.prompts.length).toBe(1)
  })

  test("b. LLM failure (Effect.fail) falls back to the heuristic rewrite", async () => {
    const client: RewriteLLMClient = { rewrite: () => Effect.fail(new Error("llm unavailable")) }
    const result = await run(baseInput({ mode: "llm", llm: client }))
    expect(result).toBe("explain more (re: what is photosynthesis)")
  })

  test("c. sync-throwing client falls back to the heuristic rewrite", async () => {
    const client: RewriteLLMClient = {
      rewrite: () => {
        throw new Error("sync boom")
      },
    }
    const result = await run(baseInput({ mode: "llm", llm: client }))
    expect(result).toBe("explain more (re: what is photosynthesis)")
  })

  test("d. empty or oversized LLM output falls back to the heuristic rewrite", async () => {
    for (const bad of ["", "   ", "x".repeat(301), "y".repeat(200)]) {
      // "explain more" is 12 chars; 200-char output passes the 300-char cap
      // but is rejected by the 4x-length guardrail.
      const [client] = calledClient(Effect.succeed(bad))
      const result = await run(baseInput({ mode: "llm", llm: client }))
      expect(result).toBe("explain more (re: what is photosynthesis)")
    }
  })

  test("e. no client provided with mode 'llm' falls back to the heuristic rewrite", async () => {
    const result = await run(baseInput({ mode: "llm" }))
    expect(result).toBe("explain more (re: what is photosynthesis)")
  })

  test("client returning a non-Effect value (plain string) falls back to the heuristic rewrite", async () => {
    // Interface violation at runtime (TS type says Effect); must not crash
    // the fiber ("Not a valid effect") — falls back instead.
    const client = {
      rewrite: () => "plain string" as unknown as Effect.Effect<string, unknown>,
    }
    const result = await run(baseInput({ mode: "llm", llm: client }))
    expect(result).toBe("explain more (re: what is photosynthesis)")
  })

  test("client returning null / undefined / plain object falls back to the heuristic rewrite", async () => {
    for (const bogus of [null, undefined, { not: "an effect" }]) {
      const client = {
        rewrite: () => bogus as unknown as Effect.Effect<string, unknown>,
      }
      const result = await run(baseInput({ mode: "llm", llm: client }))
      expect(result).toBe("explain more (re: what is photosynthesis)")
    }
  })

  test("f. prompt contains the query, the recent turns, and respects rewriteTurns", async () => {
    const [client, calls] = calledClient(Effect.succeed("standalone query"))
    await run(
      baseInput({
        mode: "llm",
        llm: client,
        recentUserTurns: ["turn one", "turn two", "turn three"],
        rewriteTurns: 2,
      }),
    )
    expect(calls.prompts.length).toBe(1)
    const prompt = calls.prompts[0]
    // Current query and the last `rewriteTurns` turns (most recent last)...
    expect(prompt).toContain("explain more")
    expect(prompt).toContain("turn two")
    expect(prompt).toContain("turn three")
    expect(prompt).not.toContain("turn one")
    // ...plus the only-the-query / same-language / no-quotes contract.
    const lower = prompt.toLowerCase()
    expect(lower).toContain("standalone retrieval query")
    expect(lower).toContain("only the rewritten query")
    expect(lower).toContain("same language")
    expect(lower).toContain("arabic stays arabic")
    expect(lower).toContain("no quotes")
    expect(lower).toContain("no explanations")
  })

  test("g. Arabic anaphoric query: Arabic rewrite is returned trimmed", async () => {
    const [client, calls] = calledClient(Effect.succeed(" اشرح عملية البناء الضوئي في النباتات "))
    const result = await run(
      baseInput({ mode: "llm", llm: client, query: "اشرح أكثر", recentUserTurns: ["ما هو البناء الضوئي؟"] }),
    )
    expect(result).toBe("اشرح عملية البناء الضوئي في النباتات")
    expect(calls.prompts[0]).toContain("اشرح أكثر")
    expect(calls.prompts[0]).toContain("ما هو البناء الضوئي؟")
  })

  test("llm mode applies to non-anaphoric queries too (LLM result stands)", async () => {
    const [client] = calledClient(Effect.succeed("photosynthesis in plants"))
    const result = await run(
      baseInput({ mode: "llm", llm: client, query: "what is photosynthesis", recentUserTurns: ["turn"] }),
    )
    expect(result).toBe("photosynthesis in plants")
  })
})

describe("buildRewritePrompt", () => {
  test("includes the query and the last rewriteTurns turns only", () => {
    const prompt = buildRewritePrompt({
      query: "why is the sky blue",
      recentUserTurns: ["light scattering", "rayleigh scattering", "atmosphere"],
      rewriteTurns: 2,
    })
    expect(prompt).toContain("why is the sky blue")
    expect(prompt).toContain("rayleigh scattering")
    expect(prompt).toContain("atmosphere")
    expect(prompt).not.toContain("light scattering")
  })

  test("rewriteTurns 0 yields no turns", () => {
    const prompt = buildRewritePrompt({ query: "explain more", recentUserTurns: ["photosynthesis"], rewriteTurns: 0 })
    expect(prompt).toContain("(none)")
    expect(prompt).not.toContain("photosynthesis")
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
