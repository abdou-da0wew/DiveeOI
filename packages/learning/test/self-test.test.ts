// packages/learning/test/self-test.test.ts
//
// Unit tests for the golden self-test cosine helpers and b64 round-trip
// (plan §5.1.6). The actual self-test against frozen vectors lives in
// self-test-frozen.test.ts and only runs after `tl:selftest:freeze`.

import { expect, test, describe } from "bun:test"
import { cosine, vectorToB64, b64ToVector, GOLDEN_CASES } from "../src/self-test"

describe("self-test helpers", () => {
  test("cosine of identical vectors is 1", () => {
    const a = new Float32Array([1, 2, 3, 4])
    expect(cosine(a, a)).toBeCloseTo(1, 5)
  })

  test("cosine of orthogonal vectors is 0", () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    expect(cosine(a, b)).toBeCloseTo(0, 5)
  })

  test("cosine of opposite vectors is -1", () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([-1, -2, -3])
    expect(cosine(a, b)).toBeCloseTo(-1, 5)
  })

  test("cosine throws on length mismatch", () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([1, 2])
    expect(() => cosine(a, b)).toThrow(/length mismatch/)
  })

  test("b64 round-trip preserves the vector", () => {
    const original = new Float32Array([0.1, 0.2, 0.3, -0.5, 1.0])
    const b64 = vectorToB64(original)
    const decoded = b64ToVector(b64, original.length)
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBeCloseTo(original[i]!, 5)
    }
  })

  test("GOLDEN_CASES has at least one Arabic and one English case", () => {
    const ar = GOLDEN_CASES.filter((c) => c.language === "ar")
    const en = GOLDEN_CASES.filter((c) => c.language === "en")
    expect(ar.length).toBeGreaterThan(0)
    expect(en.length).toBeGreaterThan(0)
  })

  test("GOLDEN_CASES includes a cross-lingual pair (closerTo + furtherFrom)", () => {
    const pairs = GOLDEN_CASES.filter((c) => c.closerTo && c.furtherFrom)
    expect(pairs.length).toBeGreaterThan(0)
  })

  test("every case has non-empty text", () => {
    for (const c of GOLDEN_CASES) {
      expect(c.text.length).toBeGreaterThan(10)
    }
  })
})
