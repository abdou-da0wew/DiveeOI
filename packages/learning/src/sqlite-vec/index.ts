// packages/learning/src/sqlite-vec/index.ts
//
// sqlite-vec backend (plan §6.6, Phase 6 optional backend).
//
// sqlite-vec is a loadable SQLite extension that provides vector search via a
// vec0 virtual table. It is an ALTERNATIVE to the brute-force cosine search in
// retrieve/hybrid.ts — offered for users with large libraries (>100k chunks)
// where brute-force becomes slow.
//
// Implementation notes:
//  * The extension is loaded in one of two ways, tried in order:
//      1. the `sqlite-vec` npm package (it bundles the loadable extension and
//         knows how to load it into bun:sqlite), when the app has it installed;
//      2. a raw `db.loadExtension(path)` with `SqliteVecConfig.extensionPath`.
//    Availability is probed with `SELECT vec_version()` and cached per handle.
//  * The vec0 table stores the chunk id as a TEXT primary key plus the embedding:
//        CREATE VIRTUAL TABLE chunk_vecs_vec0 USING vec0(
//          chunk_id TEXT PRIMARY KEY,
//          embedding float[<dimensions>] distance_metric=cosine
//        )
//    `distance_metric=cosine` is supported by sqlite-vec >= 0.1.6; older builds
//    fall back to L2 (score is then 1 / (1 + distance), still monotonic with
//    distance so ranking and threshold gates keep working).
//  * KNN queries overfetch, join `chunks` to apply the session's book scope, and
//    slice to k. Book scoping in SQL (not in the vec0 query) keeps this correct
//    on every sqlite-vec version.

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

/** Name of the vec0 virtual table this module manages. */
export const VEC_TABLE = "chunk_vecs_vec0"

/** Where the table's metric is remembered, so `search` can convert distance -> score. */
const METRIC_KEY = "sqlite_vec.metric"

/** Handles that already have the extension loaded and verified, with its version. */
const availability = new WeakMap<BooksDbHandle, string>()

/** Handles whose vec0 table uses the cosine metric (true) or the L2 fallback (false). */
const cosineMetric = new WeakMap<BooksDbHandle, boolean>()

interface LoadedDb {
  loadExtension?: (path: string, entryPoint?: string) => unknown
  exec?: (sql: string) => unknown
}

/** The raw bun:sqlite Database behind the handle (the handle *is* the Database). */
const rawDb = (db: BooksDbHandle): LoadedDb => db as unknown as LoadedDb

const EXTENSION_SUFFIXES = ["-macos-arm64.dylib", "-macos-x86_64.dylib", "-linux-x86_64.so", "-windows-x86_64.dll"] as const

const vecVersion = async (db: BooksDbHandle): Promise<string | null> => {
  try {
    const row = await db.get<{ version?: string; v?: string }>("SELECT vec_version() AS version")
    const version = row?.version ?? row?.v
    return typeof version === "string" && version.length > 0 ? version : null
  } catch {
    return null
  }
}

/**
 * Load the sqlite-vec extension (npm package first, explicit path second) and verify it.
 * Resolves to the vec version, or null when sqlite-vec could not be made available.
 */
const ensureExtension = async (db: BooksDbHandle, config?: SqliteVecConfig): Promise<string | null> => {
  const cached = availability.get(db)
  if (cached) return cached
  const raw = rawDb(db)

  // 1) the npm package, when installed — it bundles the correct loadable per platform.
  // The specifier stays a variable so bundlers/typecheckers treat it as fully optional
  // (the package is NOT a hard dependency; absence degrades to the raw loadExtension path).
  try {
    const moduleSpecifier = "sqlite-vec"
    const sqliteVec = (await import(moduleSpecifier)) as {
      load?: (db: unknown) => unknown
      getLoadablePath?: () => string
    }
    if (typeof sqliteVec?.load === "function") {
      sqliteVec.load(raw)
    } else if (typeof sqliteVec?.getLoadablePath === "function" && typeof raw.loadExtension === "function") {
      raw.loadExtension(sqliteVec.getLoadablePath())
    }
  } catch {
    // npm package absent or incompatible — fall through to the explicit path.
  }

  // 2) an explicit extension path from settings.
  if (!(await vecVersion(db)) && config?.extensionPath && typeof raw.loadExtension === "function") {
    try {
      raw.loadExtension(config.extensionPath)
    } catch {
      // caller gets the null return below with a clear error on first use.
    }
  }

  const version = await vecVersion(db)
  if (version) availability.set(db, version)
  return version
}

/**
 * Check if sqlite-vec is available (extension loadable and vec0 registered).
 * Safe to call repeatedly; the result is cached per handle.
 */
export const isAvailable = (db: BooksDbHandle, config?: SqliteVecConfig): Effect.Effect<boolean, never> =>
  Effect.gen(function* () {
    const version = yield* Effect.tryPromise({
      try: () => ensureExtension(db, config),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null))
    return typeof version === "string" && version.length > 0
  })

const readMetric = async (db: BooksDbHandle): Promise<boolean> => {
  const cached = cosineMetric.get(db)
  if (cached !== undefined) return cached
  let cosine = true
  try {
    const row = await db.get<{ value?: string }>(
      "SELECT value FROM meta WHERE key = ?",
      METRIC_KEY,
    )
    if (row?.value === "l2") cosine = false
  } catch {
    // meta table missing — assume cosine (createVecTable writes it when it can).
  }
  cosineMetric.set(db, cosine)
  return cosine
}

const distanceToScore = (distance: number, cosine: boolean): number => {
  if (!Number.isFinite(distance)) return 0
  if (cosine) return 1 - distance
  return 1 / (1 + distance)
}

const createVecTableImpl = async (db: BooksDbHandle, config: SqliteVecConfig): Promise<void> => {
  const version = await ensureExtension(db, config)
  if (!version) {
    throw new Error(
      "sqlite-vec extension is not available. Install the `sqlite-vec` npm package or point " +
        "vectorBackend.sqliteVec.extensionPath at the loadable extension for this platform " +
        EXTENSION_SUFFIXES.join(" / ") +
        ".",
    )
  }
  if (!Number.isInteger(config.dimensions) || config.dimensions <= 0 || config.dimensions > 4096) {
    throw new Error(`invalid vector dimensions: ${config.dimensions}`)
  }

  const withMetric =
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(` +
    `chunk_id TEXT PRIMARY KEY, embedding float[${config.dimensions}] distance_metric=cosine)`
  const plain =
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(` +
    `chunk_id TEXT PRIMARY KEY, embedding float[${config.dimensions}])`

  try {
    await db.run(withMetric)
    cosineMetric.set(db, true)
    await db.run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      METRIC_KEY,
      "cosine",
    ).catch(() => undefined)
  } catch {
    // Older sqlite-vec without distance_metric: fall back to L2 and remember it.
    await db.run(plain)
    cosineMetric.set(db, false)
    await db.run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      METRIC_KEY,
      "l2",
    ).catch(() => undefined)
  }
}

/**
 * Create the vec0 virtual table for chunk vectors (no-op when it already exists).
 * Fails with SqliteVecError when the extension cannot be loaded.
 */
export const createVecTable = (
  db: BooksDbHandle,
  config: SqliteVecConfig,
): Effect.Effect<void, SqliteVecError> =>
  Effect.tryPromise({
    try: () => createVecTableImpl(db, config),
    catch: (error) => new SqliteVecError({ message: error instanceof Error ? error.message : String(error) }),
  })

const asFloat32 = (vector: Float32Array): Float32Array =>
  // vec0 consumes little-endian float32 BLOBs; ensure a clean copy on the native endianness
  // (x86/ARM are LE, so this is a straight copy).
  new Float32Array(Float32Array.from(vector))

const searchImpl = async (
  db: BooksDbHandle,
  queryVector: Float32Array,
  k: number,
  bookIds: string[],
): Promise<DenseSearchResult[]> => {
  if (k <= 0 || bookIds.length === 0) return []
  const cosine = await readMetric(db)
  // Overfetch so the book-scoped join still fills k neighbours.
  const fetch = Math.min(Math.max(k * 8, 64), 512)
  const marks = bookIds.map(() => "?").join(",")
  const blob = Buffer.from(asFloat32(queryVector).buffer)
  const rows = await db.all<{ chunk_id: string; distance: number }>(
    `SELECT v.chunk_id, v.distance FROM (
       SELECT chunk_id, distance FROM ${VEC_TABLE} WHERE embedding MATCH ? AND k = ?
     ) v
     JOIN chunks c ON c.id = v.chunk_id
     WHERE c.book_id IN (${marks})
     ORDER BY v.distance
     LIMIT ?`,
    blob,
    fetch,
    ...bookIds,
    k,
  )
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    score: distanceToScore(Number(row.distance), cosine),
  }))
}

/**
 * Search the vec0 table for the k nearest neighbours of a query vector, scoped to the
 * session's books. Scores are cosine similarity when the table was created with the
 * cosine metric (sqlite-vec >= 0.1.6), otherwise 1 / (1 + L2 distance).
 */
export const search = (
  db: BooksDbHandle,
  queryVector: Float32Array,
  k: number,
  bookIds: string[],
): Effect.Effect<DenseSearchResult[], SqliteVecError> =>
  Effect.tryPromise({
    try: () => searchImpl(db, queryVector, k, bookIds),
    catch: (error) => new SqliteVecError({ message: error instanceof Error ? error.message : String(error) }),
  })

const insertImpl = async (
  db: BooksDbHandle,
  chunkId: string,
  vector: Float32Array,
  config?: SqliteVecConfig,
): Promise<void> => {
  const values = asFloat32(vector)
  if (config && Number.isInteger(config.dimensions) && values.length !== config.dimensions) {
    throw new Error(`vector has ${values.length} dimensions, table expects ${config.dimensions}`)
  }
  await db.run(`DELETE FROM ${VEC_TABLE} WHERE chunk_id = ?`, chunkId)
  await db.run(`INSERT INTO ${VEC_TABLE} (chunk_id, embedding) VALUES (?, ?)`, chunkId, Buffer.from(values.buffer))
}

/**
 * Insert (or replace) a vector into the vec0 table. `config` is optional; when given the
 * dimensionality is validated before writing.
 */
export const insert = (
  db: BooksDbHandle,
  chunkId: string,
  vector: Float32Array,
  config?: SqliteVecConfig,
): Effect.Effect<void, SqliteVecError> =>
  Effect.tryPromise({
    try: () => insertImpl(db, chunkId, vector, config),
    catch: (error) => new SqliteVecError({ message: error instanceof Error ? error.message : String(error) }),
  })

const removeImpl = async (db: BooksDbHandle, chunkId: string): Promise<void> => {
  await db.run(`DELETE FROM ${VEC_TABLE} WHERE chunk_id = ?`, chunkId)
}

/** Delete a vector from the vec0 table (no-op when the chunk is absent). */
export const remove = (
  db: BooksDbHandle,
  chunkId: string,
): Effect.Effect<void, SqliteVecError> =>
  Effect.tryPromise({
    try: () => removeImpl(db, chunkId),
    catch: (error) => new SqliteVecError({ message: error instanceof Error ? error.message : String(error) }),
  })
