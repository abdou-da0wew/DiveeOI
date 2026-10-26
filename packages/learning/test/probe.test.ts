// packages/learning/test/probe.test.ts
//
// Unit tests for the system probe (plan §5.1.1). These run on whatever
// host `bun test` is running on; we test that the probe returns the
// expected shape and that the recommended profile makes sense for the
// host's resources.

import { expect, test, describe } from "bun:test"
import { Effect } from "effect"
import { probe } from "../src/probe"
import os from "node:os"

describe("probe", () => {
  test("returns a complete result for the host's data dir", async () => {
    const result = await Effect.runPromise(probe(os.tmpdir()))
    expect(result.platform).toMatch(/^(linux|darwin|win32|other)$/)
    expect(result.arch).toMatch(/^(x64|arm64|ia32|arm|other)$/)
    expect(result.cpuCores).toBeGreaterThan(0)
    expect(result.totalMemoryMB).toBeGreaterThan(0)
    expect(typeof result.dataDirWritable).toBe("boolean")
    expect(["low", "balanced", "high"]).toContain(result.recommendedProfile)
  })

  test("detects libc correctly on Linux", async () => {
    const result = await Effect.runPromise(probe(os.tmpdir()))
    if (result.platform === "linux") {
      expect(["glibc", "musl"]).toContain(result.libc)
    } else if (result.platform === "darwin") {
      expect(result.libc).toBe("darwin")
    }
  })

  test("AVX fields are present", async () => {
    const result = await Effect.runPromise(probe(os.tmpdir()))
    expect(typeof result.avx.avx).toBe("boolean")
    expect(typeof result.avx.avx2).toBe("boolean")
    expect(typeof result.avx.avx512).toBe("boolean")
  })

  test("wasmFallbackRecommended is true when AVX is missing on x64", async () => {
    const result = await Effect.runPromise(probe(os.tmpdir()))
    if (result.arch === "x64" && !result.avx.avx) {
      expect(result.wasmFallbackRecommended).toBe(true)
    }
  })

  test("wasmFallbackRecommended is true on musl", async () => {
    const result = await Effect.runPromise(probe(os.tmpdir()))
    if (result.libc === "musl") {
      expect(result.wasmFallbackRecommended).toBe(true)
    }
  })

  test("recommendedProfile is low when wasmFallbackRecommended", async () => {
    const result = await Effect.runPromise(probe(os.tmpdir()))
    if (result.wasmFallbackRecommended) {
      expect(result.recommendedProfile).toBe("low")
    }
  })
})
