// packages/learning/src/ingest/run.ts
//
// The ingest orchestrator (plan §7): bytes in → parse → chunk → embed → books.db.
// One book at a time (indexing.maxConcurrentBooks = 1) through a process-wide queue.
// The embedder runs in-process (onnxruntime executes off the JS thread); the 2-worker
// pool from plan §7.7 is a later optimisation, not required for correctness.
//
// Failure handling: any error marks the book `failed` with the message and removes the
// partial rows so a retry (re-upload) starts clean.

import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import type { BooksDbHandle } from "../store"
import { parse, type ParseResult } from "../parsers"
import { chunk as chunkBook } from "../chunk"
import { embedBatch } from "../embed/pipeline"
import { checkModelFiles, ensureEmbedder, loadTokenizerForChunking } from "../embed/ensure"
import { createEmbedWorkerPool, type EmbedWorkerPool } from "./embed-pool"
import { availableParallelism } from "node:os"
import { getRuntime } from "../runtime"
import { withDefaults } from "../settings/defaults"
import { NORMALIZER_VERSION } from "../lang/arabic"
import { SCANNED_PAGE_MIN_CHARS, ocrPdfPages } from "../ocr"
import { ensureOcrPack, parseLanguages } from "../ocr/pack"
import {
  logDiagnostic,
  startDiagnosticOperation,
  withDiagnosticPromise,
  type DiagnosticOperation,
} from "../diagnostics"

type Tree = Record<string, unknown>

export type BookFormat = "pdf" | "docx" | "txt"

export const formatFromFilename = (filename: string): BookFormat | null => {
  const ext = path.extname(filename).toLowerCase().replace(".", "")
  if (ext === "pdf") return "pdf"
  if (ext === "docx") return "docx"
  if (ext === "txt" || ext === "md") return "txt"
  return null
}

const toBase64 = (vec: Float32Array) => Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString("base64")

const slugify = (title: string, hash: string) => {
  const ascii = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return ascii || `book-${hash.slice(0, 6)}`
}

const uniqueSlug = async (db: BooksDbHandle, base: string) => {
  let slug = base
  for (let i = 2; ; i++) {
    const taken = await db.get<{ id: string }>("SELECT id FROM books WHERE slug = ?", slug)
    if (!taken) return slug
    slug = `${base}-${i}`
  }
}

const arabicRatio = (text: string) => {
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  if (letters === 0) return 0
  return (text.match(/[\u0600-\u06FF]/g)?.length ?? 0) / letters
}

// ---------------------------------------------------------------------------
// Queue (one book at a time)
// ---------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve()
const active = new Map<string, { stage: string; progress: number }>()

interface IngestControl {
  readonly jobId: string
  readonly bookId: string
  readonly db: BooksDbHandle
  paused: boolean
  cancelled: boolean
  finishing: boolean
  stage: string
  progress: number
  waiters: Set<() => void>
  task?: Promise<void>
  diagnostic?: DiagnosticOperation
}

const controls = new Map<string, IngestControl>()
interface EnqueueClaim {
  cancelled: boolean
  done: Promise<void>
  finish: () => void
}
const enqueueClaims = new Map<string, EnqueueClaim>()
const cancelRequests = new Set<string>()
const waitForEnqueueClaim = async (jobId: string) => {
  await enqueueClaims.get(jobId)?.done
}
export const ingestProgress = (bookId: string) => active.get(bookId)

export class IngestCancelledError extends Error {
  constructor() {
    super("Ingest cancelled")
    this.name = "IngestCancelledError"
  }
}

const makeControl = (db: BooksDbHandle, jobId: string, bookId: string): IngestControl => {
  const existing = controls.get(jobId)
  if (existing) return existing
  const control: IngestControl = {
    db,
    jobId,
    bookId,
    paused: false,
    cancelled: false,
    finishing: false,
    stage: "parse",
    progress: 0,
    waiters: new Set(),
  }
  controls.set(jobId, control)
  active.set(bookId, { stage: "queued", progress: 0 })
  return control
}

const wakeControl = (control: IngestControl) => {
  for (const wake of control.waiters) wake()
  control.waiters.clear()
}

const waitForControl = async (control: IngestControl) => {
  while (control.paused && !control.cancelled) {
    await new Promise<void>((resolve) => control.waiters.add(resolve))
  }
  if (control.cancelled) throw new IngestCancelledError()
}

const stageBookStatus = (stage: string) => {
  if (stage === "parse" || stage === "ocr") return "parsing"
  if (stage === "chunk") return "chunking"
  if (stage === "summary") return "summarizing"
  return "embedding"
}

const checkpoint = (input: Pick<RunInput, "settings" | "format" | "title">, stage: string, progress: number) =>
  JSON.stringify({ version: 1, stage, progress, settings: input.settings, format: input.format, title: input.title })

const scheduleIngest = (input: RunInput) => {
  const control = input.control
  logDiagnostic("ingest", "job.queued", { jobId: input.jobId, bookId: input.bookId, queuedJobs: controls.size }, "info")
  const task = queue.then(() => runIngest(input))
  control.task = task
  queue = task.catch(() => undefined)
  return control
}

export interface StartIngestInput {
  db: BooksDbHandle
  dataDir: string
  filename: string
  bytes: Uint8Array
  title?: string
  settings?: Tree
  /** Test seam; defaults to the real bge-m3 embedder. */
  embedFn?: (texts: string[]) => Promise<Float32Array[]>
  ensureFn?: () => Promise<void>
  /** Test seam: worker script for the embedding pool (default: the real bge-m3 worker). */
  workerUrl?: URL
}

export interface StartIngestResult {
  bookId: string
  slug: string
  duplicate: boolean
}

export class IngestInputError extends Error {}

/** Validate, register the book row, and queue the heavy work. Returns immediately. */
const startIngestImpl = async (input: StartIngestInput): Promise<StartIngestResult> => {
  const settings = withDefaults(input.settings)
  const maxMB = Number(settings.maxBookSizeMB ?? 200)
  if (input.bytes.byteLength > maxMB * 1024 * 1024) throw new IngestInputError(`File is larger than ${maxMB} MB.`)
  const format = formatFromFilename(input.filename)
  if (!format) throw new IngestInputError("Unsupported file type. Use PDF, DOCX or TXT.")

  const hash = createHash("sha256").update(input.bytes).digest("hex")
  const existing = await input.db.get<{ id: string; slug: string; status: string }>(
    "SELECT id, slug, status FROM books WHERE source_hash = ?",
    hash,
  )
  if (existing && existing.status !== "failed") return { bookId: existing.id, slug: existing.slug, duplicate: true }
  if (existing) await deleteBook(input.db, input.dataDir, existing.id)

  const title = (input.title?.trim() || path.basename(input.filename, path.extname(input.filename))).slice(0, 200)
  const bookId = `bk_${randomUUID().replace(/-/g, "").slice(0, 16)}`
  const slug = await uniqueSlug(input.db, slugify(title, hash))

  let sourcePath = ""
  if (settings.keepSourceFiles !== false) {
    const dir = path.join(input.dataDir, "books")
    mkdirSync(dir, { recursive: true })
    sourcePath = path.join(dir, `${hash}.${format}`)
    writeFileSync(sourcePath, input.bytes)
  }

  await input.db.run(
    "INSERT INTO books (id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
    bookId,
    slug,
    title,
    hash,
    sourcePath,
    "pending",
    NORMALIZER_VERSION,
    Date.now(),
  )
  const jobId = `job_${randomUUID().replace(/-/g, "").slice(0, 12)}`
  await input.db.run(
    "INSERT INTO ingest_jobs (id, book_id, stage, status, progress, started_at) VALUES (?, ?, 'parse', 'queued', 0, ?)",
    jobId,
    bookId,
    Date.now(),
  )

  const runInput = { ...input, settings, format, bookId, jobId, title, control: makeControl(input.db, jobId, bookId) }
  await input.db.run(
    "UPDATE ingest_jobs SET checkpoint_json = ? WHERE id = ?",
    checkpoint(runInput, "parse", 0),
    jobId,
  )
  scheduleIngest(runInput)
  return { bookId, slug, duplicate: false }
}

export const startIngest = (input: StartIngestInput): Promise<StartIngestResult> =>
  withDiagnosticPromise(
    "ingest",
    "accept-book",
    { format: formatFromFilename(input.filename), sizeBytes: input.bytes.byteLength },
    () => startIngestImpl(input),
  )

interface RunInput extends StartIngestInput {
  settings: Tree
  format: BookFormat
  bookId: string
  jobId: string
  title: string
  control: IngestControl
}

export interface IngestJobRecord {
  id: string
  bookId: string
  stage: string
  status: string
  progress: number
  checkpointJson?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

export const listIngestJobs = async (db: BooksDbHandle): Promise<IngestJobRecord[]> => {
  const rows = await db.all<{
    id: string
    book_id: string
    stage: string
    status: string
    progress: number
    checkpoint_json: string | null
    error: string | null
    started_at: number | null
    finished_at: number | null
  }>("SELECT id, book_id, stage, status, progress, checkpoint_json, error, started_at, finished_at FROM ingest_jobs ORDER BY started_at DESC, id")
  return rows.map((row) => ({
    id: row.id,
    bookId: row.book_id,
    stage: row.stage,
    status: row.status,
    progress: row.progress,
    checkpointJson: row.checkpoint_json ?? undefined,
    error: row.error ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
  }))
}

const loadJobForResume = async (db: BooksDbHandle, jobId: string) =>
  db.get<{
    id: string
    book_id: string
    stage: string
    status: string
    progress: number
    checkpoint_json: string | null
    source_path: string
    source_hash: string
    title: string
  }>(
    `SELECT j.id, j.book_id, j.stage, j.status, j.progress, j.checkpoint_json,
            b.source_path, b.source_hash, b.title
       FROM ingest_jobs j JOIN books b ON b.id = j.book_id
      WHERE j.id = ?`,
    jobId,
  )

const failUnresumableJob = async (db: BooksDbHandle, jobId: string, bookId: string, reason: string) => {
  const message = reason.slice(0, 500)
  await db.run("UPDATE books SET status = 'failed', error = ? WHERE id = ?", message, bookId)
  await db.run("UPDATE ingest_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", message, Date.now(), jobId)
}

const enqueuePersistedJob = async (
  db: BooksDbHandle,
  jobId: string,
  dataDir: string,
  allowedStatuses: readonly string[],
): Promise<boolean> => {
  if (controls.has(jobId) || enqueueClaims.has(jobId) || cancelRequests.has(jobId)) return false
  let finish!: () => void
  const claim: EnqueueClaim = {
    cancelled: false,
    done: new Promise<void>((resolve) => {
      finish = resolve
    }),
    finish: () => finish(),
  }
  enqueueClaims.set(jobId, claim)
  const isCancelled = () => claim.cancelled || cancelRequests.has(jobId)
  const fail = async (bookId: string, reason: string) => {
    if (!isCancelled()) await failUnresumableJob(db, jobId, bookId, reason)
    return false
  }

  try {
    const row = await loadJobForResume(db, jobId)
    if (isCancelled() || controls.has(jobId) || !row || !allowedStatuses.includes(row.status)) return false
    const root = path.resolve(dataDir, "books")
    let sourcePath: string
    try {
      const candidate = path.resolve(row.source_path)
      const relative = path.relative(root, candidate)
      if (!row.source_path || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error("Stored source file is outside the Targeted Learning books directory")
      }
      sourcePath = realpathSync(candidate)
      const realRelative = path.relative(realpathSync(root), sourcePath)
      if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
        throw new Error("Stored source file resolves outside the Targeted Learning books directory")
      }
      if (!existsSync(sourcePath)) throw new Error("Stored source file is missing")
    } catch (error) {
      return await fail(row.book_id, error instanceof Error ? error.message : "Stored source file is unavailable")
    }

    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(sourcePath))
    } catch {
      return await fail(row.book_id, "Stored source file could not be read")
    }
    if (isCancelled()) return false
    const actualHash = createHash("sha256").update(bytes).digest("hex")
    if (actualHash !== row.source_hash) {
      return await fail(row.book_id, "Stored source file hash does not match the original upload")
    }

    let saved: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(row.checkpoint_json ?? "{}")
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>
    } catch {
      // Old or corrupt checkpoints safely fall back to default settings.
    }
    const settings = withDefaults((saved.settings as Tree | undefined) ?? undefined)
    const format = (saved.format === "pdf" || saved.format === "docx" || saved.format === "txt"
      ? saved.format
      : formatFromFilename(sourcePath))
    if (!format) return await fail(row.book_id, "Stored source file has an unsupported format")
    if (isCancelled()) return false

    const input: Omit<RunInput, "control"> = {
      db,
      dataDir,
      filename: path.basename(sourcePath),
      bytes,
      title: typeof saved.title === "string" ? saved.title : row.title,
      settings,
      format,
      bookId: row.book_id,
      jobId,
    }
    await db.run("UPDATE books SET status = 'pending', error = NULL WHERE id = ?", row.book_id)
    if (isCancelled()) return false
    await db.run("UPDATE ingest_jobs SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?", jobId)
    if (isCancelled()) return false

    // No await is allowed between installing the control and scheduling the
    // worker. A cancellation either marks this claim before setup or sees the
    // fully registered control after setup; it cannot miss the job in between.
    const control = makeControl(db, jobId, row.book_id)
    control.stage = row.stage
    control.progress = row.progress
    scheduleIngest({ ...input, control })
    return true
  } finally {
    if (enqueueClaims.get(jobId) === claim) enqueueClaims.delete(jobId)
    claim.finish()
  }
}

export const pauseIngestJob = async (db: BooksDbHandle, jobId: string): Promise<boolean> => {
  if (cancelRequests.has(jobId)) return false
  await waitForEnqueueClaim(jobId)
  if (cancelRequests.has(jobId)) return false
  const row = await db.get<{ book_id: string; status: string }>("SELECT book_id, status FROM ingest_jobs WHERE id = ?", jobId)
  if (!row || !["queued", "running"].includes(row.status) || cancelRequests.has(jobId)) return false
  const control = controls.get(jobId)
  if (control?.finishing || control?.cancelled) return false
  if (control) {
    control.paused = true
    control.diagnostic?.pause()
  }
  await db.run("UPDATE ingest_jobs SET status = 'paused' WHERE id = ? AND status IN ('queued', 'running')", jobId)
  if (cancelRequests.has(jobId) || control?.cancelled) return false
  await db.run(
    "UPDATE books SET status = 'paused' WHERE id = ? AND status IN ('pending', 'parsing', 'chunking', 'embedding', 'summarizing', 'paused')",
    row.book_id,
  )
  return true
}

export const resumeIngestJob = async (db: BooksDbHandle, jobId: string, dataDir: string): Promise<boolean> => {
  if (cancelRequests.has(jobId)) return false
  await waitForEnqueueClaim(jobId)
  if (cancelRequests.has(jobId)) return false
  const row = await db.get<{ book_id: string; status: string }>("SELECT book_id, status FROM ingest_jobs WHERE id = ?", jobId)
  if (!row || !["paused", "queued", "running"].includes(row.status)) return false
  const control = controls.get(jobId)
  if (control) {
    if (control.cancelled || control.finishing || cancelRequests.has(jobId)) return false
    control.paused = false
    control.diagnostic?.resume()
    active.set(control.bookId, { stage: control.stage, progress: control.progress })
    await db.run(
      "UPDATE books SET status = ? WHERE id = ? AND status IN ('paused', 'pending', 'parsing', 'chunking', 'embedding', 'summarizing')",
      stageBookStatus(control.stage),
      control.bookId,
    )
    if (control.cancelled || cancelRequests.has(jobId)) return false
    await db.run("UPDATE ingest_jobs SET status = 'running' WHERE id = ? AND status IN ('paused', 'queued', 'running')", jobId)
    wakeControl(control)
    return true
  }
  return enqueuePersistedJob(db, jobId, dataDir, ["paused", "queued", "running"])
}

export const retryIngestJob = async (db: BooksDbHandle, jobId: string, dataDir: string): Promise<boolean> =>
  enqueuePersistedJob(db, jobId, dataDir, ["failed", "cancelled"])

export const cancelIngestJob = async (db: BooksDbHandle, jobId: string): Promise<boolean> => {
  if (cancelRequests.has(jobId)) return false
  cancelRequests.add(jobId)
  try {
    // If a resume/retry is still validating its source, signal it to stop before
    // waiting. It will either schedule a fully registered control or leave the
    // persisted job untouched for the cancellation below.
    const claim = enqueueClaims.get(jobId)
    if (claim) {
      claim.cancelled = true
      await claim.done
    }
    const row = await db.get<{ book_id: string; status: string }>("SELECT book_id, status FROM ingest_jobs WHERE id = ?", jobId)
    if (!row || !["queued", "running", "paused"].includes(row.status)) return false
    const control = controls.get(jobId)
    if (control?.finishing) return false
    if (control) {
      control.cancelled = true
      control.paused = false
      control.diagnostic?.cancel("cancel requested")
      wakeControl(control)
    } else {
      await db.run("DELETE FROM chunks WHERE book_id = ?", row.book_id)
      await db.run("DELETE FROM sections WHERE book_id = ?", row.book_id)
      await db.run("UPDATE books SET status = 'cancelled', error = NULL WHERE id = ?", row.book_id)
      await db.run("UPDATE ingest_jobs SET status = 'cancelled', error = NULL, finished_at = ? WHERE id = ?", Date.now(), jobId)
    }
    return true
  } finally {
    cancelRequests.delete(jobId)
  }
}

export const resumePersistedIngestJobs = async (db: BooksDbHandle, dataDir: string): Promise<number> => {
  const jobs = await db.all<{ id: string }>("SELECT id FROM ingest_jobs WHERE status IN ('queued', 'running') ORDER BY started_at, id")
  let resumed = 0
  for (const job of jobs) {
    if (await enqueuePersistedJob(db, job.id, dataDir, ["queued", "running"])) resumed += 1
  }
  return resumed
}

const runIngest = async (input: RunInput): Promise<void> => {
  const { db, bookId, jobId, control } = input
  const diagnostic = startDiagnosticOperation("ingest", "run-job", {
    jobId,
    bookId,
    format: input.format,
    sizeBytes: input.bytes.byteLength,
  })
  control.diagnostic = diagnostic
  if (control.paused) diagnostic.pause()
  const setStage = async (status: string, stage: string, progress: number) => {
    await waitForControl(control)
    control.stage = stage
    control.progress = progress
    active.set(bookId, { stage, progress })
    await db.run("UPDATE books SET status = ? WHERE id = ?", status, bookId)
    await db.run(
      "UPDATE ingest_jobs SET stage = ?, status = 'running', progress = ?, checkpoint_json = ?, error = NULL WHERE id = ?",
      stage,
      progress,
      checkpoint(input, stage, progress),
      jobId,
    )
    diagnostic.progress(stage, { status, progress, bookId, jobId })
    // A pause can arrive while an asynchronous database write is in flight.
    // Re-assert the persisted state before reaching the next checkpoint.
    if (control.paused) {
      await db.run("UPDATE books SET status = 'paused' WHERE id = ?", bookId)
      await db.run("UPDATE ingest_jobs SET status = 'paused' WHERE id = ?", jobId)
      await waitForControl(control)
    }
  }
  const setProgress = async (stage: string, progress: number) => {
    await waitForControl(control)
    control.stage = stage
    control.progress = progress
    active.set(bookId, { stage, progress })
    await db.run(
      "UPDATE ingest_jobs SET stage = ?, status = 'running', progress = ?, checkpoint_json = ? WHERE id = ?",
      stage,
      progress,
      checkpoint(input, stage, progress),
      jobId,
    )
    diagnostic.progress(stage, { progress, bookId, jobId })
    if (control.paused) {
      await db.run("UPDATE books SET status = 'paused' WHERE id = ?", bookId)
      await db.run("UPDATE ingest_jobs SET status = 'paused' WHERE id = ?", jobId)
      await waitForControl(control)
    }
  }
  let poolRef: { close(): Promise<void> } | null = null
  try {
    await waitForControl(control)
    // A process may have stopped after any batch. Resume from the persisted
    // source by rebuilding deterministically and deleting partial child rows.
    await db.run("DELETE FROM chunks WHERE book_id = ?", bookId)
    await db.run("DELETE FROM sections WHERE book_id = ?", bookId)
    const runtime = getRuntime()
    const ensure = input.ensureFn ?? (() => Effect.runPromise(ensureEmbedder(input.settings).pipe(Effect.asVoid)))
    const inProcess = input.embedFn ?? ((texts: string[]) => Effect.runPromise(embedBatch(texts)))
    const indexing = (input.settings.indexing ?? {}) as Tree
    // `workersPerBook` = how many batches are in flight at once on ONE shared model session (ONNX
    // Runtime sessions are thread-safe and already multi-threaded natively): the work is split, the
    // model is not duplicated. Separate Bun Worker threads (one model copy each) are opt-in only:
    // DIVEEOI_TL_WORKER_THREADS=1. They crashed Bun with onnxruntime-node on a VPS.
    const configured = Math.max(1, Number(indexing.workersPerBook ?? 1))
    const useThreads = process.env.DIVEEOI_TL_WORKER_THREADS === "1" || Boolean(input.workerUrl)
    const workerCount = useThreads ? configured : 1

    // Workers: N Bun Workers each hold their own model copy and embed batches in parallel (plan §7.7).
    // They start loading now, while this thread parses the book.
    let pool: EmbedWorkerPool | null = null
    let poolBroken = false
    if (workerCount > 1) {
      try {
        const checked = input.workerUrl
          ? { options: { intraOpThreads: "auto" } as Record<string, unknown>, modelDir: runtime?.modelDir ?? "", signature: {} }
          : checkModelFiles(input.settings)
        const cores = Math.max(1, availableParallelism())
        const options = { ...checked.options }
        if (options.intraOpThreads === "auto") options.intraOpThreads = Math.max(1, Math.floor(cores / workerCount))
        pool = createEmbedWorkerPool({
          size: workerCount,
          workerUrl: input.workerUrl,
          init: { modelDir: checked.modelDir, signature: checked.signature, options },
        })
        poolRef = pool
        if (runtime) await loadTokenizerForChunking(runtime.manifest.repo)
      } catch (err) {
        if (!input.workerUrl) throw err // model not downloaded: fail before parsing a big book
        pool = null
      }
    } else if (!input.embedFn || input.ensureFn) {
      // Single process: fail early (before parsing a 300-page PDF) when the model isn't there.
      await ensure()
    }
    const embedTexts = async (texts: string[]): Promise<Float32Array[]> => {
      if (pool && !poolBroken) {
        try {
          return await pool.embed(texts)
        } catch {
          poolBroken = true // workers died: finish this book in-process
          await pool.close()
          await ensure()
        }
      }
      return inProcess(texts)
    }

    await setStage("parsing", "parse", 2)
    let parsed: ParseResult = await Effect.runPromise(parse(input.bytes, input.format))
    // Scanned pages (no text layer) → OCR when enabled (plan §7.6), else tell the student why.
    const ocr = (input.settings.ocr ?? {}) as Tree
    const scanned = parsed.pages.filter((p) => p.text.trim().length < SCANNED_PAGE_MIN_CHARS).map((p) => p.page)
    let ocrPages = 0
    if (scanned.length > 0 && input.format === "pdf") {
      if (ocr.enabled === true) {
        const languages = String(ocr.languages ?? "ara+eng")
        await setStage("parsing", "ocr", 5)
        await Effect.runPromise(ensureOcrPack(input.dataDir, parseLanguages(languages)))
        const results = await ocrPdfPages(
          input.bytes,
          scanned,
          { languages, dpi: Number(ocr.dpi ?? 200), dataDir: input.dataDir },
          (done, total) => setProgress("ocr", 5 + Math.floor((done / total) * 10)),
        )
        const byPage = new Map(results.map((r) => [r.page, r.text]))
        parsed = {
          ...parsed,
          pages: parsed.pages.map((p) => (byPage.has(p.page) && byPage.get(p.page)!.trim() ? { ...p, text: byPage.get(p.page)! } : p)),
        }
        ocrPages = results.filter((r) => r.text.trim().length > 0).length
      }
    }
    if (parsed.pages.every((p) => p.text.trim().length === 0)) {
      throw new Error(
        input.format === "pdf" && ocr.enabled !== true
          ? "No extractable text found: this looks like a scanned book. Turn on OCR in Settings > Targeted Learning > OCR and add it again."
          : "No extractable text found in this book.",
      )
    }

    await setStage("chunking", "chunk", 15)
    const chunking = (input.settings.chunking ?? {}) as Tree
    const chunked = await Effect.runPromise(
      chunkBook(parsed, bookId, {
        childTargetTokens: Number(chunking.childTargetTokens ?? 150),
        childMaxTokens: Number(chunking.childMaxTokens ?? 220),
        childOverlapTokens: Number(chunking.childOverlapTokens ?? 20),
        minChunkTokens: Number(chunking.minChunkTokens ?? 30),
        parentMaxTokens: Number(chunking.parentMaxTokens ?? 1200),
        prependHeadingPath: chunking.prependHeadingPath !== false,
        stripHeadersFooters: chunking.stripHeadersFooters !== false,
      }),
    )
    if (chunked.chunks.length === 0) throw new Error("The book produced no indexable passages.")

    for (const s of chunked.sections) {
      await waitForControl(control)
      await db.run(
        "INSERT INTO sections (id, book_id, parent_id, level, title, page_start, page_end, ord, text, heading_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        s.id,
        bookId,
        s.parentId ?? null,
        s.level,
        s.title ?? null,
        s.pageStart ?? null,
        s.pageEnd ?? null,
        s.ord,
        s.text,
        s.headingPath ?? null,
      )
    }

    const batchSize = Math.max(1, Number(((input.settings.embedding ?? {}) as Tree).batchSize ?? 16))
    const total = chunked.chunks.length
    // Sort by length so each batch pads to a similar size (padding to the longest wastes compute).
    const items = chunked.chunks
      .map((c) => ({ c, text: c.headingPath ? `${c.headingPath}\n${c.text}` : c.text }))
      .sort((x, y) => x.text.length - y.text.length)
    const batches: (typeof items)[] = []
    for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize))
    const concurrency = pool && !poolBroken ? pool.size : configured
    let done = 0
    for (let w = 0; w < batches.length; w += concurrency) {
      await waitForControl(control)
      const wave = batches.slice(w, w + concurrency)
      const results = await Promise.all(wave.map((b) => embedTexts(b.map((x) => x.text))))
      // This thread is the only SQLite writer: workers just return vectors.
      for (let k = 0; k < wave.length; k++) {
        const batch = wave[k]!
        const vectors = results[k]!
        if (vectors.length !== batch.length) throw new Error(`embedder returned ${vectors.length} vectors for ${batch.length} passages`)
        for (let j = 0; j < batch.length; j++) {
          const c = batch[j]!.c
          await db.run(
            "INSERT INTO chunks (id, book_id, section_id, ord, page, text, text_norm, token_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            c.id,
            bookId,
            c.sectionId,
            c.ord,
            c.page ?? null,
            c.text,
            c.textNorm,
            c.tokenCount,
          )
          await db.run("INSERT INTO chunk_vecs (chunk_id, vec) VALUES (?, ?)", c.id, toBase64(vectors[j]!))
        }
        done += batch.length
      }
      await setStage("embedding", "embed", 15 + Math.floor((done / total) * 80))
      await new Promise((r) => setTimeout(r, 0)) // let the server breathe between waves
    }
    await pool?.close()
    await setStage("summarizing", "summary", 96)

    const sample = parsed.pages.slice(0, 5).map((p) => p.text).join(" ")
    const lang = parsed.language ?? (arabicRatio(sample) > 0.5 ? "ar" : "en")
    const summary = {
      outline: parsed.outline.slice(0, 40).map((o) => o.title),
      pages: parsed.metadata.pages,
      textCoverage: parsed.textDensity,
      ocrPages,
      pagesWithoutText: parsed.pages.filter((p) => p.text.trim().length < SCANNED_PAGE_MIN_CHARS).length,
      intro: sample.slice(0, 400),
    }
    const sig = runtime
      ? JSON.stringify({ repo: runtime.manifest.repo, revision: runtime.manifest.revision, dtype: String(((input.settings.embedding ?? {}) as Tree).dtype ?? "int8") })
      : "unknown"
    await waitForControl(control)
    // Close the control window before the final DB writes. A late pause/cancel
    // request must not race the ready/complete transition.
    control.finishing = true
    await db.run(
      "UPDATE books SET status = 'ready', lang = ?, pages = ?, author = ?, parent_count = ?, chunk_count = ?, embed_signature = ?, indexed_at = ?, summary_json = ?, error = NULL WHERE id = ?",
      lang,
      parsed.metadata.pages,
      parsed.metadata.author ?? null,
      chunked.sections.length,
      total,
      sig,
      Date.now(),
      JSON.stringify(summary),
      bookId,
    )
    await db.run("UPDATE ingest_jobs SET status = 'complete', progress = 100, finished_at = ? WHERE id = ?", Date.now(), jobId)
    diagnostic.complete({
      bookId,
      jobId,
      pages: parsed.metadata.pages,
      chunks: total,
      sections: chunked.sections.length,
      ocrPages,
      language: lang,
    })
  } catch (err) {
    const cancelled = err instanceof IngestCancelledError || control.cancelled
    const message = cancelled ? "Ingest cancelled" : err instanceof Error ? err.message : String(err)
    if (cancelled) diagnostic.cancel({ stage: control.stage, progress: control.progress })
    else diagnostic.fail(err, { stage: control.stage, progress: control.progress, bookId, jobId })
    // Remove partial rows, keeping the book row for retry/diagnostics.
    await db.run("DELETE FROM chunks WHERE book_id = ?", bookId).catch(() => undefined)
    await db.run("DELETE FROM sections WHERE book_id = ?", bookId).catch(() => undefined)
    await db
      .run("UPDATE books SET status = ?, error = ? WHERE id = ?", cancelled ? "cancelled" : "failed", cancelled ? null : message.slice(0, 500), bookId)
      .catch(() => undefined)
    await db
      .run(
        "UPDATE ingest_jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?",
        cancelled ? "cancelled" : "failed",
        cancelled ? null : message.slice(0, 500),
        Date.now(),
        jobId,
      )
      .catch(() => undefined)
  } finally {
    await poolRef?.close().catch(() => undefined)
    if (control.diagnostic === diagnostic) control.diagnostic = undefined
    if (controls.get(jobId) === control) controls.delete(jobId)
    if (active.has(bookId)) active.delete(bookId)
  }
}

/** Remove a book, its passages, vectors, notes and the stored source file. */
export const deleteBook = async (db: BooksDbHandle, dataDir: string, bookId: string): Promise<boolean> => {
  const book = await db.get<{ source_path: string; source_hash: string }>(
    "SELECT source_path, source_hash FROM books WHERE id = ?",
    bookId,
  )
  if (!book) return false
  const running = await db.all<{ id: string }>(
    "SELECT id FROM ingest_jobs WHERE book_id = ? AND status IN ('queued', 'running', 'paused')",
    bookId,
  )
  for (const job of running) {
    await cancelIngestJob(db, job.id)
    await controls.get(job.id)?.task
  }
  await db.run("DELETE FROM books WHERE id = ?", bookId) // ON DELETE CASCADE clears the rest (foreign_keys = ON)
  await db.run("DELETE FROM chunks WHERE book_id = ?", bookId).catch(() => undefined)
  if (book.source_path && existsSync(book.source_path)) {
    try {
      unlinkSync(book.source_path)
    } catch {
      // best effort
    }
  }
  return true
}
