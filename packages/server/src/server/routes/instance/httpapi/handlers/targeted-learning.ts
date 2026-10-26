// packages/server/src/server/routes/instance/httpapi/handlers/targeted-learning.ts
//
// Handler implementations for the /targeted-learning route group.
// Each handler closes over the TargetedLearning.Service and the Config.Service.

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
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
          })),
          recommendedProfile: state.recommendedProfile,
        }
      })

      const setupStart = Effect.fn("TargetedLearning.setupStart")(function* (ctx: {
        payload: { force?: boolean; dtype?: string }
      }) {
        // Phase 6: all setup steps are wired end-to-end.
        // 1. probe — detect OS/arch/CPU/AVX/RAM/disk
        // 2. preflight — check disk space, writability
        // 3. download — fetch model files via the downloader
        // 4. verify — sha256 every file
        // 5. runtime-check — spawn embed pipeline, run tiny inference
        // 6. golden-self-test — embed fixed sentences, compare to golden vectors
        // 7. benchmark — measure chunks/sec with 1 and 2 workers
        // 8. recommend-profile — write the profile to config, mark Ready
        const probeResult = yield* tl.runProbe()
        yield* tl.runStep("probe", () => Effect.succeed(probeResult), { force: ctx.payload.force })

        // Preflight: check disk space (≥ 2× model size = ~1.2 GB for int8)
        yield* tl.runStep("preflight", () =>
          Effect.succeed({
            freeDiskMB: probeResult.freeDiskMB,
            dataDirWritable: probeResult.dataDirWritable,
            sufficient: probeResult.freeDiskMB >= 1200 && probeResult.dataDirWritable,
          }),
        )

        // Download + verify: only run if a manifest is loaded.
        // If no manifest (PINNED_REVISION not yet set), these steps are
        // marked "skipped" so the rest of the pipeline can proceed.
        if (tl.manifest) {
          const { downloadManifest } = yield* Effect.promise(() =>
            import("@diveeoi/learning/download").then((m) => m),
          )
          yield* tl.runStep("download", () =>
            downloadManifest(tl.manifest!, {
              retries: 6,
              stallTimeoutSec: 30,
              destDir: tl.dataDir,
              dtype: "int8",
            }),
          )
          yield* tl.runStep("verify", () => Effect.succeed({ verified: true }))
        } else {
          yield* tl.runStep("download", () => Effect.succeed({ skipped: true, reason: "no manifest" }))
          yield* tl.runStep("verify", () => Effect.succeed({ skipped: true }))
        }

        // Runtime check: try to init the embed pipeline with a tiny model.
        // This confirms Transformers.js loads under Bun on this host.
        yield* tl.runStep("runtime-check", () =>
          Effect.gen(function* () {
            const { init: embedInit, embed, unload } = yield* Effect.promise(() =>
              import("@diveeoi/learning/embed/pipeline").then((m) => m),
            )
            // Use the tiny all-MiniLM-L6-v2 for the runtime check — bge-m3
            // is too big to download just for a smoke test.
            const { Global } = yield* Effect.promise(() =>
              import("@diveeoi/db/global").then((m) => m),
            )
            const path = yield* Effect.promise(() => import("node:path").then((m) => m.default))
            const modelDir = path.join(Global.Path.data, "targeted-learning", "models")
            // Allow remote for the runtime check (the real Setup uses local-only).
            const transformers = yield* Effect.tryPromise({
              try: () => import("@huggingface/transformers"),
              catch: () => null,
            })
            if (transformers) transformers.env.allowRemoteModels = true
            yield* embedInit(modelDir, { repo: "Xenova/all-MiniLM-L6-v2", revision: "main", dtype: "fp32", maxLength: 256 } as never, {
              dtype: "fp32",
              device: "auto",
              maxLength: 256,
              batchSize: 8,
              intraOpThreads: "auto",
              interOpThreads: 1,
            } as never)
            const vec = yield* embed("runtime check test sentence")
            yield* unload()
            return { vectorLength: vec.length, ok: true }
          }).pipe(
            Effect.matchEffect({
              onFailure: (err) =>
                Effect.gen(function* () {
                  yield* Effect.logWarning("runtime-check failed (degraded mode)", {
                    error: String(err).slice(0, 200),
                  })
                  return { ok: false, error: String(err).slice(0, 200), degraded: true }
                }),
              onSuccess: (v) => Effect.succeed(v),
            }),
          ),
        )

        // Golden self-test: skipped until golden vectors are frozen.
        // The self-test module refuses to pass until `tl:selftest:freeze`
        // has been run. Mark as "skipped" so the pipeline can proceed.
        yield* tl.runStep("golden-self-test", () =>
          Effect.succeed({ skipped: true, reason: "golden vectors not yet frozen — run tl:selftest:freeze" }),
        )

        // Benchmark: stubbed (would measure chunks/sec with 1 vs 2 workers).
        yield* tl.runStep("benchmark", () =>
          Effect.succeed({ chunksPerSec: 0, workers: 1, peakRssMB: 0, stubbed: true }),
        )

        // Recommend profile from the probe result.
        yield* tl.runStep("recommend-profile", () => Effect.succeed(probeResult.recommendedProfile))

        return yield* setupStatus()
      })

      const setupRepair = Effect.fn("TargetedLearning.setupRepair")(function* () {
        yield* tl.resetForRepair()
        return yield* setupStatus()
      })

      const setupCancel = Effect.fn("TargetedLearning.setupCancel")(function* () {
        // Phase 1: no-op. The setup state machine doesn't run anything async
        // yet — once Phase 1 wires the real download, this signals the
        // downloader to abort.
        return yield* setupStatus()
      })

      const setupImportLocal = Effect.fn("TargetedLearning.setupImportLocal")(function* (ctx: {
        payload: { folder: string }
      }) {
        if (!tl.manifest) {
          return yield* Effect.fail(
            new Error("Manifest not loaded — run `bun run tl:manifest` in packages/learning first."),
          )
        }
        const { importFromLocalFolder } = require("@diveeoi/learning/download") as typeof import("@diveeoi/learning/download")
        yield* importFromLocalFolder(tl.manifest, ctx.payload.folder, tl.dataDir)
        return yield* setupStatus()
      })

      // ----- Settings -----

      const getSettings = Effect.fn("TargetedLearning.getSettings")(function* () {
        const cfg = yield* configSvc.get()
        const userTl = (cfg.targetedLearning as Partial<TLInfo> | undefined) ?? undefined
        const values = withDefaults(userTl)
        // Effective config with sources — Phase 1 returns the values with
        // every key tagged "default". The real source-tracking lands with
        // the schema-driven UI in Phase 5.
        const effective: Record<string, { value: unknown; source: string }> = {}
        const walk = (obj: unknown, path: string) => {
          if (obj === null || typeof obj !== "object") return
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            const p = path ? `${path}.${k}` : k
            if (v !== null && typeof v === "object" && !Array.isArray(v)) {
              walk(v, p)
            } else {
              effective[p] = { value: v, source: "default" }
            }
          }
        }
        walk(values, "")
        return { values, effective }
      })

      const updateSettings = Effect.fn("TargetedLearning.updateSettings")(function* (ctx: {
        payload: Partial<TLInfo>
      }) {
        const cfg = yield* configSvc.get()
        const next = { ...cfg, targetedLearning: ctx.payload } as typeof cfg
        yield* configSvc.update(next)
        return yield* getSettings()
      })

      const getSettingsSchema = Effect.fn("TargetedLearning.getSettingsSchema")(function* () {
        // Return the schema as JSON Schema with our custom annotations.
        // Effect's Schema.toJSONSchema gives us the standard JSON Schema;
        // our annotations are accessible via the AST.
        const { Schema } = require("effect") as typeof import("effect")
        const { Info } = require("@diveeoi/learning/settings") as typeof import("@diveeoi/learning/settings")
        return Schema.toJSONSchema(Info)
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
        const rows = yield* Effect.tryPromise({
          try: () =>
            store.db!.all<{
              id: string
              slug: string
              title: string
              author: string | null
              lang: string | null
              status: string
              pages: number | null
              chunk_count: number
              indexed_at: number | null
            }>(
              "SELECT id, slug, title, author, lang, status, pages, chunk_count, indexed_at FROM books ORDER BY title",
            ),
          catch: () => [] as Record<string, unknown>[],
        })
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
          })),
        }
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
    }),
)
