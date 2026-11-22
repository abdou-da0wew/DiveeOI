// packages/learning/test/grounding-numeric.test.ts
//
// Numeric-claim grounding (TODO #4, plan §9.6): every figure a reply asserts for a
// citation must appear in the cited chunk text, with Arabic-Indic ⇄ Latin digit and
// separator normalization (`1000` ≡ `1,000` ≡ `1.000` ≡ `١٠٠٠` ≡ `۱۰۰۰`).
// Covers the brief's matrix:
//   - Latin figure in reply + same figure in cited chunk → verified
//   - Arabic-Indic figure in reply + Latin figure in chunk → verified (equivalence)
//   - Separator variance (1,000 vs 1000) → verified
//   - Figure absent from the cited chunk → unverified, failure reason names the figure
//   - Non-numeric citations behave exactly as before
//   - mode "off" unchanged

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { buildRetryPrompt, verify, type VerifyInput } from "../src/grounding/verifier"
import { chunkFigureKeys, extractClaimFigures, findMissingFigures } from "../src/grounding/numeric"

const run = (input: VerifyInput) => Effect.runPromise(verify(input))

describe("figure normalization (numeric.ts unit)", () => {
  test("1000 ≡ 1,000 ≡ 1.000 ≡ ١٠٠٠ ≡ ۱۰۰۰ ≡ 1٬000", () => {
    for (const form of ["1000", "1,000", "1.000", "١٠٠٠", "۱۰۰۰", "1٬000"]) {
      expect([...chunkFigureKeys(`نحو ${form} طالب في المدرسة`)]).toContain("1000")
    }
    expect([...chunkFigureKeys("1,000,000 residents")]).toContain("1000000")
    expect([...chunkFigureKeys("1,000.5 grams")]).toContain("1000.5")
  })

  test("decimals: 3.5 ≡ ٣٫٥ ≡ 3,5; trailing and leading zeros trimmed", () => {
    expect([...chunkFigureKeys("speed 3.5 km")]).toContain("3.5")
    expect([...chunkFigureKeys("السرعة ٣٫٥ كم/ث")]).toContain("3.5")
    expect([...chunkFigureKeys("speed 3,5 km")]).toContain("3.5")
    expect([...chunkFigureKeys("3.50 and 3.0 and 07 and 0.5")]).toEqual(["3.5", "3", "7", "0.5"])
  })

  test("percent is an annotation, not part of the figure: 85% ≡ 85 ≡ ٨٥٪", () => {
    expect([...chunkFigureKeys("85% of the cells")]).toContain("85")
    expect([...chunkFigureKeys("٨٥٪ من الخلايا")]).toContain("85")
  })

  test("signs are ignored so digit ranges tokenize into two figures", () => {
    expect([...chunkFigureKeys("years 1939-1945")]).toContain("1939")
    expect([...chunkFigureKeys("years 1939-1945")]).toContain("1945")
  })

  test("findMissingFigures returns ORIGINAL tokens for absent figures only", () => {
    expect(findMissingFigures(["١٥٠٠", "1,000", "9999"], "a total of 1,500 students")).toEqual([
      "1,000",
      "9999",
    ])
    expect(findMissingFigures(["1,500"], "a total of 1,500 students")).toEqual([])
  })

  test("claim extraction skips line-start enumeration markers but keeps real figures", () => {
    expect(extractClaimFigures("1. Photosynthesis intro\n2. 1969 landing\n## 12. Epilogue")).toEqual(["1969"])
    expect(extractClaimFigures("It took 3.5 hours")).toEqual(["3.5"])
  })
})

describe("numeric-claim grounding (verify)", () => {
  const chunkId = "bk_num-s1-c1"
  const otherId = "bk_num-s1-c2"
  const chunkText = "In 1953 the experiment measured 1,500 cells with 85% viability at 3.5 volts and a 1.000 baseline."
  const input = (answer: string, overrides: Partial<VerifyInput> = {}): VerifyInput => ({
    citations: [{ chunkId }],
    retrievedChunkIds: new Set([chunkId]),
    chunksByText: new Map([[chunkId, chunkText]]),
    mode: "flag",
    answerText: answer,
    ...overrides,
  })

  test("Latin figure in reply + same figure in cited chunk → verified", async () => {
    const result = await run(input("The 1953 experiment is described in the passage [bk_num-s1-c1]."))
    expect(result.allVerified).toBe(true)
    expect(result.results[0]!.numericClaimsGrounded).toBe(true)
    expect(result.results[0]!.ungroundedFigures).toEqual([])
    expect(result.results[0]!.verified).toBe(true)
  })

  test("Arabic-Indic figure in reply + Latin figure in chunk → verified (equivalence)", async () => {
    const result = await run(input("قيس ١٥٠٠ خلية في التجربة [bk_num-s1-c1]."))
    expect(result.allVerified).toBe(true)
    expect(result.results[0]!.numericClaimsGrounded).toBe(true)
  })

  test("Persian digits ۱۰۰۰ and separator/dot-thousand variance → verified", async () => {
    expect((await run(input("على الأقل ۱۰۰۰ من الخلايا [bk_num-s1-c1]."))).allVerified).toBe(true)
    expect((await run(input("About 1,500 cells [bk_num-s1-c1]."))).allVerified).toBe(true)
    expect((await run(input("The 1.000 baseline held [bk_num-s1-c1]."))).allVerified).toBe(true)
    expect((await run(input("Viability was 85% [bk_num-s1-c1]."))).allVerified).toBe(true)
    expect((await run(input("النسبة بلغت ٨٥٪ عند ٣٫٥ فولت [bk_num-s1-c1]."))).allVerified).toBe(true)
  })

  test("figure absent from cited chunk → unverified, failure reason names the figure", async () => {
    const result = await run(input("About 9,999 cells were measured [bk_num-s1-c1]."))
    expect(result.allVerified).toBe(false)
    expect(result.results[0]!.chunkExists).toBe(true)
    expect(result.results[0]!.quotedSpanMatches).toBe(true)
    expect(result.results[0]!.numericClaimsGrounded).toBe(false)
    expect(result.results[0]!.ungroundedFigures).toEqual(["9,999"])
    expect(result.results[0]!.verified).toBe(false)
    const retry = buildRetryPrompt(result.results)
    expect(retry).toContain("bk_num-s1-c1")
    expect(retry).toContain("9,999")
    expect(retry).toContain("do not appear in the cited chunk")
  })

  test("only the missing figures are reported, mixed grounded/ungrounded segment", async () => {
    const result = await run(input("In 1953 with 1,500 cells and 77 units [bk_num-s1-c1]."))
    expect(result.results[0]!.numericClaimsGrounded).toBe(false)
    expect(result.results[0]!.ungroundedFigures).toEqual(["77"])
  })

  test("figures are attributed per citation, not to the union of chunks (no false positives)", async () => {
    const result = await run(input(
      "About 1,500 cells [bk_num-s1-c1]. The recording procedure followed [bk_num-s1-c2].",
      {
        citations: [{ chunkId }, { chunkId: otherId }],
        retrievedChunkIds: new Set([chunkId, otherId]),
        chunksByText: new Map([
          [chunkId, chunkText],
          [otherId, "The recording procedure is described here without numbers."],
        ]),
      },
    ))
    expect(result.allVerified).toBe(true)
    expect(result.results[0]!.numericClaimsGrounded).toBe(true)
    expect(result.results[1]!.numericClaimsGrounded).toBe(true)
  })

  test("fabricated figure fails the citation it is attributed to, not the others", async () => {
    const result = await run(input(
      "Baseline established [bk_num-s1-c1]. About 9,999 cells were counted [bk_num-s1-c2].",
      {
        citations: [{ chunkId }, { chunkId: otherId }],
        retrievedChunkIds: new Set([chunkId, otherId]),
        chunksByText: new Map([
          [chunkId, chunkText],
          [otherId, "The counting method is described here without numbers."],
        ]),
      },
    ))
    expect(result.results[0]!.verified).toBe(true)
    expect(result.results[1]!.verified).toBe(false)
    expect(result.results[1]!.numericClaimsGrounded).toBe(false)
    expect(result.results[1]!.ungroundedFigures).toEqual(["9,999"])
  })

  test("computed figures after the last citation are not attributed", async () => {
    const result = await run(input("Measured [bk_num-s1-c1]. Therefore the total is 12345 units."))
    expect(result.allVerified).toBe(true)
  })

  test("figure in quotedSpan must appear in chunk (no answerText)", async () => {
    const base = {
      citations: [{ chunkId, quotedSpan: "measured 1,500 cells" }],
      retrievedChunkIds: new Set([chunkId]),
      chunksByText: new Map([[chunkId, chunkText]]),
      mode: "flag" as const,
    }
    expect((await run(base)).allVerified).toBe(true)
    const bad = await run({ ...base, citations: [{ chunkId, quotedSpan: "measured 2,500 cells" }] })
    expect(bad.allVerified).toBe(false)
    expect(bad.results[0]!.numericClaimsGrounded).toBe(false)
    expect(bad.results[0]!.ungroundedFigures).toEqual(["2,500"])
  })

  test("chunk text unavailable → numeric check inconclusive, existing checks still fail it", async () => {
    const missingId = "bk_missing-s1-c9"
    const result = await run(input("About 9,999 cells [bk_missing-s1-c9].", { citations: [{ chunkId: missingId }] }))
    expect(result.results[0]!.chunkExists).toBe(false)
    expect(result.results[0]!.numericClaimsGrounded).toBe(true)
    expect(result.allVerified).toBe(false)
  })

  test("non-numeric citations behave exactly as before", async () => {
    const base = {
      citations: [{ chunkId, quotedSpan: "not present anywhere in the passage" }],
      retrievedChunkIds: new Set([chunkId]),
      chunksByText: new Map([[chunkId, chunkText]]),
      mode: "flag" as const,
      answerText: "No figures in this sentence [bk_num-s1-c1].",
    }
    const result = await run(base)
    expect(result.results[0]!.quotedSpanMatches).toBe(false)
    expect(result.results[0]!.numericClaimsGrounded).toBe(true)
    expect(result.allVerified).toBe(false)
    const good = await run({
      ...base,
      citations: [{ chunkId, quotedSpan: "In 1953 the experiment" }],
    })
    expect(good.allVerified).toBe(true)
    expect(good.results[0]!.numericClaimsGrounded).toBe(true)
  })

  test("mode off → unchanged: no results, allVerified true, even with ungrounded figures", async () => {
    const result = await run(input("Anything at all 9,999 [bk_num-s1-c1].", { mode: "off" }))
    expect(result.results.length).toBe(0)
    expect(result.allVerified).toBe(true)
  })

  test("retry failure list includes numeric failures with figures named", async () => {
    const result = await run(input("We counted 9,999 and 4,444 [bk_num-s1-c1]."))
    const prompt = buildRetryPrompt(result.results)
    expect(prompt).toContain("bk_num-s1-c1")
    expect(prompt).toContain("9,999")
    expect(prompt).toContain("4,444")
    expect(prompt).toContain("do not appear in the cited chunk")
  })
})
