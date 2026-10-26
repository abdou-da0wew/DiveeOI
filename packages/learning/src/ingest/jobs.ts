// packages/learning/src/ingest/jobs.ts
//
// Ingest job queue with checkpoints (plan §7.7).
//
// A job is a session of stages: parse → chunk → embed → index → summary.
// Each stage writes a checkpoint after every batch, so a crash or kill
// resumes where it stopped. Jobs can be paused and cancelled.
//
// The MAIN THREAD is the only SQLite writer. Workers return results as
// messages; the job coordinator writes them to books.db.
//
// Phase 2 implementation. Phase 1 ships the job schema and the persistence
// model (already in store/schema.ts as `ingest_jobs`).

import { Effect, Schema } from "effect"

export const JobStage = Schema.Literals(["parse", "chunk", "embed", "index", "summary"])
export type JobStage = Schema.Schema.Type<typeof JobStage>

export const JobStatus = Schema.Literals(["queued", "running", "paused", "complete", "failed", "cancelled"])
export type JobStatus = Schema.Schema.Type<typeof JobStatus>

export const Job = Schema.Struct({
  id: Schema.String,
  bookId: Schema.String,
  stage: JobStage,
  status: JobStatus,
  progress: Schema.Number, // 0-100
  checkpointJson: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  finishedAt: Schema.optional(Schema.Number),
})
export type Job = Schema.Schema.Type<typeof Job>

// ---------------------------------------------------------------------------
// Re-index triggers (plan §7.9)
// ---------------------------------------------------------------------------

export const ReindexReason = Schema.Literals([
  "embed-signature-changed", // re-embed only
  "normalizer-version-changed", // rebuild FTS only (cheap)
  "parser-version-changed", // full re-ingest
  "user-requested",
])
export type ReindexReason = Schema.Schema.Type<typeof ReindexReason>

// Phase 2 implements the job runner. Phase 1 ships only the types so the
// HTTP API can list/pause/resume/cancel jobs against the ingest_jobs table.
