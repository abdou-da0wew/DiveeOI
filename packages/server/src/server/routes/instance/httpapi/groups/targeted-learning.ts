// packages/server/src/server/routes/instance/httpapi/groups/targeted-learning.ts
//
// /targeted-learning route group (plan §12).
//
// Endpoints:
//   - Setup:    status, start, repair, cancel, import-local, events (SSE)
//   - Settings: values (get/patch), schema, effective config, presets
//   - Books:    list, upload, get, delete, re-index, jobs (list/pause/resume/cancel), backup
//   - Search:   debug retrieval (inspector)
//   - Memory:   student CRUD + export; book notes CRUD per book
//   - System:   resources, health
//
// All routes sit behind the same Authorization + InstanceContext + WorkspaceRouting
// middleware as the rest of the instance API. No unauthenticated routes.

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { TargetedLearningSettingsSchema, SetupStateSchema, ProbeResultSchema } from "@diveeoi/learning"

const root = "/targeted-learning"

// ---------------------------------------------------------------------------
// Response schemas (small wrappers — the real schemas come from @diveeoi/learning)
// ---------------------------------------------------------------------------

const SetupStatusResponse = Schema.Struct({
  status: Schema.Literals(["not-started", "in-progress", "ready", "needs-repair"]),
  steps: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.Literals(["pending", "running", "complete", "failed", "skipped"]),
      attempts: Schema.Number,
      lastError: Schema.optional(Schema.String),
    }),
  ),
  recommendedProfile: Schema.optional(Schema.Literals(["low", "balanced", "high"])),
})

const SettingsResponse = Schema.Struct({
  values: TargetedLearningSettingsSchema,
  effective: Schema.Unknown, // values with sources (env, file, default, override)
})

const HealthResponse = Schema.Struct({
  setupStatus: Schema.String,
  booksDbAvailable: Schema.Boolean,
  booksDbReason: Schema.optional(Schema.String),
  modelReady: Schema.Boolean,
  manifestLoaded: Schema.Boolean,
})

const StartSetupRequest = Schema.Struct({
  force: Schema.optional(Schema.Boolean),
  dtype: Schema.optional(Schema.Literals(["int8", "q4f16", "fp16", "fp32"])),
})

// ---------------------------------------------------------------------------
// Group declaration
// ---------------------------------------------------------------------------

export const TargetedLearningApi = HttpApi.make("targeted-learning")
  .add(
    HttpApiGroup.make("targeted-learning")
      // Setup
      .add(
        HttpApiEndpoint.get("setup-status", `${root}/setup`, {
          query: WorkspaceRoutingQuery,
          success: described(SetupStatusResponse, "Setup status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.setup.status",
            summary: "Get Targeted Learning setup status",
            description: "Returns the persisted setup state: which steps are complete, which failed, and the recommended profile.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("setup-start", `${root}/setup/start`, {
          query: WorkspaceRoutingQuery,
          payload: StartSetupRequest,
          success: described(SetupStatusResponse, "Setup started"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.setup.start",
            summary: "Start (or resume) Targeted Learning setup",
            description: "Runs setup steps from where they left off. The first call triggers the probe + preflight + download + verify + runtime-check + golden-self-test + benchmark + recommend-profile pipeline.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("setup-repair", `${root}/setup/repair`, {
          query: WorkspaceRoutingQuery,
          success: described(SetupStatusResponse, "Setup reset for repair"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.setup.repair",
            summary: "Reset setup state for repair",
            description: "Clears all step statuses and re-runs from probe. Used by the Repair button in the UI.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("setup-cancel", `${root}/setup/cancel`, {
          query: WorkspaceRoutingQuery,
          success: described(SetupStatusResponse, "Setup cancelled"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.setup.cancel",
            summary: "Cancel a running setup",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("setup-import-local", `${root}/setup/import-local`, {
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({ folder: Schema.String }),
          success: described(SetupStatusResponse, "Import completed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.setup.import-local",
            summary: "Import model from a local folder",
            description: "For offline machines. Verifies the folder against the manifest, then copies files into the data dir.",
          }),
        ),
      )
      // Settings
      .add(
        HttpApiEndpoint.get("settings", `${root}/settings`, {
          query: WorkspaceRoutingQuery,
          success: described(SettingsResponse, "Settings values and effective config"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.settings.get",
            summary: "Get Targeted Learning settings",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.patch("settings-update", `${root}/settings`, {
          query: WorkspaceRoutingQuery,
          payload: TargetedLearningSettingsSchema,
          success: described(SettingsResponse, "Updated settings"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.settings.update",
            summary: "Update Targeted Learning settings",
            description: "UI edits are written to the global config layer so the file and the UI never drift (plan §11.2).",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("settings-schema", `${root}/settings/schema`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Unknown, "JSON Schema with custom annotations"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.settings.schema",
            summary: "Get the settings JSON schema",
            description: "Returns the full Effect Schema as JSON Schema, including the custom @diveeoi/learning/* annotations the UI form generator reads.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("settings-presets", `${root}/settings/presets`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Record(Schema.String, Schema.Unknown), "Presets"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.settings.presets",
            summary: "List available presets (low / balanced / high)",
          }),
        ),
      )
      // System
      .add(
        HttpApiEndpoint.get("health", `${root}/health`, {
          query: WorkspaceRoutingQuery,
          success: described(HealthResponse, "Health"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.health",
            summary: "Health check",
            description: "Returns setup status, books.db availability, model readiness, and manifest presence.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("probe", `${root}/probe`, {
          query: WorkspaceRoutingQuery,
          success: described(ProbeResultSchema, "Probe result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.probe",
            summary: "Run the system probe",
            description: "Detects OS, arch, CPU, AVX, RAM, disk, libc, and recommends a profile.",
          }),
        ),
      )
      // Books — list all indexed books (used by the composer @book: autocomplete)
      .add(
        HttpApiEndpoint.get("books", `${root}/books`, {
          query: WorkspaceRoutingQuery,
          success: described(
            Schema.Struct({
              books: Schema.Array(
                Schema.Struct({
                  id: Schema.String,
                  slug: Schema.String,
                  title: Schema.String,
                  author: Schema.optional(Schema.String),
                  lang: Schema.optional(Schema.String),
                  status: Schema.String,
                  pages: Schema.optional(Schema.Number),
                  chunkCount: Schema.Number,
                  indexedAt: Schema.optional(Schema.Number),
                }),
              ),
            }),
            "List of indexed books",
          ),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.books.list",
            summary: "List indexed books",
            description: "Returns all books in the library with their indexing status. Used by the composer @book: autocomplete.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "targeted-learning",
          description: "Targeted Learning (RAGed-Session): self-hosted, book-grounded learning sessions.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "DiveeOI Targeted Learning",
      version: "0.1.0",
      description: "Book-grounded learning sessions API.",
    }),
  )

// Re-export the SetupStateSchema so the handlers file can import from here
// without re-importing from the package.
export { SetupStateSchema }
