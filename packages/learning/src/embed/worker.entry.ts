// packages/learning/src/embed/worker.entry.ts
//
// Bun Worker entry point (plan §7.7). This file is the worker — it is
// spawned by ingest/pool.ts via `new Worker(new URL('./worker.entry.ts', import.meta.url))`.
//
// Message protocol (Phase 1, fixed in Phase 2 with the worker pool):
//
//   Main → Worker:
//     { kind: "init", modelDir, signature, options }
//     { kind: "embed", batchId, texts: string[] }
//     { kind: "unload" }
//
//   Worker → Main:
//     { kind: "ready" }
//     { kind: "embedded", batchId, vectors: Float32Array[] }
//     { kind: "error", batchId?, message }
//
// The worker NEVER touches SQLite. It only embeds and posts back.
//
// Phase 2 implements this fully (worker pool, message handling, model
// lifecycle). Phase 1 ships the protocol as a stub so the package
// bundles correctly.

// @ts-nocheck
import { Effect } from "effect"
import * as Pipeline from "./pipeline"

void Effect
void Pipeline

// Phase 2 will fill this in. Until then, this file is a placeholder.
export const workerEntryPlaceholder = "Phase 2 implements the Bun worker entry"
