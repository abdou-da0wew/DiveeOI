// packages/learning/src/setup/steps.ts
//
// The real setup steps that exercise the downloaded model (plan §5.1 steps 5-7).
// None of them can pass without the pinned bge-m3 files on disk.

import { Effect } from "effect"
import { ensureEmbedder } from "../embed/ensure"
import { EmbedError, embed, embedBatch } from "../embed/pipeline"

type Tree = Record<string, unknown>

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

/** Step 5: load the runtime + model and run one inference. */
export const runtimeCheck = (settings?: Tree) =>
  Effect.gen(function* () {
    const options = yield* ensureEmbedder(settings)
    const vec = yield* embed("runtime check")
    if (vec.length !== 1024) {
      return yield* Effect.fail(new EmbedError({ message: `unexpected embedding size ${vec.length} (expected 1024)` }))
    }
    return { ok: true, vectorLength: vec.length, dtype: options.dtype, device: options.device }
  })

/**
 * Step 6: semantic self-test. Does not need frozen reference vectors: it checks
 * that vectors are unit-length and that an Arabic question is closer to its
 * English translation than to an unrelated sentence.
 */
export const semanticSelfTest = (settings?: Tree) =>
  Effect.gen(function* () {
    yield* ensureEmbedder(settings)
    const [en, ar, off] = yield* embedBatch([
      "What is photosynthesis?",
      "ما هي عملية البناء الضوئي؟",
      "The football match ended two to one.",
    ])
    if (!en || !ar || !off) return yield* Effect.fail(new EmbedError({ message: "self-test: missing vectors" }))
    const norm = Math.sqrt(dot(en, en))
    const crossLingual = dot(en, ar)
    const unrelated = dot(en, off)
    if (Math.abs(norm - 1) > 0.02) {
      return yield* Effect.fail(new EmbedError({ message: `self-test: vectors not normalized (norm ${norm.toFixed(3)})` }))
    }
    if (!(crossLingual > unrelated)) {
      return yield* Effect.fail(
        new EmbedError({
          message: `self-test: Arabic/English similarity ${crossLingual.toFixed(3)} is not above unrelated ${unrelated.toFixed(3)}`,
        }),
      )
    }
    return { ok: true, norm, crossLingual, unrelated }
  })

/** Step 7: embed throughput and memory on this machine (single process). */
export const benchmark = (settings?: Tree) =>
  Effect.gen(function* () {
    const options = yield* ensureEmbedder(settings)
    const sample =
      "Photosynthesis converts light energy into chemical energy stored in glucose, using water and carbon dioxide."
    const texts = Array.from({ length: 32 }, (_, i) => `${sample} (${i})`)
    const started = Date.now()
    for (let i = 0; i < texts.length; i += options.batchSize) {
      yield* embedBatch(texts.slice(i, i + options.batchSize))
    }
    const seconds = Math.max((Date.now() - started) / 1000, 0.001)
    return {
      chunksPerSec: Math.round((texts.length / seconds) * 10) / 10,
      workers: 1,
      peakRssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      batchSize: options.batchSize,
    }
  })
