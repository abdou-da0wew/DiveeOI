// packages/learning/test/embed-pipeline.test.ts
//
// Live integration test for the Transformers.js embed pipeline.
// Uses the tiny Xenova/all-MiniLM-L6-v2 model (23MB, 384-dim) instead of
// bge-m3 (568MB, 1024-dim) to keep the test fast and download-light.
//
// This test downloads the model from HuggingFace on first run — it's a
// SPIKE-VERIFICATION test, not a unit test. Skip in CI by setting
// SKIP_LIVE_EMBED=1.

import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Pipeline from "../src/embed/pipeline"

const SKIP = process.env.SKIP_LIVE_EMBED === "1"

const tempDir = mkdtempSync(join(tmpdir(), "tl-embed-"))
// Use the tiny model for the test — bge-m3 is too big for CI.
const SIGNATURE = Pipeline.EmbedSignature.make({
  repo: "Xenova/all-MiniLM-L6-v2",
  revision: "main", // test only; real setup pins a SHA
  dtype: "fp32",
  maxLength: 256,
})
const OPTIONS: Pipeline.EmbedOptions = {
  dtype: "fp32",
  device: "auto",
  maxLength: 256,
  batchSize: 8,
  intraOpThreads: "auto",
  interOpThreads: 1,
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

// Pipeline.init() is local-only by design, so the fixture must materialise the model files
// into tempDir first. A throwaway remote-enabled pipeline downloads them with transformers.js'
// own resolution logic (cacheDir == tempDir so init's localModelPath lookup finds them).
beforeAll(async () => {
  if (SKIP) return
  const transformers = await import("@huggingface/transformers")
  transformers.env.allowRemoteModels = true
  transformers.env.allowLocalModels = false
  transformers.env.cacheDir = tempDir
  const pre = await transformers.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" })
  await pre.dispose?.()
}, 120_000)

describe.skipIf(SKIP)("embed pipeline (live)", () => {
  test("init + embed + batch + unload", async () => {
    // Allow remote models for this test only (the real Setup downloads to localModelPath first).
    const transformers = await import("@huggingface/transformers")
    transformers.env.allowRemoteModels = true
    transformers.env.allowLocalModels = true
    transformers.env.localModelPath = tempDir

    // Init
    await Effect.runPromise(Pipeline.init(tempDir, SIGNATURE, OPTIONS))
    expect(Pipeline.currentConfig()).not.toBeNull()

    // Single embed
    const vec = await Effect.runPromise(Pipeline.embed("hello world"))
    expect(vec).toBeInstanceOf(Float32Array)
    expect(vec.length).toBe(384) // all-MiniLM-L6-v2 is 384-dim

    // Vector is L2-normalized (sum of squares ≈ 1)
    let sumSquares = 0
    for (let i = 0; i < vec.length; i++) sumSquares += vec[i]! * vec[i]!
    expect(sumSquares).toBeCloseTo(1, 3)

    // Batch embed
    const batch = await Effect.runPromise(Pipeline.embedBatch(["hello", "world", "foo"]))
    expect(batch.length).toBe(3)
    for (const v of batch) {
      expect(v.length).toBe(384)
    }

    // Similar sentences have higher cosine than dissimilar
    const cat = await Effect.runPromise(Pipeline.embed("a cat sat on the mat"))
    const dog = await Effect.runPromise(Pipeline.embed("a dog sat on the mat"))
    const math = await Effect.runPromise(Pipeline.embed("the integral of x squared"))
    const cos = (a: Float32Array, b: Float32Array) => {
      let dot = 0, na = 0, nb = 0
      for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!
        na += a[i]! * a[i]!
        nb += b[i]! * b[i]!
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb))
    }
    expect(cos(cat, dog)).toBeGreaterThan(cos(cat, math))

    // Unload
    await Effect.runPromise(Pipeline.unload())
    expect(Pipeline.currentConfig()).toBeNull()
  }, 60_000) // 60s timeout for model download + inference
})

// ---------------------------------------------------------------------------
// Error surfacing (sprint 2, T5): pipeline failures must reach the caller as
// typed EmbedErrors — the embed error channel is what the ingest job persists
// as the book error, so a silent null here becomes an "error":"null" record
// in the UI (the 2026-11-09 incident). These tests run offline; they do not
// need the model fixture.
// ---------------------------------------------------------------------------

describe("embed pipeline error surfacing", () => {
  const transformersEnv = async () => (await import("@huggingface/transformers")).env
  const ENV_KEYS = ["allowRemoteModels", "allowLocalModels", "localModelPath"] as const
  let savedEnv: Record<string, unknown> = {}
  let emptyModelDir = ""

  beforeEach(async () => {
    const env = await transformersEnv()
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, (env as Record<string, unknown>)[key]]))
    emptyModelDir = mkdtempSync(join(tmpdir(), "tl-embed-hardening-"))
  })

  afterEach(async () => {
    await Effect.runPromise(Pipeline.unload()) // leave the module state clean for other tests
    const env = await transformersEnv()
    for (const key of ENV_KEYS) (env as Record<string, unknown>)[key] = savedEnv[key]
    rmSync(emptyModelDir, { recursive: true, force: true })
  })

  test("embed before init fails with a typed EmbedError (never a silent null)", async () => {
    await Effect.runPromise(Pipeline.unload())
    expect(Pipeline.currentConfig()).toBeNull()
    try {
      await Effect.runPromise(Pipeline.embed("hello world"))
      expect.unreachable()
    } catch (err) {
      const e = err as { _tag?: string; message?: string }
      expect(e._tag).toBe("TargetedLearning.EmbedError")
      expect(e.message).toContain("not initialized")
    }
  })

  test("embedBatch before init fails with a typed EmbedError", async () => {
    await Effect.runPromise(Pipeline.unload())
    try {
      await Effect.runPromise(Pipeline.embedBatch(["a", "b"]))
      expect.unreachable()
    } catch (err) {
      const e = err as { _tag?: string; message?: string }
      expect(e._tag).toBe("TargetedLearning.EmbedError")
      expect(e.message).toContain("not initialized")
    }
  })

  test("init with a missing local model fails with a typed EmbedError carrying the cause", async () => {
    // allowRemoteModels=false keeps this fully offline: the pipeline factory fails because
    // the model is not present in the (empty) local model dir, and that failure must
    // surface as EmbedError("pipeline init failed: …") rather than a null.
    const env = await transformersEnv()
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = emptyModelDir
    try {
      await Effect.runPromise(Pipeline.init(emptyModelDir, SIGNATURE, OPTIONS))
      expect.unreachable()
    } catch (err) {
      const e = err as { _tag?: string; message?: string }
      expect(e._tag).toBe("TargetedLearning.EmbedError")
      expect(e.message).toContain("pipeline init failed")
    }
  }, 30_000)
})
