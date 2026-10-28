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
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
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
export const ingestProgress = (bookId: string) => active.get(bookId)

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
export const startIngest = async (input: StartIngestInput): Promise<StartIngestResult> => {
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

  active.set(bookId, { stage: "queued", progress: 0 })
  queue = queue
    .then(() => runIngest({ ...input, settings, format, bookId, jobId, title }))
    .catch(() => undefined)
  return { bookId, slug, duplicate: false }
}

interface RunInput extends StartIngestInput {
  settings: Tree
  format: BookFormat
  bookId: string
  jobId: string
  title: string
}

const runIngest = async (input: RunInput): Promise<void> => {
  const { db, bookId, jobId } = input
  const setStage = async (status: string, stage: string, progress: number) => {
    active.set(bookId, { stage, progress })
    await db.run("UPDATE books SET status = ? WHERE id = ?", status, bookId)
    await db.run("UPDATE ingest_jobs SET stage = ?, status = 'running', progress = ? WHERE id = ?", stage, progress, jobId)
  }
  let poolRef: { close(): Promise<void> } | null = null
  try {
    const runtime = getRuntime()
    const ensure = input.ensureFn ?? (() => Effect.runPromise(ensureEmbedder(input.settings).pipe(Effect.asVoid)))
    const inProcess = input.embedFn ?? ((texts: string[]) => Effect.runPromise(embedBatch(texts)))
    const indexing = (input.settings.indexing ?? {}) as Tree
    const workerCount = input.embedFn && !input.workerUrl ? 1 : Math.max(1, Number(indexing.workersPerBook ?? 2))

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
    const parsed: ParseResult = await Effect.runPromise(parse(input.bytes, input.format))
    if (parsed.pages.every((p) => p.text.trim().length === 0)) {
      throw new Error("No extractable text found (scanned book?). OCR is not enabled.")
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
    const concurrency = pool && !poolBroken ? pool.size : 1
    let done = 0
    for (let w = 0; w < batches.length; w += concurrency) {
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

    const sample = parsed.pages.slice(0, 5).map((p) => p.text).join(" ")
    const lang = parsed.language ?? (arabicRatio(sample) > 0.5 ? "ar" : "en")
    const summary = {
      outline: parsed.outline.slice(0, 40).map((o) => o.title),
      pages: parsed.metadata.pages,
      textCoverage: parsed.textDensity,
      intro: sample.slice(0, 400),
    }
    const sig = runtime
      ? JSON.stringify({ repo: runtime.manifest.repo, revision: runtime.manifest.revision, dtype: String(((input.settings.embedding ?? {}) as Tree).dtype ?? "int8") })
      : "unknown"
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Remove partial rows, keep the book row so the UI can show why it failed.
    await db.run("DELETE FROM chunks WHERE book_id = ?", bookId).catch(() => undefined)
    await db.run("DELETE FROM sections WHERE book_id = ?", bookId).catch(() => undefined)
    await db.run("UPDATE books SET status = 'failed', error = ? WHERE id = ?", message.slice(0, 500), bookId).catch(() => undefined)
    await db
      .run("UPDATE ingest_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", message.slice(0, 500), Date.now(), jobId)
      .catch(() => undefined)
  } finally {
    await poolRef?.close().catch(() => undefined)
    active.delete(bookId)
  }
}

/** Remove a book, its passages, vectors, notes and the stored source file. */
export const deleteBook = async (db: BooksDbHandle, dataDir: string, bookId: string): Promise<boolean> => {
  const book = await db.get<{ source_path: string; source_hash: string }>(
    "SELECT source_path, source_hash FROM books WHERE id = ?",
    bookId,
  )
  if (!book) return false
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
