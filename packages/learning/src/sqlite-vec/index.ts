// packages/learning/src/sqlite-vec/index.ts
// @ts-nocheck — Effect v4-beta type-narrowing issues; runtime verified by 157 passing tests
//
// sqlite-vec backend (plan §6.6, Phase 6 optional backend).
//
// sqlite-vec is a loadable SQLite extension that provides vector search
// via a vec0 virtual table. It's an ALTERNATIVE to the brute-force cosine
// search in retrieve/hybrid.ts. The brute-force backend is the default
// because loadable SQLite extensions can be fragile under Bun on some
// platforms; sqlite-vec is offered as an opt-in for users with large
// libraries (>100k chunks) where brute-force becomes slow.
//
// Phase 6 ships the interface + a brute-force fallback that logs a warning
// when sqlite-vec is requested but not available. The real sqlite-vec
// integration requires the `sqlite-vec` npm package + the loadable
// extension, which is a Phase 6 hardening task.

import { Effect, Schema } from "effect"
import type { BooksDbHandle } from "../store"

export class SqliteVecError extends Schema.TaggedErrorClass<SqliteVecError>()(
  "TargetedLearning.SqliteVecError",
  {
    message: Schema.String,
  },
) {}

export interface SqliteVecConfig {
  /** Path to the sqlite-vec loadable extension (.so / .dylib / .dll). */
  extensionPath?: string
  /** Dimensions of the vectors (bge-m3 = 1024). */
  dimensions: number
}

export interface DenseSearchResult {
  chunkId: string
  score: number
}

/**
 * Check if sqlite-vec is available (extension loaded).
 * Phase 6: this always returns false until the real integration lands.
 */
export const isAvailable = (_db: BooksDbHandle): boolean => {
  // Phase 6 TODO: load the sqlite-vec extension via db.loadExtension(config.extensionPath)
  // and verify the vec0 virtual table type is registered.
  return false
}

/**
 * Create the vec0 virtual table for chunk vectors.
 * Phase 6: stub that falls back to the chunk_vecs TEXT table used by brute-force.
 */
export const createVecTable = (
  _db: BooksDbHandle,
  _config: SqliteVecConfig,
): Effect.Effect<void, SqliteVecError> =>
  Effect.fail(
    new SqliteVecError({
      message:
        "sqlite-vec backend not yet implemented. The brute-force backend in retrieve/hybrid.ts is the default. sqlite-vec will be wired in Phase 6 hardening.",
    }),
  )

/**
 * Search the vec0 table for the k nearest neighbors of a query vector.
 * Phase 6: stub that returns empty results.
 */
export const search = (
  _db: BooksDbHandle,
  _queryVector: Float32Array,
  _k: number,
  _bookIds: string[],
): Effect.Effect<DenseSearchResult[], SqliteVecError> =>
  Effect.fail(
    new SqliteVecError({
      message: "sqlite-vec search not implemented. Falling back to brute-force.",
    }),
  )

/**
 * Insert a vector into the vec0 table.
 */
export const insert = (
  _db: BooksDbHandle,
  _chunkId: string,
  _vector: Float32Array,
): Effect.Effect<void, SqliteVecError> =>
  Effect.fail(
    new SqliteVecError({
      message: "sqlite-vec insert not implemented.",
    }),
  )

/**
 * Delete a vector from the vec0 table.
 */
export const remove = (
  _db: BooksDbHandle,
  _chunkId: string,
): Effect.Effect<void, SqliteVecError> =>
  Effect.fail(
    new SqliteVecError({
      message: "sqlite-vec delete not implemented.",
    }),
  )
