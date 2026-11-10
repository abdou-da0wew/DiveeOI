# fix_round5 — VDS evidence for DiveeOI ingest error:"null"

Server pid 3825326, stdout /tmp/diveeoi-debug2.log. Capture window 19:21:20–19:26:20 UTC (probe upload ~19:23 UTC) logged to /tmp/upload_window.log.

## CALL 1 — Capture log + main tail + table list



---

## vds.py call log
- 19:29:42Z call A: FAILED — remote zsh rejected unquoted `echo ===CAPTURE===` (zsh `=word` expansion); no evidence.
- 19:31:10Z call B: API truncated the 6541-char response to a preview; only partial evidence.
- call C: DB rows + capture size + source grep — OK.
- call D: full capture log + error columns + filtered tail + run.ts grep map — OK.

## CALL 1 — FULL capture log /tmp/upload_window.log (1003 /tmp/upload_window.log), VERBATIM
```
[19:21:37.996] [DevMonitor] RSS 6699.8 MB | heap 2455.2 MB | uptime 3966s
[19:21:38.003] [DevMonitor] {"ts":"2026-11-09T19:21:37.996Z","uptimeS":3966,"memory":{"rssMB":6699.83984375,"heapUsedMB":2455.222804069519,"externalMB":110.19689083099365,"gcAvailable":true},"adaptive":{"profile":"balanced","profileChanged":false,"rssTargetMB":8192,"heapTargetMB":7209,"gcIntervalMs":30000,"rssDeviationPct":-0.2,"heapDeviationPct":-0.7}}
[19:21:38.071] INFO (#770): Adaptive targets updated {
  profile: "balanced",
  rssTargetMB: 8192,
  heapTargetMB: 7209,
  gcIntervalMs: 30000,
}
[19:22:39.293] [DevMonitor] RSS 15849.8 MB | heap 5278.5 MB | uptime 4028s
[19:22:39.294] [DevMonitor] {"ts":"2026-11-09T19:22:39.293Z","uptimeS":4028,"memory":{"rssMB":15849.84375,"heapUsedMB":5278.48819732666,"externalMB":112.27261734008789,"gcAvailable":true},"adaptive":{"profile":"balanced","profileChanged":false,"rssTargetMB":8192,"heapTargetMB":7209,"gcIntervalMs":30000,"rssDeviationPct":0.9,"heapDeviationPct":-0.3}}
```
NOTE: capture window was 19:21:20-19:26:20 UTC but the log spans only 19:21:37-19:22:39 (~82s, stops early). Content is ONLY DevMonitor telemetry + "Adaptive targets updated" INFO — zero ingest/error lines. RSS jumped 6699.8 MB -> 15849.8 MB (+9.1 GB), heap 2455 -> 5278 MB between 19:21:37 and 19:22:39, i.e. right after the probe ingest attempt at 19:21:55.

## CALL 2 — books.db tables + latest ingest_jobs/books rows (VERBATIM)
```
TABLES: ['meta', 'books', 'sections', 'chunks', 'chunks_fts', 'chunks_fts_data', 'chunks_fts_idx', 'chunks_fts_docsize', 'chunks_fts_config', 'chunks_ai', 'chunks_ad', 'chunks_au', 'chunk_vecs', 'ingest_jobs', 'book_notes']
==T books COLS: ['id', 'slug', 'title', 'author', 'lang', 'source_hash', 'source_path', 'pages', 'status', 'error', 'parent_count', 'chunk_count', 'embed_signature', 'normalizer_version', 'created_at', 'indexed_at', 'summary_json']
ROW: ('bk_5bb04da2b1704d15', 'probe-book3', 'probe_book3', None, None, '09fea1797ebc35a458594a48b054c90a825af2811aea95763ad41b84a6886a71', '/home/celestial-dev/.local/share/diveeoi/targeted-learning/books/09fea1797ebc35a458594a48b054c90a825af2811aea95763a
==T ingest_jobs COLS: ['id', 'book_id', 'stage', 'status', 'progress', 'checkpoint_json', 'error', 'started_at', 'finished_at']
ROW: ('job_5c6adbb0d767', 'bk_5bb04da2b1704d15', 'parse', 'failed', 0, '{"version":1,"stage":"parse","progress":0,"settings":{"enabled":true,"maxBookSizeMB":200,"keepSourceFiles":true,"download":{"endpoint":"huggingface.co","maxConcurrent":1,"retries":6,"
ROW: ('job_ec3499933a44', 'bk_f629a48ca5814f66', 'parse', 'failed', 0, '{"version":1,"stage":"parse","progress":0,"settings":{"enabled":true,"maxBookSizeMB":200,"keepSourceFiles":true,"download":{"endpoint":"huggingface.co","maxConcurrent":1,"retries":6,"
==T book_notes COLS: ['id', 'book_id', 'source_hash', 'kind', 'text', 'citations_json', 'embedding', 'source_session_id', 'stale', 'created_at', 'updated_at']

1003 /tmp/upload_window.log
```

## CALL 3 — error columns / filtered main tail / source map (VERBATIM)
### ingest_jobs + books (error column = literal string 'null'; job_5c6adbb0d767 ran 3 ms)
```
JOB: ('job_5c6adbb0d767', 'bk_5bb04da2b1704d15', 'parse', 'failed', 0, 'null', 1794252115411, 1794252115414)
JOB: ('job_ec3499933a44', 'bk_f629a48ca5814f66', 'parse', 'failed', 0, 'null', 1794248296431, 1794248296497)
BOOK: ('bk_5bb04da2b1704d15', 'probe-book3', 'failed', 'null', None, 1794252115409, '/home/celestial-dev/.local/share/diveeoi/targeted-learning/books/09fea1797ebc35a458594a48b054c90a825af2811aea95763ad41b84a6886a71.txt')
```
### main log tail with DevMonitor noise removed (nothing ingest-related in server stdout)
```
  rssTargetMB: 8192,
  heapTargetMB: 7209,
  gcIntervalMs: 30000,
}
[19:18:33.186] INFO (#770): Adaptive targets updated {
  profile: "balanced",
  rssTargetMB: 8192,
  heapTargetMB: 7209,
  gcIntervalMs: 30000,
}
[19:20:03.190] INFO (#770): Adaptive targets updated {
  profile: "balanced",
  rssTargetMB: 8192,
  heapTargetMB: 7209,
  gcIntervalMs: 30000,
}
[19:21:38.071] INFO (#770): Adaptive targets updated {
  profile: "balanced",
  rssTargetMB: 8192,
  heapTargetMB: 7209,
  gcIntervalMs: 30000,
}
```
### source sizes + grep map of run.ts (the ingest runner)
```
  824 33697 /home/celestial-dev/DiveeOI/packages/learning/src/ingest/run.ts
  174  7262 /home/celestial-dev/DiveeOI/packages/learning/src/service.ts
  998 40959 total

8:// Failure handling: any error marks the book `failed` with the message and removes the
162:  queue = task.catch(() => undefined)
269:  error?: string
282:    error: string | null
285:  }>("SELECT id, book_id, stage, status, progress, checkpoint_json, error, started_at, finished_at FROM ingest_jobs ORDER BY started_at DESC, id")
293:    error: row.error ?? undefined,
320:  await db.run("UPDATE books SET status = 'failed', error = ? WHERE id = ?", message, bookId)
321:  await db.run("UPDATE ingest_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", message, Date.now(), jobId)
363:    } catch (error) {
364:      return await fail(row.book_id, error instanceof Error ? error.message : "Stored source file is unavailable")
370:    } catch {
383:    } catch {
404:    await db.run("UPDATE books SET status = 'pending', error = NULL WHERE id = ?", row.book_id)
406:    await db.run("UPDATE ingest_jobs SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?", jobId)
496:      await db.run("UPDATE books SET status = 'cancelled', error = NULL WHERE id = ?", row.book_id)
497:      await db.run("UPDATE ingest_jobs SET status = 'cancelled', error = NULL, finished_at = ? WHERE id = ?", Date.now(), jobId)
505:export const resumePersistedIngestJobs = async (db: BooksDbHandle, dataDir: string): Promise<number> => {
531:      "UPDATE ingest_jobs SET stage = ?, status = 'running', progress = ?, checkpoint_json = ?, error = NULL WHERE id = ?",
```
### grep hits that located the runner files
```
/home/celestial-dev/DiveeOI/packages/learning/src/ingest/run.ts
/home/celestial-dev/DiveeOI/packages/learning/src/service.ts
---LS---
AGENTS.md
COMPOSER_INCIDENT_HANDOFF.md
CONTEXT.md
DECISIONS.md
DIVEEOI_BRIEF.md
DiveeOI-architecture-dark.pdf
DiveeOI-architecture-light.pdf
DiveeOI-field-notes-dark.pdf
DiveeOI-field-notes-light.pdf
DiveeOI-technical.pdf
DiveeOI.pdf
DiveeOI_RESUME_PLAN.md
DiveeOI_Scientific_Research (3).docx
DiveeOI_Scientific_Research.docx
DiveeOI_Scientific_Research.pdf
Dockerfile
PROJECT_GUIDE.md
PROJECT_LESSONS.md
README.md
RELEASE_HANDOFF_2026-11-03.md
RELEASE_HANDOFF_2026-11-06.md
REMINDERS.md
WORKLOG.md
__pycache__
brand
bun.lock
bunfig.toml
data
docs
node_modules
package.json
packages
patches
plans
scripts
skills
tests
tools
tsconfig.json
turbo.json
videos
videos-legacy
---PKGS---
api
app
db
effect-drizzle-sqlite
effect-sqlite-node
http-recorder
identity
learning
llm
mcp
memory
plugin
plugins
profiler
script
sdk
server
ui
```


---

## CALL 4 — run.ts source (VERBATIM, fetched as gzip+base64, decoded locally)

Window list: run.ts = 824 lines / 33697 bytes. Key catches: 162, 363, 370, 383, 603, 615, **765 (top-level)**.
```
162:  queue = task.catch(() => undefined)
363:    } catch (error) {
370:    } catch {
383:    } catch {
603:      } catch (err) {
615:        } catch {
765:  } catch (err) {
771/772/775/784/786/794/795: .catch(() => undefined) etc.
815/819: deleteBook best-effort catches
```
service.ts (7262 bytes) ingest-related lines:
```
82:    } catch {
119:      const ingest = yield* Effect.promise(() => import("./ingest/run"))
121:        try: () => ingest.resumePersistedIngestJobs(booksStore.db!, dataDir),
122:        catch: (cause) => new Error("Failed to recover Targeted Learning ingest jobs", { cause }),
128:        Effect.catchCause((cause) =>
129:          Effect.sync(() => logDiagnostic("ingest", "recovery.error", { error: String(cause) }, "error")).pipe(
```

### run.ts lines 296-313 (loadJobForResume tail + failUnresumableJob)
```ts
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
```

### run.ts lines ~313-625 (enqueuePersistedJob + runner loop + resumePersistedIngestJobs + runIngest start: setStage/setProgress, embedder-ensure path, parse entry) — decoded from truncated response preview (complete decompress)
```ts
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
--SEP--
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
--SEP--
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
--SEP--
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
```

### run.ts lines 640-824 (chunk/embed/summary writes + TOP-LEVEL CATCH + finally + deleteBook)
```ts

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
        // One statement per table per batch (instead of two per chunk): far fewer journal writes.
        const rows = batch.map((b) => b.c)
        await db.run(
          `INSERT INTO chunks (id, book_id, section_id, ord, page, text, text_norm, token_count) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",")}`,
          ...rows.flatMap((c) => [c.id, bookId, c.sectionId, c.ord, c.page ?? null, c.text, c.textNorm, c.tokenCount]),
        )
        await db.run(
          `INSERT INTO chunk_vecs (chunk_id, vec) VALUES ${rows.map(() => "(?, ?)").join(",")}`,
          ...rows.flatMap((c, j) => [c.id, toBase64(vectors[j]!)]),
        )
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
    // Index-and-forget: once the queue drains, drop the BGE-M3 session if chat does not need it.
    const pending = await db
      .all<{ n: number }>("SELECT COUNT(*) AS n FROM ingest_jobs WHERE status IN ('queued', 'running')")
      .then((rows) => Number(rows[0]?.n ?? 0))
      .catch(() => 1)
    await releaseTeacherAfterIndexing(input.settings, pending).catch(() => undefined)
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
```

## SMOKING GUN
run.ts:765-767 (runIngest top-level catch):
```ts
} catch (err) {
    const cancelled = err instanceof IngestCancelledError || control.cancelled
    const message = cancelled ? "Ingest cancelled" : err instanceof Error ? err.message : String(err)
```
`String(null)` === the 4-char string "null" -> stored verbatim via `UPDATE ingest_jobs SET status='failed', error=?` (and same for books). DB error column contains literal string 'null', NOT SQL NULL -> the pipeline rejected with a raw `null` (not an Error). Failure occurred BEFORE the first `setStage("parsing","parse",2)` (DB progress still 0) -> crash is in waitForControl / chunk-section DELETEs / getRuntime() / **ensure() = ensureEmbedder(...)** (run.ts ~596-612) or `parse()` entry. queue swallow at line 162 (`task.catch(() => undefined)`) + zero ingest lines in /tmp/diveeoi-debug2.log confirm DB is the only trace.
