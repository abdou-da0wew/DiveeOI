// packages/learning/src/embed/query-encoder.ts
//
// Query-time encoder selection ("index and forget", RETRIEVAL_V2_PLAN.md).
//
// BGE-M3 (the teacher) embeds book chunks while indexing. Chat only needs to embed a short
// question into the SAME 1024-d CLS-pooled, L2-normalised space, which a small distilled student
// can do in tens of MB instead of ~570 MB. This module decides which encoder serves a chat turn
// and keeps the teacher out of memory when it is not needed.
//
// Student model directory (under the Targeted Learning model dir):
//   divee-query-student/
//     divee-student.json        manifest (see StudentManifest)
//     config.json, tokenizer*.json, special_tokens_map.json
//     onnx/model_int8.onnx      outputs `last_hidden_state` [B, T, 1024]; pooled with CLS + L2 by the pipeline
//
// The student is only used automatically after it has been promoted (manifest.promoted), i.e. after
// it passed the evaluation gates against the teacher. Forcing it via settings skips that check but
// never skips the vector-space compatibility checks.

import { existsSync, readFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { getRuntime } from "../runtime"
import { withDefaults } from "../settings/defaults"
import { checkModelFiles, ensureEmbedder } from "./ensure"
import { embed as teacherEmbed, unload as unloadTeacher } from "./pipeline"

type Tree = Record<string, unknown>

export type QueryEncoderChoice = "auto" | "student" | "bge-m3"
export type ResolvedEncoder = "student" | "bge-m3" | "none"

export const STUDENT_DIR_NAME = "divee-query-student"
export const STUDENT_MANIFEST_FILE = "divee-student.json"
export const STUDENT_ONNX_FILE = "model_int8.onnx"
export const VECTOR_DIMS = 1024

export interface StudentManifest {
  format: 1
  name: string
  dims: number
  teacherRepo: string
  teacherRevision: string
  dtype: "int8"
  maxLength: number
  /** True only after the evaluation gates passed; required for `auto`. */
  promoted: boolean
  /** Gate thresholds re-calibrated on student scores (cosine(student query, teacher passage) is lower than teacher-vs-teacher). */
  gate?: { minDenseScore?: number; minFusedScore?: number }
  eval?: Record<string, unknown>
}

export interface StudentStatus {
  available: boolean
  reason?: string
  manifest?: StudentManifest
  dir: string
}

export interface Resolution {
  choice: QueryEncoderChoice
  encoder: ResolvedEncoder
  reason: string
  gate?: { minDenseScore?: number; minFusedScore?: number }
}

const studentRoot = (modelDir: string) => path.join(modelDir, STUDENT_DIR_NAME)

/** Validates the student on disk without loading it. Pure file checks. */
export const studentStatus = (modelDir: string, teacher: { repo: string; revision: string }): StudentStatus => {
  const dir = studentRoot(modelDir)
  const fail = (reason: string): StudentStatus => ({ available: false, reason, dir })
  const manifestPath = path.join(dir, STUDENT_MANIFEST_FILE)
  if (!existsSync(manifestPath)) return fail("no student model installed")
  let manifest: StudentManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as StudentManifest
  } catch {
    return fail("student manifest is unreadable")
  }
  if (manifest.format !== 1) return fail(`unsupported student manifest format ${String(manifest.format)}`)
  if (manifest.dims !== VECTOR_DIMS) return fail(`student emits ${String(manifest.dims)} dimensions, expected ${VECTOR_DIMS}`)
  if (manifest.teacherRepo !== teacher.repo || manifest.teacherRevision !== teacher.revision)
    return fail("student was distilled from a different teacher revision; its vectors are not compatible with the index")
  if (!existsSync(path.join(dir, "onnx", STUDENT_ONNX_FILE))) return fail("student ONNX file is missing")
  if (!existsSync(path.join(dir, "tokenizer.json"))) return fail("student tokenizer is missing")
  return { available: true, manifest, dir }
}

/** Decide which encoder serves chat. No model is loaded here. */
export const resolveEncoder = (userSettings?: Tree): Resolution => {
  const retrieval = (withDefaults(userSettings).retrieval ?? {}) as Tree
  const raw = String(retrieval.queryEncoder ?? "auto")
  const choice: QueryEncoderChoice = raw === "student" || raw === "bge-m3" ? raw : "auto"
  const runtime = getRuntime()
  if (!runtime) return { choice, encoder: "none", reason: "Targeted Learning is not running" }

  const student = studentStatus(runtime.modelDir, runtime.manifest)
  const teacherReady = (() => {
    try {
      checkModelFiles(userSettings)
      return true
    } catch {
      return false
    }
  })()
  const studentGate = student.manifest?.gate

  if (choice === "bge-m3") {
    return teacherReady
      ? { choice, encoder: "bge-m3", reason: "bge-m3 selected in settings" }
      : { choice, encoder: "none", reason: "bge-m3 model is not downloaded" }
  }
  if (choice === "student") {
    if (student.available) return { choice, encoder: "student", reason: "student selected in settings", gate: studentGate }
    if (teacherReady) return { choice, encoder: "bge-m3", reason: `student unavailable (${student.reason}); using bge-m3` }
    return { choice, encoder: "none", reason: `student unavailable (${student.reason}) and bge-m3 is not downloaded` }
  }
  // auto: only a promoted student replaces the teacher.
  if (student.available && student.manifest?.promoted)
    return { choice, encoder: "student", reason: "promoted student model", gate: studentGate }
  if (teacherReady)
    return {
      choice,
      encoder: "bge-m3",
      reason: student.available ? "student installed but not promoted" : `no student (${student.reason})`,
    }
  return { choice, encoder: "none", reason: "no query encoder is installed" }
}

// ---------------------------------------------------------------------------
// Student session (own state: it must never share the teacher singleton)
// ---------------------------------------------------------------------------

type StudentPipeline = ((text: string, opts: { pooling: "cls"; normalize: true }) => Promise<{ data: Float32Array }>) & {
  dispose?: () => Promise<unknown>
}
let studentPipe: StudentPipeline | null = null
let studentLoading: Promise<StudentPipeline> | null = null
let studentDir: string | null = null

const loadStudent = async (modelDir: string): Promise<StudentPipeline> => {
  if (studentPipe && studentDir === modelDir) return studentPipe
  if (studentLoading && studentDir === modelDir) return studentLoading
  studentDir = modelDir
  studentLoading = (async () => {
    const transformers = await import("@huggingface/transformers")
    transformers.env.allowRemoteModels = false
    transformers.env.allowLocalModels = true
    transformers.env.localModelPath = modelDir
    // The student is tiny: two threads are plenty for a ~20-token query and keep chat latency predictable.
    const intraOpNumThreads = Math.max(1, Math.min(2, availableParallelism()))
    const pipe = (await transformers.pipeline("feature-extraction", STUDENT_DIR_NAME, {
      dtype: "int8" as never,
      session_options: { intraOpNumThreads, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false } as never,
    })) as unknown as StudentPipeline
    studentPipe = pipe
    return pipe
  })().finally(() => {
    studentLoading = null
  })
  return studentLoading
}

export const unloadStudent = async () => {
  const pipe = studentPipe
  studentPipe = null
  studentLoading = null
  studentDir = null
  await pipe?.dispose?.().catch(() => undefined)
}

export const embedWithStudent = async (modelDir: string, text: string): Promise<Float32Array> => {
  const pipe = await loadStudent(modelDir)
  const out = await pipe(text, { pooling: "cls", normalize: true })
  if (out.data.length !== VECTOR_DIMS)
    throw new Error(`student produced ${out.data.length} dimensions, expected ${VECTOR_DIMS}`)
  return out.data
}

// ---------------------------------------------------------------------------
// Chat entry point
// ---------------------------------------------------------------------------

export interface PreparedEncoder {
  ready: boolean
  encoder: ResolvedEncoder
  reason: string
  /** Calibrated gate thresholds for this encoder, when it ships its own. */
  gate?: { minDenseScore?: number; minFusedScore?: number }
  embed: (query: string) => Promise<Float32Array | null>
}

/**
 * Resolve the encoder for one chat turn and bring up only that encoder. A student failure at load
 * time falls back to the teacher (when installed) instead of failing the turn.
 */
export const prepareQueryEncoder = async (userSettings?: Tree): Promise<PreparedEncoder> => {
  const resolution = resolveEncoder(userSettings)
  const runtime = getRuntime()
  const none = (reason: string): PreparedEncoder => ({
    ready: false,
    encoder: "none",
    reason,
    embed: async () => null,
  })
  if (resolution.encoder === "none" || !runtime) return none(resolution.reason)

  const useTeacher = async (reason: string): Promise<PreparedEncoder> => {
    const ok = await Effect.runPromise(ensureEmbedder(userSettings).pipe(Effect.map(() => true), Effect.orElseSucceed(() => false)))
    if (!ok) return none(`${reason}; bge-m3 is not ready`)
    return {
      ready: true,
      encoder: "bge-m3",
      reason,
      embed: (query) => Effect.runPromise(teacherEmbed(query).pipe(Effect.orElseSucceed(() => null))),
    }
  }

  if (resolution.encoder === "bge-m3") return useTeacher(resolution.reason)

  try {
    await loadStudent(runtime.modelDir)
  } catch (error) {
    return useTeacher(`student failed to load (${String(error).slice(0, 120)})`)
  }
  return {
    ready: true,
    encoder: "student",
    reason: resolution.reason,
    gate: resolution.gate,
    embed: async (query) => {
      try {
        return await embedWithStudent(runtime.modelDir, query)
      } catch {
        return null
      }
    },
  }
}

/** True when a different chat-time encoder than the teacher is configured, so the teacher can be freed. */
export const teacherNeededForChat = (userSettings?: Tree) => resolveEncoder(userSettings).encoder !== "student"

/**
 * Index-and-forget: free the teacher once indexing is finished, unless chat itself is configured to
 * use it. `activeJobs` is the number of queued/running ingest jobs.
 */
export const releaseTeacherAfterIndexing = async (userSettings: Tree | undefined, activeJobs: number) => {
  const retrieval = (withDefaults(userSettings).retrieval ?? {}) as Tree
  if (retrieval.unloadTeacherAfterIndexing === false) return false
  if (activeJobs > 0) return false
  if (teacherNeededForChat(userSettings)) return false
  await Effect.runPromise(unloadTeacher())
  return true
}
