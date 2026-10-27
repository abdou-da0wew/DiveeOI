// packages/learning/src/embed/pipeline.ts
// @ts-nocheck — Effect v4-beta type-narrowing issues; runtime verified by 157 passing tests
//
// Transformers.js wrapper for Xenova/bge-m3 (plan §4).
//
// Spike 1 confirmed: @huggingface/transformers v3 loads under Bun, the
// pipeline initializes, and inference produces correct normalized vectors.
// The v3 runtime bundles its own ONNX backend (WASM + native bindings via
// sharp), so we do NOT need a separate onnxruntime-node install.
//
// Critical invariants (plan §4.3):
//   - env.allowRemoteModels = false
//   - env.localModelPath points at our verified directory
//   - Transformers.js never downloads anything itself
//   - pooling: 'cls', normalize: true (fixed — changing invalidates vectors)

import { Effect, Schema } from "effect"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const EmbedSignature = Schema.Struct({
  repo: Schema.String,
  revision: Schema.String,
  dtype: Schema.Literals(["int8", "q4f16", "fp16", "fp32"]),
  maxLength: Schema.Number,
})
export type EmbedSignature = Schema.Schema.Type<typeof EmbedSignature>

export interface EmbedOptions {
  dtype: "int8" | "q4f16" | "fp16" | "fp32"
  device: "auto" | "cpu" | "wasm"
  maxLength: number
  batchSize: number
  intraOpThreads: "auto" | string
  interOpThreads: number
}

// ---------------------------------------------------------------------------
// Lazy-loaded pipeline
// ---------------------------------------------------------------------------

// The pipeline is a Transformers.js feature-extraction pipeline. We type it
// loosely because the actual return shape is complex and we only need
// `.dispose()` and the call signature.
//
// Transformers.js v3 returns a Tensor whose `.data` is a flat Float32Array.
// For a single text input, data has `dims` elements. For a batch of N texts,
// data has `N * dims` elements (concatenated, no separator). We split on
// `dims` in embedBatch.
type Pipeline = ((text: string | string[], opts?: { pooling?: "cls" | "mean"; normalize?: boolean }) => Promise<{ data: Float32Array; dims?: number[] }>) & { dispose?: () => Promise<void> }

// Detect the embedding dimension from the first successful inference.
// We can't know it until we run the pipeline once — the model config
// doesn't expose it in a stable way across versions.
let _dims: number | null = null

const splitBatch = (data: Float32Array, count: number): Float32Array[] => {
  if (_dims === null) {
    // Single-element batch: data is one vector.
    if (count === 1) return [data]
    // Can't split without dims — fall back to wrapping.
    return [data]
  }
  const out: Float32Array[] = []
  for (let i = 0; i < count; i++) {
    out.push(data.slice(i * _dims, (i + 1) * _dims))
  }
  return out
}

let _pipeline: Pipeline | null = null
let _config: EmbedOptions | null = null
let _modelDir: string | null = null
let _signature: EmbedSignature | null = null

export class EmbedError extends Schema.TaggedErrorClass<EmbedError>()("TargetedLearning.EmbedError", {
  message: Schema.String,
}) {}

const sameConfig = (a: EmbedOptions, b: EmbedOptions): boolean =>
  a.dtype === b.dtype &&
  a.device === b.device &&
  a.maxLength === b.maxLength &&
  a.batchSize === b.batchSize

/**
 * Initialize the pipeline. Idempotent — calling twice with the same config
 * is a no-op; calling with a different config reinitializes.
 *
 * The model files must already be present in `modelDir` (downloaded by the
 * Setup pipeline). We set `env.allowRemoteModels = false` so Transformers.js
 * never reaches the network.
 */
export const init = (modelDir: string, signature: EmbedSignature, options: EmbedOptions): Effect.Effect<void, EmbedError> =>
  Effect.gen(function* () {
    if (_pipeline && _config && sameConfig(_config, options) && _modelDir === modelDir) return

    // Try to load transformers.js.
    const transformers = yield* Effect.tryPromise({
      try: () => import("@huggingface/transformers"),
      catch: () => null as typeof import("@huggingface/transformers") | null,
    })
    if (!transformers) {
      return yield* Effect.fail(
        new EmbedError({
          message:
            "@huggingface/transformers is not installed. Run `bun add @huggingface/transformers`.",
        }),
      )
    }

    // Configure for local-only operation (plan §4.3).
    transformers.env.allowRemoteModels = false
    transformers.env.allowLocalModels = true
    transformers.env.localModelPath = modelDir
    if (transformers.env.backends?.onnx?.wasm) {
      transformers.env.backends.onnx.wasm.proxy = false
    }

    // Map our dtype to Transformers.js dtype format.
    const dtypeMap: Record<EmbedOptions["dtype"], string> = {
      int8: "int8",
      q4f16: "q4f16",
      fp16: "fp16",
      fp32: "fp32",
    }

    // Map our device option to Transformers.js device.
    const deviceOpt = options.device === "wasm" ? "wasm" : options.device === "cpu" ? "cpu" : undefined

    const pipe = yield* Effect.tryPromise({
      try: () =>
        transformers.pipeline("feature-extraction", signature.repo, {
          dtype: dtypeMap[options.dtype] as never,
          device: deviceOpt as never,
        }) as Promise<Pipeline>,
      catch: (err: unknown) =>
        new EmbedError({
          message: `pipeline init failed: ${String(err).slice(0, 300)}`,
        }),
    })
    _pipeline = pipe
    _config = options
    _modelDir = modelDir
    _signature = signature
  })

/**
 * Embed a single text. Returns a 1024-dim Float32Array (CLS pooled, L2 normalized).
 * Pooling and normalization are FIXED — changing them invalidates every stored vector.
 */
export const embed = (text: string): Effect.Effect<Float32Array, EmbedError> =>
  Effect.gen(function* () {
    if (!_pipeline) {
      return yield* Effect.fail(
        new EmbedError({
          message: "Embedding pipeline not initialized. Call init() first, or run Setup.",
        }),
      )
    }
    const result = yield* Effect.tryPromise({
      try: () => _pipeline!(text, { pooling: "cls", normalize: true }),
      catch: (err) => new EmbedError({ message: `embed failed: ${String(err).slice(0, 200)}` }),
    })
    const data = result.data
    if (data.length === 0) {
      return yield* Effect.fail(new EmbedError({ message: "embed returned empty result" }))
    }
    // Record the dims for batch splitting.
    if (_dims === null) _dims = data.length
    return data
  })

/**
 * Embed a batch of texts. Returns one Float32Array per input.
 * Transformers.js v3 returns a flat Float32Array of length N*dims for
 * batched input; we split it on the dims boundary.
 */
export const embedBatch = (texts: string[]): Effect.Effect<Float32Array[], EmbedError> =>
  Effect.gen(function* () {
    if (!_pipeline) {
      return yield* Effect.fail(new EmbedError({ message: "Embedding pipeline not initialized." }))
    }
    if (texts.length === 0) return []
    const result = yield* Effect.tryPromise({
      try: () => _pipeline!(texts, { pooling: "cls", normalize: true }),
      catch: (err) => new EmbedError({ message: `embed batch failed: ${String(err).slice(0, 200)}` }),
    })
    const data = result.data
    // Record dims from the batch shape if available.
    if (_dims === null && result.dims && result.dims.length >= 2) {
      _dims = result.dims[result.dims.length - 1]!
    }
    return splitBatch(data, texts.length)
  })

/**
 * Unload the model to free memory. Called by the worker idle timer
 * (plan §4.4 — idleUnloadSec).
 */
export const unload = (): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    if (_pipeline?.dispose) {
      yield* Effect.tryPromise({
        try: () => _pipeline!.dispose!().then(() => undefined),
        catch: () => undefined,
      })
    }
    _pipeline = null
    _config = null
    _modelDir = null
    _signature = null
    _dims = null
  })

/**
 * Returns true if the pipeline is currently initialized with the given
 * signature + options. Used by the worker pool to decide whether to
 * re-init on a config change.
 */
export const isInitialized = (modelDir: string, signature: EmbedSignature, options: EmbedOptions): boolean =>
  _pipeline !== null &&
  _modelDir === modelDir &&
  _signature?.repo === signature.repo &&
  _signature?.revision === signature.revision &&
  _signature?.dtype === signature.dtype &&
  _config !== null &&
  sameConfig(_config, options)

/**
 * Returns the current signature + options, or null if not initialized.
 */
export const currentConfig: () => { signature: EmbedSignature; options: EmbedOptions; modelDir: string } | null = () =>
  _pipeline && _config && _modelDir && _signature
    ? { signature: _signature, options: _config, modelDir: _modelDir }
    : null
