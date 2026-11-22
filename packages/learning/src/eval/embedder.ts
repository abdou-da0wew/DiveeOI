// packages/learning/src/eval/embedder.ts
//
// Pluggable query embedders for the eval harness (`tl:eval`).
//
//   real    → the pinned BGE-M3 teacher via the production pipeline
//             (embed/ensure.ts). Fails fast, BEFORE any question runs, with
//             the same clear message Setup uses when the model files are
//             absent — the harness must never silently fall back to an
//             empty dense leg.
//   student → the installed (promoted or explicit) compact student encoder
//             via embed/query-encoder.ts. Fails fast when no student
//             artifact is installed.
//   standin → a deterministic FNV-1a bag-of-words hash embedder. Works
//             offline / in CI with zero model files; the same pattern the
//             ingest tests use (test/ingest-turn.test.ts). Quality is NOT
//             comparable to bge-m3 (English-centric, no cross-lingual
//             transfer) — standin runs prove harness mechanics, never
//             promotion decisions.
//
// The teacher path mirrors scripts/freeze-selftest.ts: register a runtime,
// ensureEmbedder(), then Pipeline.embed per query.

import { Effect } from "effect"
import { getRuntime, modelDirFor, setRuntime } from "../runtime"
import { PINNED_MANIFEST } from "../manifest/pinned"
import { checkModelFiles, ensureEmbedder } from "../embed/ensure"
import { embed as teacherEmbed } from "../embed/pipeline"
import { studentStatus, embedWithStudent, type StudentManifest } from "../embed/query-encoder"
import type { EvalEmbedder } from "./types"

// ---------------------------------------------------------------------------
// Stand-in deterministic embedder (offline / CI)
// ---------------------------------------------------------------------------

export const STANDIN_DIMS = 1024

/**
 * Deterministic bag-of-words hash embedder. Same word → same bucket, so
 * cosine similarity tracks lexical overlap. L2-normalized. Not a semantic
 * model: it exists so the whole eval path runs without model weights.
 */
export const standinEmbed = (text: string, dims = STANDIN_DIMS): Float32Array => {
  const v = new Float32Array(dims)
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 2166136261
    for (const ch of w) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619)
    const bucket = Math.abs(h) % dims
    v[bucket] = (v[bucket] ?? 0) + 1
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
  return v.map((x) => x / n)
}

export const makeStandinEmbedder = (dims = STANDIN_DIMS): EvalEmbedder => ({
  name: "standin-hash",
  kind: "standin",
  dims,
  embed: async (text) => standinEmbed(text, dims),
})

/**
 * Degraded stand-in variant used to exercise the student-vs-teacher
 * comparison plumbing offline: coarse quantization of the stand-in vectors
 * mimics a weaker encoder without changing the harness code.
 */
export const makeDegradedStandinEmbedder = (dims = STANDIN_DIMS, steps = 2): EvalEmbedder => {
  const q = (x: number) => Math.round(x * steps) / steps
  return {
    name: `standin-quantized-${steps}`,
    kind: "custom",
    dims,
    embed: async (text) => {
      const v = standinEmbed(text, dims)
      let sq = 0
      const out = v.map((x) => {
        const y = q(x)
        sq += y * y
        return y
      })
      const n = Math.sqrt(sq) || 1
      return out.map((x) => x / n)
    },
  }
}

// ---------------------------------------------------------------------------
// Real embedders (teacher / student) — fail fast when weights are absent
// ---------------------------------------------------------------------------

/** Registers a minimal runtime so the real embedders can resolve the model dir
 * (freeze-selftest.ts pattern: a store-less runtime is enough for query embedding).
 * Never overwrites an already-registered runtime. */
export const ensureEvalRuntime = (dataDir: string): void => {
  if (getRuntime()) return
  setRuntime({
    dataDir,
    modelDir: modelDirFor(dataDir),
    booksStore: { db: null, available: false, unavailabilityReason: "eval harness (query embedding only)" },
    manifest: PINNED_MANIFEST,
  })
}

export const makeRealTeacherEmbedder = (userSettings?: Record<string, unknown>): EvalEmbedder => {
  // Fail fast BEFORE any question runs (checkModelFiles throws with the Setup message).
  const checked = checkModelFiles(userSettings)
  return {
    name: `bge-m3 teacher (${checked.signature.dtype})`,
    kind: "real",
    dims: 1024,
    embed: async (text) => {
      // init() is idempotent for the same config, so this is cheap after the first call.
      await Effect.runPromise(ensureEmbedder(userSettings))
      return await Effect.runPromise(teacherEmbed(text))
    },
  }
}

export const makeStudentEmbedder = (userSettings?: Record<string, unknown>): EvalEmbedder => {
  const runtime = getRuntime()
  if (!runtime) throw new Error("Targeted Learning runtime is not registered; pass --corpus <dataDir> for the student embedder.")
  const status = studentStatus(runtime.modelDir, runtime.manifest)
  if (!status.available || !status.manifest) {
    throw new Error(
      `student query encoder is not usable: ${status.reason ?? "no student model installed"}. ` +
        `Install a promoted student artifact (${status.dir}) or evaluate the teacher with --embedder real.`,
    )
  }
  const manifest = status.manifest as StudentManifest
  const dtype = manifest.dtype === "fp32" ? "fp32" : "int8"
  const maxLength = Number(manifest.maxLength ?? 128) || 128
  return {
    name: `student encoder (${manifest.name}, ${dtype})`,
    kind: "student",
    dims: manifest.dims,
    embed: async (text) => await embedWithStudent(runtime.modelDir, text, dtype, maxLength),
  }
}

// ---------------------------------------------------------------------------
// Spec parser for the CLI
// ---------------------------------------------------------------------------

export type EmbedderSpec = "real" | "teacher" | "student" | "standin" | (string & {})

export const makeEmbedderFromSpec = (
  spec: EmbedderSpec,
  opts: { dataDir?: string; userSettings?: Record<string, unknown> } = {},
): EvalEmbedder => {
  switch (spec) {
    case "standin":
      return makeStandinEmbedder()
    case "real":
    case "teacher": {
      if (opts.dataDir) ensureEvalRuntime(opts.dataDir)
      return makeRealTeacherEmbedder(opts.userSettings)
    }
    case "student": {
      if (opts.dataDir) ensureEvalRuntime(opts.dataDir)
      return makeStudentEmbedder(opts.userSettings)
    }
    default:
      throw new Error(
        `unknown embedder "${spec}" — supported: standin (offline), real (BGE-M3 teacher), student (installed compact encoder)`,
      )
  }
}
