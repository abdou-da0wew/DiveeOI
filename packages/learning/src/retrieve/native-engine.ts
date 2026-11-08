// packages/learning/src/retrieve/native-engine.ts
//
// Client for the Rust retrieval engine (`native/retrieval`, RETRIEVAL_V2_PLAN.md §5).
//
// The engine owns the hot path: SQLite FTS5 BM25, exact cosine over the stored vectors, RRF.
// It runs as one long-lived child process in `--serve` mode (NDJSON over stdin/stdout) so a chat
// turn does not pay a process spawn plus a database open, and the vector math never touches the
// JavaScript heap.
//
// This module is deliberately best-effort: every failure (binary missing, spawn error, timeout,
// malformed response, engine crash) returns `null` and the caller falls back to the TypeScript
// implementation in `hybrid.ts`. A missing or broken engine must never fail a turn.
//
// The binary is looked up from, in order:
//   1. `DIVEEOI_RETRIEVAL_BIN` (absolute path; set this in deployments)
//   2. `<repo>/packages/learning/native/retrieval/target/{release,debug}/divee-retrieval`
//   3. `<cwd>/packages/learning/native/retrieval/target/release/divee-retrieval`

import { accessSync, constants } from "node:fs"
import path from "node:path"
import { getRuntime } from "../runtime"
import { logDiagnostic } from "../diagnostics"

export const NATIVE_BIN_ENV = "DIVEEOI_RETRIEVAL_BIN"
export const NATIVE_BIN_NAME = "divee-retrieval"

/** One fused hit as returned by the engine (`Hit` in main.rs). */
export interface NativeHit {
  chunk_id: string
  book_id: string
  section_id: string
  page: number | null
  text: string
  bm25_score: number | null
  dense_score: number | null
  fused_score: number
}

export interface NativeResult {
  hits: NativeHit[]
  /** Best cosine score seen during the dense scan, before fusion truncation (the gate uses it). */
  bestDenseScore: number
  /** Best fused score before the final top-K cut (the gate uses it). */
  bestFusedScore: number
  elapsedMs: number
  /** Which encoder served the query: "student" | "none" (BM25-only fallback). */
  encoder?: string
  /** True when the engine served the turn without its student model (BM25-only fallback). */
  fallback: boolean
}

export interface NativeQuery {
  query: string
  books: string[]
  vector: Float32Array | null
  /** Final number of fused hits. */
  limit: number
  /** Lexical candidates kept before fusion (`retrieval.bm25TopK`). */
  bm25Limit: number
  /** Dense candidates kept before fusion (`retrieval.denseTopK`). */
  denseLimit: number
  rrfK: number
  bm25Weight: number
  denseWeight: number
}

export type NativeEngineSetting = "auto" | "native" | "typescript"

export interface NativeEngineOptions {
  /** `retrieval.engine`. `typescript` disables the engine entirely. */
  engine?: NativeEngineSetting
  /** books.db path; defaults to `<dataDir>/books.db` of the live runtime. */
  dbPath?: string
  timeoutMs?: number
  /** Test seam: use this binary instead of the lookup below. */
  binary?: string
}

/** Structural view of Bun's FileSink, so the client does not depend on Bun's DOM typings. */
interface StdinSink {
  write(chunk: string): number | Promise<number>
  flush(): number | Promise<number>
}

interface Session {
  child: ReturnType<typeof Bun.spawn>
  stdin: StdinSink
  pending: Map<number, { resolve: (value: NativeResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>
  buffer: string
  closed: boolean
  dbPath: string
  binary: string
}

const DEFAULT_TIMEOUT_MS = 4_000
/** After a failure, do not respawn for this long (one broken turn must not slow every turn). */
const FAILURE_COOLDOWN_MS = 30_000

let session: Session | null = null
let nextId = 1
let cachedBinary: string | null | undefined
let blockedUntil = 0
let lastFailure: string | null = null

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

const binaryCandidates = (): string[] => {
  const out: string[] = []
  const override = process.env[NATIVE_BIN_ENV]
  if (override) out.push(override)
  // import.meta.dir = <repo>/packages/learning/src/retrieve
  const here = import.meta.dir
  for (const profile of ["release", "debug"]) {
    out.push(path.join(here, "..", "..", "native", "retrieval", "target", profile, NATIVE_BIN_NAME))
  }
  out.push(path.join(process.cwd(), "packages", "learning", "native", "retrieval", "target", "release", NATIVE_BIN_NAME))
  return out
}

/** Absolute path of a runnable engine binary, or null. Cached after the first lookup. */
export const locateNativeEngine = (override?: string): string | null => {
  if (override) return isExecutable(override) ? path.resolve(override) : null
  if (cachedBinary !== undefined) return cachedBinary
  cachedBinary = binaryCandidates().find(isExecutable) ?? null
  return cachedBinary
}

const isExecutable = (candidate: string): boolean => {
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Path of books.db for the live runtime, or null when Targeted Learning is not running. */
export const booksDbPath = (): string | null => {
  const env = process.env.DIVEEOI_TL_DATA_DIR
  if (env) return path.join(env, "books.db")
  const runtime = getRuntime()
  return runtime ? path.join(runtime.dataDir, "books.db") : null
}

// ---------------------------------------------------------------------------
// Process lifecycle
// ---------------------------------------------------------------------------

const teardown = (closing: Session, error: Error) => {
  if (closing.closed) return
  closing.closed = true
  if (session === closing) session = null
  for (const [, pending] of closing.pending) {
    clearTimeout(pending.timer)
    pending.reject(error)
  }
  closing.pending.clear()
  try {
    closing.child.kill()
  } catch {
    // already gone
  }
}

const deliver = (current: Session, line: string) => {
  let parsed: { id?: number; hits?: NativeHit[]; best_dense_score?: number; best_fused_score?: number; elapsed_ms?: number; error?: string; encoder?: string; fallback?: boolean }
  try {
    parsed = JSON.parse(line)
  } catch {
    logDiagnostic("retrieval", "native.bad-response", { line: line.slice(0, 200) }, "warn")
    return
  }
  const id = typeof parsed.id === "number" ? parsed.id : undefined
  if (id === undefined) return
  const pending = current.pending.get(id)
  if (!pending) return
  current.pending.delete(id)
  clearTimeout(pending.timer)
  if (parsed.error) {
    pending.reject(new Error(parsed.error))
    return
  }
  pending.resolve({
    hits: Array.isArray(parsed.hits) ? parsed.hits : [],
    bestDenseScore: Number(parsed.best_dense_score ?? 0),
    bestFusedScore: Number(parsed.best_fused_score ?? 0),
    elapsedMs: Number(parsed.elapsed_ms ?? 0),
    // The engine flags BM25-only turns: the student model is missing, degraded, or in its
    // retry cooldown. Callers use this to keep the fallback chain honest.
    encoder: typeof parsed.encoder === "string" ? parsed.encoder : undefined,
    fallback: parsed.fallback === true,
  })
}

const pump = (current: Session) => {
  void (async () => {
    const decoder = new TextDecoder()
    const reader = (current.child.stdout as unknown as ReadableStream<Uint8Array>).getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        current.buffer += decoder.decode(value, { stream: true })
        let index = current.buffer.indexOf("\n")
        while (index >= 0) {
          const line = current.buffer.slice(0, index).trim()
          current.buffer = current.buffer.slice(index + 1)
          if (line.length > 0) deliver(current, line)
          index = current.buffer.indexOf("\n")
        }
      }
    } catch {
      // treated as a closed engine below
    }
    teardown(current, new Error("native retrieval engine exited"))
  })()
  // Drain stderr so a chatty engine can never block on a full pipe.
  void (async () => {
    try {
      const reader = (current.child.stderr as unknown as ReadableStream<Uint8Array>).getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
    } catch {
      // ignored
    }
  })()
}

const start = (binary: string, dbPath: string): Session => {
  const child = Bun.spawn([binary, "--db", dbPath, "--serve"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!child.stdin || !child.stdout || typeof child.stdin === "number") {
    try {
      child.kill()
    } catch {
      // ignored
    }
    throw new Error("native retrieval engine did not expose stdio pipes")
  }
  const current: Session = {
    child,
    stdin: child.stdin as unknown as StdinSink,
    pending: new Map(),
    buffer: "",
    closed: false,
    dbPath,
    binary,
  }
  pump(current)
  return current
}

const ensureSession = (binary: string, dbPath: string): Session => {
  if (session && !session.closed && session.dbPath === dbPath && session.binary === binary) return session
  if (session) teardown(session, new Error("native retrieval engine restarted"))
  session = start(binary, dbPath)
  return session
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const encodeVector = (vector: Float32Array): string => {
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/**
 * Run one hybrid query through the Rust engine.
 * Returns `null` when the engine is disabled, unavailable, slow, or broken; never throws.
 */
export const queryNativeEngine = async (input: NativeQuery, options: NativeEngineOptions = {}): Promise<NativeResult | null> => {
  const setting = options.engine ?? "auto"
  if (setting === "typescript") return null
  if (Date.now() < blockedUntil) return null

  const binary = locateNativeEngine(options.binary)
  if (!binary) {
    if (setting === "native") {
      logDiagnostic("retrieval", "native.unavailable", { reason: "binary not found", hint: NATIVE_BIN_ENV }, "warn")
    }
    blockedUntil = Date.now() + FAILURE_COOLDOWN_MS
    lastFailure = "binary not found"
    return null
  }
  const dbPath = options.dbPath ?? booksDbPath()
  if (!dbPath) return null

  let current: Session
  try {
    current = ensureSession(binary, dbPath)
  } catch (error) {
    block(`spawn failed: ${String(error).slice(0, 160)}`, setting)
    return null
  }

  const id = nextId++
  const payload = {
    id,
    query: input.query,
    books: input.books,
    vector_base64: input.vector ? encodeVector(input.vector) : null,
    limit: Math.max(1, Math.min(50, Math.trunc(input.limit))),
    bm25_limit: Math.max(1, Math.min(200, Math.trunc(input.bm25Limit))),
    dense_limit: Math.max(1, Math.min(200, Math.trunc(input.denseLimit))),
    rrf_k: input.rrfK,
    bm25_weight: input.bm25Weight,
    dense_weight: input.denseWeight,
  }

  try {
    const result = await new Promise<NativeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        current.pending.delete(id)
        // A wedged engine is replaced rather than trusted again: kill it and cool down.
        teardown(current, new Error("native retrieval engine timed out"))
        reject(new Error("timed out"))
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      current.pending.set(id, { resolve, reject, timer })
      try {
        void current.stdin.write(`${JSON.stringify(payload)}\n`)
        void current.stdin.flush()
      } catch (error) {
        current.pending.delete(id)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    lastFailure = null
    return result
  } catch (error) {
    block(`query failed: ${String(error).slice(0, 160)}`, setting)
    return null
  }
}

const block = (reason: string, setting: NativeEngineSetting) => {
  lastFailure = reason
  blockedUntil = Date.now() + FAILURE_COOLDOWN_MS
  logDiagnostic("retrieval", "native.fallback", { reason, setting }, "warn")
}

/** Diagnostics for the retrieval inspector / health output. */
export const nativeEngineStatus = () => ({
  binary: locateNativeEngine() ?? undefined,
  running: session !== null && !session.closed,
  blockedUntil,
  lastFailure: lastFailure ?? undefined,
})

/** Kill the child process and forget cached lookups (tests, shutdown, settings change). */
export const shutdownNativeEngine = () => {
  if (session) teardown(session, new Error("native retrieval engine shut down"))
  session = null
  cachedBinary = undefined
  blockedUntil = 0
  lastFailure = null
}
