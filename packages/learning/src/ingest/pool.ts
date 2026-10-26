// packages/learning/src/ingest/pool.ts
//
// Worker pool (plan §7.7). Spawns Bun Workers from embed/worker.entry.ts,
// maintains a shared work queue, balances embedding batches across workers,
// bucketed by chunk length to avoid padding waste.
//
// Phase 2 implementation. Phase 1 ships the interface and the worker caps.

import { Effect, Schema } from "effect"
import type { EmbedOptions, EmbedSignature } from "../embed/pipeline"

export const PoolStatus = Schema.Struct({
  workers: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      state: Schema.Literals(["idle", "loading", "embedding", "unloaded", "errored"]),
      batchesProcessed: Schema.Number,
      lastError: Schema.optional(Schema.String),
    }),
  ),
  queueDepth: Schema.Number,
  totalBatches: Schema.Number,
  totalChunksEmbedded: Schema.Number,
})
export type PoolStatus = Schema.Schema.Type<typeof PoolStatus>

export interface PoolConfig {
  workersPerBook: number
  maxWorkers: number | "auto"
  maxConcurrentBooks: number
  pauseWhileChatting: boolean
  cpuPriority: "low" | "normal" | "high"
  maxMemoryMB: number | "auto"
  idleUnloadSec: number
}

/**
 * Phase 2: the real pool. Phase 1 returns a stub that always reports
 * "no workers running". The HTTP API exposes the pool status, but
 * Phase 1's pool is empty until Setup completes.
 */
export interface IngestPool {
  /** Pool status snapshot. */
  status: () => Effect.Effect<PoolStatus, never>
  /** Pause all workers. Called when a chat starts streaming (pauseWhileChatting). */
  pause: () => Effect.Effect<void, never>
  /** Resume all workers. */
  resume: () => Effect.Effect<void, never>
  /** Cancel all in-flight jobs for a book. */
  cancel: (bookId: string) => Effect.Effect<void, never>
}

export const makePool = (
  _modelDir: string,
  _signature: EmbedSignature,
  _options: EmbedOptions,
  _config: PoolConfig,
): Effect.Effect<IngestPool, never> =>
  Effect.sync(() => {
    // Phase 2 implementation: spawn `new Worker(new URL('../embed/worker.entry.ts', import.meta.url))`,
    // wire messages, manage the shared queue.
    //
    // Phase 1 stub: every method is a no-op; status() reports an empty pool.
    return {
      status: () =>
        Effect.succeed({
          workers: [],
          queueDepth: 0,
          totalBatches: 0,
          totalChunksEmbedded: 0,
        }),
      pause: () => Effect.void,
      resume: () => Effect.void,
      cancel: () => Effect.void,
    }
  })
