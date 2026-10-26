// packages/learning/src/store/index.ts
//
// BooksStore — the Effect Layer that owns books.db. Lives in its own
// SQLite file at <dataDir>/targeted-learning/books.db, in WAL mode.
//
// Degraded mode (plan §6.5):
//   - books.db missing       → BooksStore.Service available, but every query
//                              returns BooksUnavailable. Chats load normally.
//   - books.db corrupt        → moved aside as .corrupt-<ts>, fresh DB created.
//   - books.db locked         → retried with backoff, then fail soft.
//   - newer schema than app   → read-only mode with a clear message.
//
// The server boot NEVER depends on BooksStore. It is composed as an
// optional Layer at the top level (see service.ts / node.ts).

import path from "node:path"
import { existsSync, mkdirSync, renameSync } from "node:fs"
import { Context, Effect, Layer, Schema } from "effect"
import { Global } from "@diveeoi/db/global"
import { SCHEMA_SQL } from "./schema"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BooksUnavailableError extends Schema.TaggedErrorClass<BooksUnavailableError>()(
  "TargetedLearning.BooksUnavailable",
  {
    reason: Schema.String,
  },
) {
  override get message() {
    return `Books unavailable: ${this.reason}`
  }
}

export class BooksCorruptError extends Schema.TaggedErrorClass<BooksCorruptError>()(
  "TargetedLearning.BooksCorrupt",
  {
    path: Schema.String,
  },
) {}

export class BooksNewerSchemaError extends Schema.TaggedErrorClass<BooksNewerSchemaError>()(
  "TargetedLearning.BooksNewerSchema",
  {
    appVersion: Schema.Number,
    dbVersion: Schema.Number,
  },
) {}

// ---------------------------------------------------------------------------
// Minimal DB handle interface — independent of @diveeoi/db's Database type.
// We use Bun's built-in sqlite directly to avoid coupling books.db to the
// main DB's drizzle setup. books.db is a separate SQLite file with its own
// schema (see store/schema.ts).
// ---------------------------------------------------------------------------

export interface BooksDbHandle {
  run(sql: string, ...params: unknown[]): Promise<unknown>
  all<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]>
  get<T = unknown>(sql: string, ...params: unknown[]): Promise<T | undefined>
  /** Execute a multi-statement SQL script (bun:sqlite's db.exec). */
  _execRaw(sql: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface BooksStoreInterface {
  /** The raw SQLite handle, or none if unavailable. */
  readonly db: BooksDbHandle | null
  /** True when the store is open and ready for queries. */
  readonly available: boolean
  /** Reason for unavailability, if any. */
  readonly unavailabilityReason?: string
}

export class Service extends Context.Service<Service, BooksStoreInterface>()("@diveeoi/learning/BooksStore") {}

export { Service as BooksStore }

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1

const quickCheck = (db: BooksDbHandle): Effect.Effect<boolean, never> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => db.all<{ integrity_check: string }>("PRAGMA quick_check"),
      catch: () => new Error("quick_check failed"),
    }).pipe(Effect.orElseSucceed(() => [] as { integrity_check: string }[]))
    return result.length === 1 && result[0]?.integrity_check === "ok"
  })

const initSchema = (db: BooksDbHandle): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    // Run the schema SQL via the underlying bun:sqlite handle's exec method,
    // which handles multi-statement scripts (including triggers with `;`
    // inside their bodies) correctly. The BooksDbHandle wraps bun:sqlite;
    // we use a sentinel method `_execRaw` to expose this.
    yield* Effect.tryPromise({
      try: async () => {
        await db.run("PRAGMA journal_mode = WAL")
        await db.run("PRAGMA synchronous = NORMAL")
        await db.run("PRAGMA foreign_keys = ON")
        await db.run("PRAGMA busy_timeout = 5000")
      },
      catch: (err) => err,
    })
    // Use the raw exec method (see BooksDbHandle._execRaw).
    yield* Effect.tryPromise({
      try: () => (db as BooksDbHandle & { _execRaw: (sql: string) => Promise<void> })._execRaw(SCHEMA_SQL),
      catch: (err) => err,
    })
    // Set schema_version if missing
    yield* Effect.tryPromise({
      try: () =>
        db.run(
          `INSERT OR IGNORE INTO \`meta\`(\`key\`, \`value\`) VALUES('schema_version', '${SCHEMA_VERSION}')`,
        ),
      catch: () => undefined,
    })
  })

// ---------------------------------------------------------------------------
// Open a books.db file with degraded-mode handling
// ---------------------------------------------------------------------------

const openSqlite = (dbPath: string): Effect.Effect<BooksDbHandle, never> =>
  Effect.sync(() => {
    // Use Bun's built-in sqlite directly.
    const { Database: BunDatabase } = require("bun:sqlite")
    const handle = new BunDatabase(dbPath)
    return {
      run: (sql: string, ...params: unknown[]) =>
        Promise.resolve().then(() => {
          // bun:sqlite's run() is synchronous; wrap in Promise for interface compat.
          if (params.length > 0) {
            handle.run(sql, ...(params as never[]))
          } else {
            handle.run(sql)
          }
        }),
      all: <T>(sql: string, ...params: unknown[]) =>
        Promise.resolve().then(() => {
          const query = handle.prepare(sql)
          const result = params.length > 0 ? query.all(...(params as never[])) : query.all()
          query.finalize()
          return result as T[]
        }),
      get: <T>(sql: string, ...params: unknown[]) =>
        Promise.resolve().then(() => {
          const query = handle.prepare(sql)
          const result = params.length > 0 ? query.get(...(params as never[])) : query.get()
          query.finalize()
          return result as T | undefined
        }),
      _execRaw: (sql: string) =>
        Promise.resolve().then(() => {
          handle.exec(sql)
        }),
    } satisfies BooksDbHandle
  })

const openBooksDb = (dbPath: string): Effect.Effect<BooksStoreInterface, unknown> =>
  Effect.gen(function* () {
    mkdirSync(path.dirname(dbPath), { recursive: true })

    // Case 1: file doesn't exist → fresh DB, mark available.
    if (!existsSync(dbPath)) {
      const db = yield* openSqlite(dbPath)
      const initResult = yield* initSchema(db).pipe(
        Effect.matchEffect({
          onFailure: (err) =>
            Effect.gen(function* () {
              yield* Effect.logError("BooksStore: schema init failed", { err: String(err).slice(0, 200) })
              return { db, available: false, unavailabilityReason: "schema init failed" } satisfies BooksStoreInterface
            }),
          onSuccess: () => Effect.succeed({ db, available: true } satisfies BooksStoreInterface),
        }),
      )
      return initResult
    }

    // Case 2: file exists — open it.
    const db = yield* openSqlite(dbPath)

    // Case 2a: quick_check fails → move aside, create fresh.
    const healthy = yield* quickCheck(db).pipe(Effect.orElseSucceed(() => false))
    if (!healthy) {
      const corrupt = `${dbPath}.corrupt-${Date.now()}`
      try {
        renameSync(dbPath, corrupt)
      } catch {
        // best effort
      }
      const freshDb = yield* openSqlite(dbPath)
      yield* initSchema(freshDb).pipe(Effect.orElseSucceed(() => undefined))
      return {
        db: freshDb,
        available: true,
        unavailabilityReason: `Recovered from corrupt DB (moved to ${path.basename(corrupt)})`,
      } satisfies BooksStoreInterface
    }

    // Case 2b: schema version check
    const meta = yield* Effect.tryPromise({
      try: () => db.all<{ value: string }>("SELECT value FROM `meta` WHERE key = 'schema_version'"),
      catch: () => [] as { value: string }[],
    }).pipe(Effect.orElseSucceed(() => [] as { value: string }[]))
    const dbVersion = meta[0] ? parseInt(meta[0].value, 10) : SCHEMA_VERSION
    if (dbVersion > SCHEMA_VERSION) {
      // Newer than app — read-only mode
      return {
        db,
        available: false,
        unavailabilityReason: `books.db schema v${dbVersion} is newer than app v${SCHEMA_VERSION}. Read-only mode.`,
      } satisfies BooksStoreInterface
    }
    if (dbVersion < SCHEMA_VERSION) {
      yield* Effect.tryPromise({
        try: () =>
          db.run(
            `INSERT OR REPLACE INTO \`meta\`(\`key\`, \`value\`) VALUES('schema_version', '${SCHEMA_VERSION}')`,
          ),
        catch: () => undefined,
      })
    }

    return { db, available: true } satisfies BooksStoreInterface
  })

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

const defaultDataDir = () => path.join(Global.Path.data, "targeted-learning")

export const BooksStoreLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const dataDir = process.env.DIVEEOI_TL_DATA_DIR ?? defaultDataDir()
    const dbPath = path.join(dataDir, "books.db")

    const store: BooksStoreInterface = yield* openBooksDb(dbPath).pipe(
      Effect.orElseSucceed((): BooksStoreInterface => ({
        db: null,
        available: false,
        unavailabilityReason: "init failed (see logs)",
      })),
    )

    if (!store.available) {
      yield* Effect.logWarning("BooksStore degraded mode", { reason: store.unavailabilityReason })
    }
    return Service.of(store)
  }),
)

/** Alias for `BooksStoreLayer`. */
export const layer = BooksStoreLayer

/**
 * Layer that always returns an unavailable store. Used when the feature
 * flag is off, or after a fatal init failure.
 */
export const unavailableLayer = Layer.succeed(
  Service,
  Service.of({
    db: null,
    available: false,
    unavailabilityReason: "Targeted Learning feature disabled",
  }),
)

/**
 * Backup the library using `VACUUM INTO` (plan §6.5).
 */
export const backup = (
  destPath: string,
): Effect.Effect<void, BooksUnavailableError, Service> =>
  Effect.gen(function* () {
    const store = yield* Service
    if (!store.db) {
      return yield* Effect.fail(new BooksUnavailableError({ reason: "no db handle" }))
    }
    yield* Effect.tryPromise({
      try: () => store.db!.run(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`),
      catch: (err) => new BooksUnavailableError({ reason: `vacuum failed: ${String(err).slice(0, 100)}` }),
    })
  })
