// packages/learning/src/embed/index.ts
//
// Embedding module entry. Re-exports the Transformers.js pipeline for
// non-worker use (self-test, query encoding, the in-process ingest fallback).
//
// Reality check — the plan §7.7 sketch in the old header is not what shipped:
//   - The worker pool lives in ingest/embed-pool.ts (createEmbedWorkerPool):
//     N Bun Workers, each loading the model from embed/worker.entry.ts, fed
//     from a queue by ingest/run.ts.
//   - In-process embedding via embedBatch (re-exported below) is the DEFAULT
//     path; separate worker threads are opt-in (DIVEEOI_TL_WORKER_THREADS=1 or
//     the workerUrl test seam).
//   - The main thread is the only SQLite writer; workers only return vectors.
//   - The former Phase-1 stub ingest/pool.ts (empty makePool/PoolStatus) was
//     deleted — it had no importers and no HTTP pool-status endpoint ever
//     existed; job progress is served from ingest_jobs via ingest/run.ts.

export * from "./pipeline"
