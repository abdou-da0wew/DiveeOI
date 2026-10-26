// packages/learning/src/embed/index.ts
//
// Bun Worker entry point for embedding (plan §7.7).
//
// Worker model (plan §7.7):
//   - Worker A parses and chunks, streaming batches to the main thread.
//   - Worker B loads the model while A is parsing.
//   - Embedding batches go to BOTH workers from a shared work queue.
//   - Chunks are bucketed by length to avoid padding waste.
//   - The MAIN THREAD is the only SQLite writer. Workers return results as messages.
//   - A checkpoint is written after each batch.
//
// This file is the Worker entry — it receives chunk batches via postMessage,
// runs the embed pipeline, and posts back the vectors. It does NOT touch
// the database.
//
// Phase 1 ships the message protocol. Phase 2 implements the worker pool
// in ingest/pool.ts that spawns these.

export {}
// Bun Worker entry is a separate file: embed/worker.entry.ts.
// This file re-exports the pipeline for non-worker use (e.g. self-test).
export * from "./pipeline"
