// packages/server/src/server/routes/instance/httpapi/handlers/targeted-learning.ts
//
// Handler implementations for the /targeted-learning route group.
// Each handler closes over the TargetedLearning.Service and the Config.Service.

import { Effect, Fiber } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { join } from "node:path"
import { InstanceHttpApi } from "../api"
import { TargetedLearning as TLService } from "@diveeoi/learning"
import { Config } from "@/config/config"
import { PRESETS, withDefaults, type Info as TLInfo } from "@diveeoi/learning/settings"
import { Global } from "@diveeoi/db/global"

export const targetedLearningHandlers = HttpApiBuilder.group(
  InstanceHttpApi,
  "targeted-learning",
  (handlers) =>
    Effect.gen(function* () {
      const tl = yield* TLService
      const configSvc = yield* Config.Service

      // ----- Setup -----

      const setupStatus = Effect.fn("TargetedLearning.setupStatus")(function* () {
        const state = yield* tl.getSetupState()
        return {
          status: state.status,
          steps: state.steps.map((s) => ({
            name: s.name,
            status: s.status,
            attempts: s.attempts,
            lastError: s.lastError,
            // Expose the persisted step result (e.g. probe's platform/arch/
            // cpuCores) so the UI and diagnostics can show what each step
            // actually produced. Found missing during live smoke testing.
            result: s.result ?? null,
          })),
          recommendedProfile: state.recommendedProfile,
        }
      })

      let setupRunning = false
      let setupStopping = false
      let setupRepairing = false
      let setupFiber: Fiber.Fiber<unknown, unknown> | undefined
      let setupAbortController: AbortController | undefined

      const stopSetup = () =>
        Effect.gen(function* () {
          if (setupStopping) {
            while (setupStopping) yield* Effect.sleep("10 millis")
            return
          }
          setupStopping = true
          const fiber = setupFiber
          yield* Effect.gen(function* () {
            setupAbortController?.abort()
            if (fiber) yield* Fiber.interrupt(fiber)
            yield* tl.cancelSetup()
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                setupRunning = false
                setupFiber = undefined
                setupAbortController = undefined
                setupStopping = false
              }),
            ),
          )
        })

      /** The 8 setup steps (plan §5.1). Nothing is skipped: Ready means the model really loads. */
      const runSetup = (payload: { force?: boolean; dtype?: string }, signal: AbortSignal) =>
        Effect.gen(function* () {
          const cfg = yield* configSvc.get().pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>))
          const userTl = ((cfg as Record<string, unknown>).targetedLearning as Record<string, unknown> | undefined) ?? undefined
          const settings = withDefaults(userTl as never) as Record<string, unknown>
          const dtype = ((payload.dtype ?? (settings.embedding as Record<string, unknown>)?.dtype ?? "int8") as "int8" | "q4f16" | "fp16" | "fp32")
          const download = (settings.download ?? {}) as Record<string, unknown>
          const stepOptions = { force: payload.force, signal }

          const probeResult = yield* tl.runProbe()
          yield* tl.runStep("probe", () => Effect.succeed(probeResult), stepOptions)

          yield* tl.runStep("preflight", () =>
            Effect.gen(function* () {
              const needMB = dtype === "fp32" ? 5000 : dtype === "fp16" ? 2600 : 1400
              const ok = probeResult.freeDiskMB >= needMB && probeResult.dataDirWritable
              if (!ok) {
                return yield* Effect.fail(
                  new Error(
                    `Not enough free disk or data dir not writable (free ${probeResult.freeDiskMB} MB, need ${needMB} MB).`,
                  ),
                )
              }
              return { freeDiskMB: probeResult.freeDiskMB, dataDirWritable: true, sufficient: true }
            }),
            stepOptions,
          )

          const manifest = tl.manifest!
          const filesDir = join(tl.modelDir, manifest.repo)
          const dl = yield* Effect.promise(() => import("@diveeoi/learning/download"))
          yield* tl.runStep("download", () =>
            dl.downloadManifest(manifest, {
              retries: Number(download.retries ?? 6),
              stallTimeoutSec: Number(download.stallTimeoutSec ?? 30),
              destDir: filesDir,
              endpoint: typeof download.endpoint === "string" ? (download.endpoint as string) : undefined,
              dtype,
              signal,
            }),
            stepOptions,
          )
          yield* tl.runStep("verify", () =>
            Effect.gen(function* () {
              const r = yield* dl.verifyManifestFiles(manifest, filesDir, dtype, "hash")
              if (r.problems.length > 0) return yield* Effect.fail(new Error(`Model files failed verification: ${r.problems.join("; ")}`))
              return { verified: true, files: r.checked }
            }),
            stepOptions,
          )

          const steps = yield* Effect.promise(() => import("@diveeoi/learning/setup/steps"))
          yield* tl.runStep("runtime-check", () => steps.runtimeCheck(settings), stepOptions)
          yield* tl.runStep("golden-self-test", () => steps.semanticSelfTest(settings), stepOptions)
          yield* tl.runStep("benchmark", () => steps.benchmark(settings), stepOptions)
          yield* tl.runStep("recommend-profile", () => Effect.succeed(probeResult.recommendedProfile), stepOptions)
        })

      // Setup downloads ~600 MB: it must not run inside the HTTP request. Start it in the
      // background and let the UI poll GET /setup (steps report their own status/errors).
      const setupStart = Effect.fn("TargetedLearning.setupStart")(function* (ctx: {
        payload: { force?: boolean; dtype?: string }
      }) {
        if (!tl.manifest) return yield* Effect.fail(new HttpApiError.BadRequest({}))
        if (!setupRunning && !setupStopping && !setupRepairing) {
          setupRunning = true
          setupAbortController = new AbortController()
          setupFiber = Effect.runFork(
            runSetup(ctx.payload, setupAbortController.signal).pipe(
              Effect.catch((err) => Effect.logWarning("targeted-learning setup stopped", { error: String(err).slice(0, 300) })),
              Effect.ensuring(Effect.sync(() => {
                setupRunning = false
                setupFiber = undefined
                setupAbortController = undefined
              })),
            ),
          )
        }
        return yield* setupStatus()
      })

      const setupRepair = Effect.fn("TargetedLearning.setupRepair")(function* () {
        if (setupRepairing) return yield* setupStatus()
        setupRepairing = true
        return yield* Effect.gen(function* () {
          if (setupRunning || setupStopping) yield* stopSetup()
          yield* tl.resetForRepair()
          return yield* setupStatus()
        }).pipe(Effect.ensuring(Effect.sync(() => { setupRepairing = false })))
      })

      const setupCancel = Effect.fn("TargetedLearning.setupCancel")(function* () {
        if (setupRepairing) return yield* setupStatus()
        if (setupRunning || setupStopping) yield* stopSetup()
        return yield* setupStatus()
      })

      const setupImportLocal = Effect.fn("TargetedLearning.setupImportLocal")(function* (ctx: {
        payload: { folder: string }
      }) {
        if (!tl.manifest) return yield* Effect.fail(new HttpApiError.BadRequest({}))
        const { importFromLocalFolder } = require("@diveeoi/learning/download") as typeof import("@diveeoi/learning/download")
        yield* importFromLocalFolder(tl.manifest, ctx.payload.folder, join(tl.modelDir, tl.manifest.repo)).pipe(
          Effect.mapError(() => new HttpApiError.BadRequest({})),
        )
        return yield* setupStatus()
      })

      // ----- Settings -----

      const getSettings = Effect.fn("TargetedLearning.getSettings")(function* () {
        const cfg = yield* configSvc.get()
        const userTl = (cfg.targetedLearning as Partial<TLInfo> | undefined) ?? undefined
        const values = withDefaults(userTl)
        // Strip undefined values — Effect Schema's JSON serialization rejects
        // `undefined` inside object literals (found by live smoke testing:
        // "Expected JSON value, got {...value:undefined...}").
        const stripUndefined = (input: unknown): unknown => {
          if (Array.isArray(input)) return input.map(stripUndefined)
          if (input !== null && typeof input === "object") {
            const out: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
              if (v === undefined) continue
              out[k] = stripUndefined(v)
            }
            return out
          }
          return input
        }
        const cleanValues = stripUndefined(values)
        // Effective config with sources — every leaf key tagged with where it
        // came from. Phase 5 source-tracking refines "default" vs "config".
        const effective: Record<string, { value: unknown; source: string }> = {}
        const walk = (obj: unknown, path: string) => {
          if (obj === null || typeof obj !== "object") return
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            const p = path ? `${path}.${k}` : k
            if (v === undefined) continue
            if (v !== null && typeof v === "object" && !Array.isArray(v)) {
              walk(v, p)
            } else {
              effective[p] = { value: v, source: "default" }
            }
          }
        }
        walk(values, "")
        return { values: cleanValues as TLInfo, effective }
      })

      const updateSettings = Effect.fn("TargetedLearning.updateSettings")(function* (ctx: {
        payload: Partial<TLInfo>
      }) {
        const cfg = yield* configSvc.get()
        const { validateSettingsPayload } = yield* Effect.promise(() => import("@diveeoi/learning/settings/validate"))
        if (validateSettingsPayload(ctx.payload).length > 0) return yield* Effect.fail(new HttpApiError.BadRequest({}))
        // Group-level merge: editing one section never wipes the others (plan §11.2).
        const next = {
          ...cfg,
          targetedLearning: { ...((cfg.targetedLearning as Record<string, unknown> | undefined) ?? {}), ...ctx.payload },
        } as typeof cfg
        const written = yield* configSvc.updateGlobal(next)
        // get() reads cached per-instance state; rebuild it so the new values are visible immediately.
        if (written.changed) yield* configSvc.refresh()
        return yield* getSettings()
      })

      const getSettingsSchema = Effect.fn("TargetedLearning.getSettingsSchema")(function* () {
        // Return the schema as a JSON-Schema-compatible descriptor with our
        // custom @diveeoi/learning/* annotations copied through as x-* keys.
        // (Schema.toStandardJSONSchemaV1 in Effect v4-beta does not expose a
        // plain toJsonSchema(); the hand-rolled AST walker in the learning
        // package handles exactly the node types our schema uses.)
        const { Info } = require("@diveeoi/learning/settings") as typeof import("@diveeoi/learning/settings")
        const { toJSONSchema } = require("@diveeoi/learning/settings/json-schema") as typeof import("@diveeoi/learning/settings/json-schema")
        return toJSONSchema(Info)
      })

      const getSettingsPresets = Effect.fn("TargetedLearning.getSettingsPresets")(function* () {
        return PRESETS
      })

      // ----- System -----

      const health = Effect.fn("TargetedLearning.health")(function* () {
        const state = yield* tl.getSetupState()
        return {
          setupStatus: state.status,
          booksDbAvailable: tl.booksStore.available,
          booksDbReason: tl.booksStore.unavailabilityReason,
          modelReady: state.status === "ready",
          manifestLoaded: tl.manifest !== null,
        }
      })

      const probe = Effect.fn("TargetedLearning.probe")(function* () {
        return yield* tl.runProbe()
      })

      // Books — list all indexed books (used by the composer @book: autocomplete)
      const listBooks = Effect.fn("TargetedLearning.listBooks")(function* () {
        const store = tl.booksStore
        if (!store.available || !store.db) {
          return { books: [] }
        }
        const rows = yield* Effect.promise(() => (store.db!.all<{
              id: string
              slug: string
              title: string
              author: string | null
              lang: string | null
              status: string
              pages: number | null
              chunk_count: number
              indexed_at: number | null
              error: string | null
              job_id: string | null
              job_status: string | null
              job_progress: number | null
            }>(
              `SELECT b.id, b.slug, b.title, b.author, b.lang, b.status, b.pages, b.chunk_count, b.indexed_at, b.error,
                      (SELECT j.id FROM ingest_jobs j WHERE j.book_id = b.id ORDER BY j.started_at DESC, j.id DESC LIMIT 1) AS job_id,
                      (SELECT j.status FROM ingest_jobs j WHERE j.book_id = b.id ORDER BY j.started_at DESC, j.id DESC LIMIT 1) AS job_status,
                      (SELECT j.progress FROM ingest_jobs j WHERE j.book_id = b.id ORDER BY j.started_at DESC, j.id DESC LIMIT 1) AS job_progress
                 FROM books b ORDER BY b.title`,
            )).catch(() => [] as never[]))
        const { ingestProgress } = yield* Effect.promise(() => import("@diveeoi/learning/ingest/run"))
        return {
          books: rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            title: r.title,
            author: r.author ?? undefined,
            lang: r.lang ?? undefined,
            status: r.status,
            pages: r.pages ?? undefined,
            chunkCount: r.chunk_count,
            indexedAt: r.indexed_at ?? undefined,
            error: r.error ?? undefined,
            jobId: r.job_id ?? undefined,
            jobStatus: r.job_status ?? undefined,
            progress: ingestProgress(r.id)?.progress ?? r.job_progress ?? undefined,
          })),
        }
      })

      const listJobs = Effect.fn("TargetedLearning.listJobs")(function* () {
        const db = tl.booksStore.available ? tl.booksStore.db : null
        if (!db) return { jobs: [] }
        const ingest = yield* Effect.promise(() => import("@diveeoi/learning/ingest/run"))
        return { jobs: yield* Effect.promise(() => ingest.listIngestJobs(db)) }
      })

      const pauseJob = Effect.fn("TargetedLearning.pauseJob")(function* (ctx: { params: { jobID: string } }) {
        const db = tl.booksStore.available ? tl.booksStore.db : null
        if (!db) return false
        const ingest = yield* Effect.promise(() => import("@diveeoi/learning/ingest/run"))
        return yield* Effect.tryPromise({
          try: () => ingest.pauseIngestJob(db, ctx.params.jobID),
          catch: () => new HttpApiError.BadRequest({}),
        })
      })

      const resumeJob = Effect.fn("TargetedLearning.resumeJob")(function* (ctx: { params: { jobID: string } }) {
        const db = tl.booksStore.available ? tl.booksStore.db : null
        if (!db) return false
        const ingest = yield* Effect.promise(() => import("@diveeoi/learning/ingest/run"))
        return yield* Effect.tryPromise({
          try: () => ingest.resumeIngestJob(db, ctx.params.jobID, tl.dataDir),
          catch: () => new HttpApiError.BadRequest({}),
        })
      })

      const cancelJob = Effect.fn("TargetedLearning.cancelJob")(function* (ctx: { params: { jobID: string } }) {
        const db = tl.booksStore.available ? tl.booksStore.db : null
        if (!db) return false
        const ingest = yield* Effect.promise(() => import("@diveeoi/learning/ingest/run"))
        return yield* Effect.tryPromise({
          try: () => ingest.cancelIngestJob(db, ctx.params.jobID),
          catch: () => new HttpApiError.BadRequest({}),
        })
      })

      const retryJob = Effect.fn("TargetedLearning.retryJob")(function* (ctx: { params: { jobID: string } }) {
        const db = tl.booksStore.available ? tl.booksStore.db : null
        if (!db) return false
        const ingest = yield* Effect.promise(() => import("@diveeoi/learning/ingest/run"))
        return yield* Effect.tryPromise({
          try: () => ingest.retryIngestJob(db, ctx.params.jobID, tl.dataDir),
          catch: () => new HttpApiError.BadRequest({}),
        })
      })

      // Add a book: validate, register, and index in the background (plan §7).
      const startBook = (filename: string, bytes: Uint8Array, title?: string) =>
        Effect.gen(function* () {
          const store = tl.booksStore
          if (!store.available || !store.db) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const cfg = yield* configSvc.get().pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>))
          const settings = withDefaults(((cfg as Record<string, unknown>).targetedLearning as never) ?? undefined)
          const ingest = yield* Effect.promise(() => import("@diveeoi/learning/ingest/run"))
          return yield* Effect.tryPromise({
            try: () =>
              ingest.startIngest({ db: store.db!, dataDir: tl.dataDir, filename, bytes, title, settings: settings as never }),
            catch: () => new HttpApiError.BadRequest({}),
          })
        })

      const uploadBook = Effect.fn("TargetedLearning.uploadBook")(function* (ctx: {
        payload: { filename: string; contentBase64: string; title?: string }
      }) {
        const bytes = new Uint8Array(Buffer.from(ctx.payload.contentBase64, "base64"))
        if (bytes.byteLength === 0) return yield* Effect.fail(new HttpApiError.BadRequest({}))
        return yield* startBook(ctx.payload.filename, bytes, ctx.payload.title)
      })

      const importBook = Effect.fn("TargetedLearning.importBook")(function* (ctx: {
        payload: { path: string; title?: string }
      }) {
        const fs = yield* Effect.promise(() => import("node:fs"))
        const path = yield* Effect.promise(() => import("node:path"))
        const bytes = yield* Effect.try({
          try: () => new Uint8Array(fs.readFileSync(ctx.payload.path)),
          catch: () => new HttpApiError.BadRequest({}),
        })
        return yield* startBook(path.basename(ctx.payload.path), bytes, ctx.payload.title)
      })

      const searchInspector = Effect.fn("TargetedLearning.search")(function* (ctx: {
        payload: { query: string; bookIds?: readonly string[]; recentUserTurns?: readonly string[] }
      }) {
        const cfg = yield* configSvc.get().pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>))
        const turn = yield* Effect.promise(() => import("@diveeoi/learning/session/turn"))
        return yield* Effect.promise(() =>
          turn.inspectRetrieval({
            query: ctx.payload.query,
            bookIds: ctx.payload.bookIds ? [...ctx.payload.bookIds] : undefined,
            recentUserTurns: ctx.payload.recentUserTurns ? [...ctx.payload.recentUserTurns] : undefined,
            settings: (cfg as Record<string, unknown>).targetedLearning as never,
          }),
        )
      })

      const listMemory = Effect.fn("TargetedLearning.listMemory")(function* () {
        const mem = yield* Effect.promise(() => import("@diveeoi/learning/memory/service"))
        const student = mem.listStudentMemories().map((r) => ({ id: r.id, kind: r.kind, text: r.text, pinned: r.pinned, uses: r.uses }))
        const db = tl.booksStore.available ? tl.booksStore.db : null
        const notes = db ? yield* Effect.promise(() => mem.listBookNotes(db)) : []
        return {
          student,
          notes: notes.map((n) => ({ id: n.id, bookId: n.bookId, bookTitle: n.bookTitle, kind: n.kind, text: n.text, stale: n.stale })),
        }
      })
      const deleteStudentMemoryHandler = Effect.fn("TargetedLearning.deleteStudentMemory")(function* (ctx: { params: { memoryID: string } }) {
        const mem = yield* Effect.promise(() => import("@diveeoi/learning/memory/service"))
        return mem.deleteStudentMemory(ctx.params.memoryID)
      })
      const pinStudentMemoryHandler = Effect.fn("TargetedLearning.pinStudentMemory")(function* (ctx: {
        params: { memoryID: string }
        payload: { pinned: boolean }
      }) {
        const mem = yield* Effect.promise(() => import("@diveeoi/learning/memory/service"))
        return mem.pinStudentMemory(ctx.params.memoryID, ctx.payload.pinned)
      })
      const deleteNoteHandler = Effect.fn("TargetedLearning.deleteNote")(function* (ctx: { params: { noteID: string } }) {
        const db = tl.booksStore.available ? tl.booksStore.db : null
        if (!db) return false
        const mem = yield* Effect.promise(() => import("@diveeoi/learning/memory/service"))
        return yield* Effect.promise(() => mem.deleteBookNote(db, ctx.params.noteID))
      })

      const deleteBookHandler = Effect.fn("TargetedLearning.deleteBook")(function* (ctx: { params: { bookID: string } }) {
        const store = tl.booksStore
        if (!store.available || !store.db) return yield* Effect.fail(new HttpApiError.BadRequest({}))
        const ingest = yield* Effect.promise(() => import("@diveeoi/learning/ingest/run"))
        return yield* Effect.tryPromise({
          try: () => ingest.deleteBook(store.db!, tl.dataDir, ctx.params.bookID),
          catch: () => new HttpApiError.BadRequest({}),
        })
      })

      return handlers
        .handle("setup-status", setupStatus)
        .handle("setup-start", setupStart)
        .handle("setup-repair", setupRepair)
        .handle("setup-cancel", setupCancel)
        .handle("setup-import-local", setupImportLocal)
        .handle("settings", getSettings)
        .handle("settings-update", updateSettings)
        .handle("settings-schema", getSettingsSchema)
        .handle("settings-presets", getSettingsPresets)
        .handle("health", health)
        .handle("probe", probe)
        .handle("books", listBooks)
        .handle("jobs", listJobs)
        .handle("jobs-pause", pauseJob)
        .handle("jobs-resume", resumeJob)
        .handle("jobs-cancel", cancelJob)
        .handle("jobs-retry", retryJob)
        .handle("books-upload", uploadBook)
        .handle("books-import", importBook)
        .handle("books-delete", deleteBookHandler)
        .handle("search", searchInspector)
        .handle("memory", listMemory)
        .handle("memory-student-delete", deleteStudentMemoryHandler)
        .handle("memory-student-pin", pinStudentMemoryHandler)
        .handle("memory-note-delete", deleteNoteHandler)
    }),
)
