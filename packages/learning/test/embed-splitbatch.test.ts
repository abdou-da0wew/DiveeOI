// packages/learning/test/embed-splitbatch.test.ts
//
// Unit tests for embed/pipeline.ts splitBatch (sprint 2, task 4-j).
//
// 4-a's observation, verified: with `_dims === null` on a MULTI-text batch,
// splitBatch returned `[data]` — one vector for N texts. transformers.js v3
// always carries tensor metadata so the edge was latent, but the ingest
// rejects vector-count mismatches (run.ts "embedder returned N vectors for M
// passages") and a fresh worker's first batch would have failed the book.
// The fix: derive the per-vector size from the buffer shape when dims are
// unknown, and return null (→ typed EmbedError in embedBatch) when the buffer
// cannot be tiled exactly instead of returning a corrupt single vector.

import { describe, expect, test } from "bun:test"
import { splitBatch } from "../src/embed/pipeline"

const vec = (n: number) => Float32Array.from({ length: n }, (_, i) => i + 1)

describe("embed pipeline splitBatch (the 4-a `_dims` null edge)", () => {
  test("single-text batch returns the buffer untouched", () => {
    const data = vec(8)
    expect(splitBatch(data, 1, null)).toEqual([data])
    expect(splitBatch(data, 1, 8)).toEqual([data])
    expect(splitBatch(data, 0, null)).toEqual([data])
  })

  test("multi-text batch with recorded dims splits into per-text vectors", () => {
    const out = splitBatch(vec(3 * 4), 3, 4)
    expect(out).not.toBeNull()
    expect(out!.length).toBe(3)
    expect(out!.every((v) => v.length === 4)).toBe(true)
    expect(Array.from(out![0]!)).toEqual([1, 2, 3, 4])
    expect(Array.from(out![2]!)).toEqual([9, 10, 11, 12])
  })

  test("multi-text batch WITHOUT recorded dims derives the vector size from the buffer shape", () => {
    // First batch of a freshly initialized pipeline: `_dims` is null and
    // (defensively) no tensor metadata arrived — the old code returned ONE
    // vector for 4 texts, which the ingest rejects as a count mismatch.
    const out = splitBatch(vec(4 * 384), 4, null)
    expect(out).not.toBeNull()
    expect(out!.length).toBe(4)
    expect(out!.every((v) => v.length === 384)).toBe(true)
  })

  test("a buffer that cannot be tiled exactly returns null instead of a corrupt vector", () => {
    expect(splitBatch(vec(10), 3, null)).toBeNull() // 10 floats are not 3 whole vectors
    expect(splitBatch(vec(9), 3, 4)).toBeNull() // recorded dims disagree with the shape
    expect(splitBatch(new Float32Array(0), 2, null)).toBeNull() // empty batch buffer
  })
})
