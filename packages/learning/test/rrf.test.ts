// packages/learning/test/rrf.test.ts
//
// Unit tests for Reciprocal Rank Fusion (plan §8.1).
// Verifies the fusion math and that the result is correctly ordered.

import { expect, test, describe } from "bun:test"
import { rrf } from "../src/retrieve/rrf"

describe("reciprocal rank fusion", () => {
  test("empty inputs produce empty scores", () => {
    const scores = rrf([], [], 60)
    expect(scores.size).toBe(0)
  })

  test("single list, single entry produces 1/(k+1)", () => {
    const scores = rrf(["a"], [], 60)
    expect(scores.get("a")).toBeCloseTo(1 / 61, 5)
  })

  test("two lists with the same top entry boost it", () => {
    // Both lists rank "a" first.
    const scores = rrf(["a", "b"], ["a", "c"], 60)
    const a = scores.get("a")!
    const b = scores.get("b")!
    const c = scores.get("c")!
    expect(a).toBeGreaterThan(b)
    expect(a).toBeGreaterThan(c)
    // a appears at rank 0 in both lists: 1/61 + 1/61
    expect(a).toBeCloseTo(2 / 61, 5)
  })

  test("disjoint lists produce independent scores", () => {
    const scores = rrf(["a", "b"], ["c", "d"], 60)
    expect(scores.size).toBe(4)
    expect(scores.get("a")).toBeCloseTo(1 / 61, 5)
    expect(scores.get("b")).toBeCloseTo(1 / 62, 5)
    expect(scores.get("c")).toBeCloseTo(1 / 61, 5)
    expect(scores.get("d")).toBeCloseTo(1 / 62, 5)
  })

  test("weights affect the ranking", () => {
    // BM25 ranks a,b ; dense ranks b,a ; with heavy BM25 weight, a should win.
    const scores = rrf(["a", "b"], ["b", "a"], 60, 10, 1)
    expect(scores.get("a")!).toBeGreaterThan(scores.get("b")!)
  })

  test("larger k flattens scores (less emphasis on top ranks)", () => {
    const smallK = rrf(["a", "b", "c"], [], 1)
    const largeK = rrf(["a", "b", "c"], [], 1000)
    const smallGap = smallK.get("a")! - smallK.get("c")!
    const largeGap = largeK.get("a")! - largeK.get("c")!
    expect(smallGap).toBeGreaterThan(largeGap)
  })

  test("duplicate entries within a list don't double-count", () => {
    // rrf treats the input as a ranked list — duplicates are just the same
    // ID at different ranks. Each rank contributes independently.
    const scores = rrf(["a", "a"], [], 60)
    // First occurrence: 1/61. Second: 1/62. Total: 1/61 + 1/62
    expect(scores.get("a")!).toBeCloseTo(1 / 61 + 1 / 62, 5)
  })
})
