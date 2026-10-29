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
      // Persisted step result (probe output, benchmark numbers, ...). Null
      // when the step hasn't produced a result yet. Kept as Schema.Unknown
      // because each step produces a different shape.
      result: Schema.optional(Schema.Unknown),
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

const IngestJobResponse = Schema.Struct({
  id: Schema.String,
  bookId: Schema.String,
  stage: Schema.String,
  status: Schema.String,
  progress: Schema.Number,
  checkpointJson: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  finishedAt: Schema.optional(Schema.Number),
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
        HttpApiEndpoint.get("debug-status", `${root}/debug/status`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Unknown, "Opt-in Targeted Learning diagnostics snapshot"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.debug.status",
            summary: "Inspect runtime Targeted Learning diagnostics",
            description:
              "Returns active operation spans, detected stalls, recent errors, event counts, " +
              "and the configured debug log path. Detailed diagnostics must be enabled with DIVEEOI_TL_DEBUG.",
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
                  error: Schema.optional(Schema.String),
                  jobId: Schema.optional(Schema.String),
                  jobStatus: Schema.optional(Schema.String),
                  progress: Schema.optional(Schema.Number),
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
      // Ingest jobs — persistent pause/resume/cancel and retry after a failure.
      .add(
        HttpApiEndpoint.get("jobs", `${root}/jobs`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Struct({ jobs: Schema.Array(IngestJobResponse) }), "Persistent ingest jobs"),
        }).annotateMerge(OpenApi.annotations({
          identifier: "targeted-learning.jobs.list",
          summary: "List book-ingest jobs",
        })),
      )
      .add(
        HttpApiEndpoint.post("jobs-pause", `${root}/jobs/:jobID/pause`, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Job paused"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(OpenApi.annotations({ identifier: "targeted-learning.jobs.pause", summary: "Pause an ingest job" })),
      )
      .add(
        HttpApiEndpoint.post("jobs-resume", `${root}/jobs/:jobID/resume`, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Job resumed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(OpenApi.annotations({ identifier: "targeted-learning.jobs.resume", summary: "Resume an ingest job" })),
      )
      .add(
        HttpApiEndpoint.post("jobs-cancel", `${root}/jobs/:jobID/cancel`, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Job cancelled"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(OpenApi.annotations({ identifier: "targeted-learning.jobs.cancel", summary: "Cancel an ingest job" })),
      )
      .add(
        HttpApiEndpoint.post("jobs-retry", `${root}/jobs/:jobID/retry`, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Job retried"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(OpenApi.annotations({ identifier: "targeted-learning.jobs.retry", summary: "Retry a failed ingest job" })),
      )
      // Books — add (base64 upload), import (server-side path), delete
      .add(
        HttpApiEndpoint.post("books-upload", `${root}/books`, {
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({
            filename: Schema.String,
            contentBase64: Schema.String,
            title: Schema.optional(Schema.String),
          }),
          success: described(
            Schema.Struct({ bookId: Schema.String, slug: Schema.String, duplicate: Schema.Boolean }),
            "Book accepted; indexing runs in the background",
          ),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.books.upload",
            summary: "Add a book",
            description: "Upload a PDF, DOCX or TXT (base64). Indexing runs in the background; poll the book list for status.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("books-import", `${root}/books/import`, {
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({ path: Schema.String, title: Schema.optional(Schema.String) }),
          success: described(
            Schema.Struct({ bookId: Schema.String, slug: Schema.String, duplicate: Schema.Boolean }),
            "Book accepted; indexing runs in the background",
          ),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.books.import",
            summary: "Add a book from a path on the server",
            description: "For large books on the machine running DiveeOI. Same indexing as upload.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.delete("books-delete", `${root}/books/:bookID`, {
          params: { bookID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Book removed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.books.delete",
            summary: "Delete a book",
            description: "Removes the book, its passages and vectors, and its stored source file.",
          }),
        ),
      )
      // Retrieval inspector: what would the gate do with this question? (plan §8.6)
      .add(
        HttpApiEndpoint.post("search", `${root}/search`, {
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({
            query: Schema.String,
            bookIds: Schema.optional(Schema.Array(Schema.String)),
            recentUserTurns: Schema.optional(Schema.Array(Schema.String)),
          }),
          success: described(Schema.Unknown, "Gate decision, best scores, thresholds and the top passages"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "targeted-learning.search",
            summary: "Inspect retrieval",
            description: "Runs the real retrieval and gate for a question without calling an LLM. Used to tune gate thresholds.",
          }),
        ),
      )
      // Student memory + book notes (view, pin, delete)
      .add(
        HttpApiEndpoint.get("memory", `${root}/memory`, {
          query: WorkspaceRoutingQuery,
          success: described(
            Schema.Struct({
              student: Schema.Array(
                Schema.Struct({ id: Schema.String, kind: Schema.String, text: Schema.String, pinned: Schema.Boolean, uses: Schema.Number }),
              ),
              notes: Schema.Array(
                Schema.Struct({
                  id: Schema.String,
                  bookId: Schema.String,
                  bookTitle: Schema.optional(Schema.String),
                  kind: Schema.String,
                  text: Schema.String,
                  stale: Schema.Boolean,
                }),
              ),
            }),
            "Everything remembered about the student and about books",
          ),
        }).annotateMerge(
          OpenApi.annotations({ identifier: "targeted-learning.memory.list", summary: "List student memory and book notes" }),
        ),
      )
      .add(
        HttpApiEndpoint.delete("memory-student-delete", `${root}/memory/student/:memoryID`, {
          params: { memoryID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Removed"),
        }).annotateMerge(
          OpenApi.annotations({ identifier: "targeted-learning.memory.student.delete", summary: "Delete a student memory" }),
        ),
      )
      .add(
        HttpApiEndpoint.post("memory-student-pin", `${root}/memory/student/:memoryID/pin`, {
          params: { memoryID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({ pinned: Schema.Boolean }),
          success: described(Schema.Boolean, "Updated"),
        }).annotateMerge(
          OpenApi.annotations({ identifier: "targeted-learning.memory.student.pin", summary: "Pin or unpin a student memory" }),
        ),
      )
      .add(
        HttpApiEndpoint.delete("memory-note-delete", `${root}/memory/notes/:noteID`, {
          params: { noteID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Removed"),
        }).annotateMerge(
          OpenApi.annotations({ identifier: "targeted-learning.memory.note.delete", summary: "Delete a book note" }),
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
