import { Effect, Layer, Context, Option, Schema, Deferred } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "@diveeoi/db/database/database"
import type { MemoryNode, MemoryLink, MemoryNodeID, LinkType, MemoryType, ProjectInfo, ProjectID } from "./schema"
import { MemoryError } from "./schema"
import { MemoryConfig } from "./config"
import { NODE_ID_REGEX } from "./node"

// SQLite schema for memory index
export const MemoryIndexSchema = {
  /** Bumped on additive schema changes; checked against PRAGMA user_version in init. */
  version: 1,
  nodes: `
    CREATE TABLE IF NOT EXISTS memory_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      session_id TEXT,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      confidence REAL DEFAULT 1.0,
      tags TEXT,
      path TEXT NOT NULL
    );
  `,
  // Columns added after the original CREATE, for multi-project support. Paired with the column
  // name so init can check the table instead of pattern-matching a driver error message.
  nodesAlterColumns: [
    { column: "project_id", sql: `ALTER TABLE memory_nodes ADD COLUMN project_id TEXT;` },
    { column: "project_root", sql: `ALTER TABLE memory_nodes ADD COLUMN project_root TEXT;` },
    { column: "file_exists", sql: `ALTER TABLE memory_nodes ADD COLUMN file_exists INTEGER DEFAULT 1;` },
  ],
  links: `
    CREATE TABLE IF NOT EXISTS memory_links (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT DEFAULT 'references',
      created INTEGER NOT NULL,
      PRIMARY KEY (source_id, target_id)
    );
  `,
  indexes: [
    `CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_id);`,
    `CREATE INDEX IF NOT EXISTS idx_memory_nodes_session ON memory_nodes(session_id);`,
    `CREATE INDEX IF NOT EXISTS idx_memory_nodes_type ON memory_nodes(type);`,
    `CREATE INDEX IF NOT EXISTS idx_memory_nodes_updated ON memory_nodes(updated DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_memory_nodes_confidence ON memory_nodes(confidence DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_memory_nodes_content ON memory_nodes(content);`,
    `CREATE INDEX IF NOT EXISTS idx_memory_nodes_project ON memory_nodes(project_id);`,
    `CREATE INDEX IF NOT EXISTS idx_memory_nodes_orphaned ON memory_nodes(file_exists);`,
  ],
  sessionMemories: `
    CREATE TABLE IF NOT EXISTS session_memories (
      session_id TEXT PRIMARY KEY,
      root_node_id TEXT NOT NULL,
      FOREIGN KEY (root_node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
    );
  `,
  // Project registry for multi-project memory loading
  projects: `
    CREATE TABLE IF NOT EXISTS memory_projects (
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL UNIQUE,
      name TEXT,
      memory_dir TEXT,
      last_scanned INTEGER,
      is_active INTEGER DEFAULT 1,
      node_count INTEGER DEFAULT 0
    );
  `,
  // Idempotency log for session extraction: one row per (session, message-set
  // hash) so a scheduler run and a manual extract cannot double-extract the
  // same conversation content (MEMORY_REVIEW 2026-11-23).
  extractions: `
    CREATE TABLE IF NOT EXISTS memory_extractions (
      session_id TEXT NOT NULL,
      messages_hash TEXT NOT NULL,
      extracted_at INTEGER NOT NULL,
      node_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, messages_hash)
    );
  `,
  projectsIndexes: [
    `CREATE INDEX IF NOT EXISTS idx_memory_projects_active ON memory_projects(is_active);`,
    `CREATE INDEX IF NOT EXISTS idx_memory_projects_root ON memory_projects(root_path);`,
  ],
  extractionsIndexes: [`CREATE INDEX IF NOT EXISTS idx_memory_extractions_session ON memory_extractions(session_id);`],
}

export interface IndexerService {
  /** The Deferred resolves when indexer init completes — callers can await this */
  readonly ready: Deferred.Deferred<void, MemoryError>
  /** Check if indexer is initialized (non-blocking) */
  readonly isReady: () => Effect.Effect<boolean>
  /** Block until indexer is ready (returns immediately if already ready) */
  readonly waitForReady: () => Effect.Effect<void, MemoryError>
  readonly initialize: () => Effect.Effect<void, MemoryError>
  readonly upsertNode: (node: MemoryNode) => Effect.Effect<void, MemoryError>
  readonly deleteNode: (nodeId: MemoryNodeID) => Effect.Effect<void, MemoryError>
  readonly getNode: (nodeId: MemoryNodeID) => Effect.Effect<Option.Option<MemoryNode>, MemoryError>
  readonly getNodes: (ids: MemoryNodeID[]) => Effect.Effect<MemoryNode[], MemoryError>
  readonly upsertLink: (sourceId: MemoryNodeID, targetId: MemoryNodeID, type: LinkType) => Effect.Effect<void, MemoryError>
  readonly deleteLink: (sourceId: MemoryNodeID, targetId: MemoryNodeID) => Effect.Effect<void, MemoryError>
  readonly getLinks: (nodeId: MemoryNodeID) => Effect.Effect<MemoryLink[], MemoryError>
  readonly getBacklinks: (nodeId: MemoryNodeID) => Effect.Effect<MemoryLink[], MemoryError>
  readonly getNodesBySession: (sessionId: string) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getNodesByType: (type: MemoryType) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getNodesByProject: (projectId: ProjectID) => Effect.Effect<MemoryNode[], MemoryError>
  readonly searchNodes: (query: string, limit?: number, projectRoot?: string) => Effect.Effect<MemoryNode[], MemoryError>
  readonly bindSession: (sessionId: string, rootNodeId: MemoryNodeID) => Effect.Effect<void, MemoryError>
  readonly getSessionRoot: (sessionId: string) => Effect.Effect<Option.Option<MemoryNodeID>, MemoryError>
  readonly getSessionNodes: (sessionId: string) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getRecentNodes: (limit: number, since?: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getLinkedNodes: (nodeId: MemoryNodeID, depth: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly countNodes: () => Effect.Effect<number, MemoryError>
  readonly countLinks: () => Effect.Effect<number, MemoryError>
  readonly countSessions: () => Effect.Effect<number, MemoryError>
  readonly rebuildIndex: () => Effect.Effect<void, MemoryError>
  /**
   * Run `effect` inside a single SQLite transaction on the indexer's connection
   * (`BEGIN ... COMMIT`, or a SAVEPOINT when already inside a transaction).
   *
   * Every indexer data method called within `effect` joins the same transaction:
   * their statements route to the transaction connection via the SQL client's
   * transaction service, and their own per-method `db.transaction` wrappers
   * become savepoints. If `effect` fails (or is interrupted), the whole
   * transaction is rolled back — either everything commits or nothing does.
   *
   * This is the only way multi-step index mutations (e.g. the consolidation
   * merge) can be made atomic; the per-method transactions alone cannot span
   * several calls.
   */
  readonly runInTransaction: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E | MemoryError>
  // Multi-project methods
  readonly registerProject: (rootPath: string, memoryDir: string, name?: string) => Effect.Effect<ProjectInfo, MemoryError>
  readonly listProjects: () => Effect.Effect<ProjectInfo[], MemoryError>
  readonly getOrphanedNodes: () => Effect.Effect<MemoryNode[], MemoryError>
  readonly verifyFileExists: (nodeId: MemoryNodeID) => Effect.Effect<boolean, MemoryError>
  readonly markOrphaned: (nodeId: MemoryNodeID) => Effect.Effect<void, MemoryError>
  /**
   * Remove markdown files that no longer have an index row (Phase C orphan cleanup).
   *
   * Scans the configured memory dir plus every registered project's `memory_dir`
   * for `nodes/*.md` files whose basename is a valid node id with NO row in
   * `memory_nodes` — exactly the state a post-commit filesystem failure leaves
   * behind (e.g. a consolidation merge whose duplicate-file deletes failed).
   * Files that do not match the node-id pattern and files modified within the
   * last 60 seconds (possibly a concurrently-created node whose row write is
   * still in flight) are left untouched. Returns the number of files removed.
   */
  readonly cleanupOrphanFiles: () => Effect.Effect<number, MemoryError>
  /**
   * Extraction idempotency log (MEMORY_REVIEW 2026-11-23): read the marker for a
   * (session, message-set hash) pair. Some means this exact extraction already
   * ran — a scheduler run and a manual extract share the same key.
   */
  readonly getExtractionRecord: (sessionId: string, messagesHash: string) => Effect.Effect<boolean, MemoryError>
  /** Record a completed extraction for the (session, message-set hash) pair. */
  readonly recordExtraction: (sessionId: string, messagesHash: string, nodeCount: number) => Effect.Effect<void, MemoryError>
}

export const IndexerService = Context.Service<IndexerService, IndexerService>()("@diveeoi/memory/IndexerService")

const makeIndexer: Effect.Effect<IndexerService, never, Database.Service | MemoryConfig> = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const config = yield* MemoryConfig

  // Create Deferred for ready notification
  const ready = yield* Deferred.make<void, MemoryError>()

  const initialize = (): Effect.Effect<void, MemoryError> =>
    Effect.gen(function* () {
      // Order matters: tables -> additive columns -> indexes.
      // idx_memory_nodes_project / idx_memory_nodes_orphaned reference columns that only
      // exist after the ALTERs below, so creating indexes first aborts init on any database
      // created before those columns were added (which then never receives them at all).
      yield* mapDbError(db.run(MemoryIndexSchema.nodes))
      yield* mapDbError(db.run(MemoryIndexSchema.links))
      yield* mapDbError(db.run(MemoryIndexSchema.sessionMemories))
      yield* mapDbError(db.run(MemoryIndexSchema.projects))
      yield* mapDbError(db.run(MemoryIndexSchema.extractions))

      // Schema version gate: a database written by a NEWER build must not be
      // silently upgraded or downgraded — fail init with the version pair so the
      // operator sees the mismatch instead of undefined behavior.
      const userVersion = yield* db
        .all<{ user_version: number }>(sql.raw("PRAGMA user_version"))
        .pipe(mapDbError)
      const dbSchemaVersion = userVersion[0]?.user_version ?? 0
      if (dbSchemaVersion > MemoryIndexSchema.version) {
        yield* Effect.fail(
          new MemoryError({
            cause: `memory index schema v${dbSchemaVersion} is newer than this build (v${MemoryIndexSchema.version}); upgrade the app or restore a matching backup`,
          }),
        )
      }

      // Additive columns are idempotent, and idempotence is decided by looking at the table
      // rather than by catching "duplicate column name": SQLite errors do not survive
      // stringification (String(sqlError) is "[object Object]"), so a text match on the error
      // silently never fires and the second init of a process fails outright. Asking the table
      // what it already has is deterministic and independent of how the driver reports errors.
      const existing = yield* db
        .all<{ name: string }>(sql.raw("PRAGMA table_info(memory_nodes)"))
        .pipe(mapDbError)
      const columns = new Set(existing.map((row) => row.name))
      for (const { column, sql } of MemoryIndexSchema.nodesAlterColumns) {
        if (columns.has(column)) continue
        yield* mapDbError(db.run(sql))
      }

      for (const idx of [...MemoryIndexSchema.indexes, ...MemoryIndexSchema.projectsIndexes, ...MemoryIndexSchema.extractionsIndexes]) {
        // A single unusable index must not take the rest of init (or the readiness signal) down.
        yield* db.run(idx).pipe(
          Effect.catch((error) => Effect.logWarning("memory indexer: index not created", { index: idx, error })),
        )
      }

      // Enable foreign keys
      yield* mapDbError(db.run(`PRAGMA foreign_keys = ON`))
      // Stamp the schema version AFTER every DDL succeeded. Legacy databases
      // carry user_version = 0; this init is additive/idempotent, so 0 is
      // upgraded to the current version transparently.
      yield* mapDbError(db.run(sql.raw(`PRAGMA user_version = ${MemoryIndexSchema.version}`)))
      // Signal that init is complete
      yield* Deferred.succeed(ready, undefined)
    }).pipe(
      // Never leave waiters hanging: a failed init must fail the readiness gate too.
      Effect.onError((cause) => Deferred.failCause(ready, cause).pipe(Effect.ignore)),
    )

  const isReady = (): Effect.Effect<boolean> =>
    Deferred.isDone(ready)

  const waitForReady = (): Effect.Effect<void, MemoryError> =>
    Deferred.await(ready)

  const rowToNode = (row: any): MemoryNode => ({
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content ?? "",
    tags: row.tags ? JSON.parse(row.tags) : [],
    sessionId: row.session_id,
    created: row.created,
    updated: row.updated,
    confidence: row.confidence,
    path: row.path,
    projectId: row.project_id ?? undefined,
    projectRoot: row.project_root ?? undefined,
    fileExists: row.file_exists === undefined ? true : Boolean(row.file_exists),
  })

  const rowToLink = (row: any): MemoryLink => ({
    sourceId: row.source_id,
    targetId: row.target_id,
    type: row.link_type,
    created: row.created
  })

  // Transaction helper
  const mapDbError = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, MemoryError> =>
    effect.pipe(Effect.mapError((err) => new MemoryError({ cause: err })))

  /**
   * Guard for every data method: the schema is created by a background init fiber, so a
   * request that arrives before it finishes would otherwise query a half-built schema
   * ("no such table" / "no such column").
   */
  const afterReady = <A>(effect: Effect.Effect<A, MemoryError>): Effect.Effect<A, MemoryError> =>
    waitForReady().pipe(Effect.andThen(effect))

  const withTransaction = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, MemoryError> =>
    mapDbError(db.transaction(() => effect))

  const upsertNode = (node: MemoryNode): Effect.Effect<void, MemoryError> =>
    withTransaction(
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT OR REPLACE INTO memory_nodes (id, type, title, content, session_id, created, updated, confidence, tags, path, project_id, project_root, file_exists)
          VALUES (${node.id}, ${node.type}, ${node.title}, ${node.content}, ${node.sessionId}, ${node.created}, ${node.updated}, ${node.confidence}, ${JSON.stringify(node.tags)}, ${node.path}, ${node.projectId ?? null}, ${node.projectRoot ?? null}, ${node.fileExists ?? true})
        `)
      })
    )

  const deleteNode = (nodeId: MemoryNodeID): Effect.Effect<void, MemoryError> =>
    withTransaction(
      Effect.gen(function* () {
        yield* db.run(sql`DELETE FROM memory_nodes WHERE id = ${nodeId}`)
        yield* db.run(sql`DELETE FROM memory_links WHERE source_id = ${nodeId} OR target_id = ${nodeId}`)
      })
    )

  const getNode = (nodeId: MemoryNodeID): Effect.Effect<Option.Option<MemoryNode>, MemoryError> =>
    Effect.gen(function* () {
      const row = yield* mapDbError(db.get(sql`SELECT * FROM memory_nodes WHERE id = ${nodeId}`))
      return row ? Option.some(rowToNode(row)) : Option.none()
    })

  const getNodes = (ids: MemoryNodeID[]): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      if (ids.length === 0) return []
      const placeholders = sql.join(ids.map((id) => sql`${id}`), sql.raw(","))
      const rows = yield* mapDbError(db.all(sql`
        SELECT * FROM memory_nodes WHERE id IN (${placeholders})
      `))
      return rows.map(rowToNode)
    })

  const upsertLink = (sourceId: MemoryNodeID, targetId: MemoryNodeID, type: LinkType = "references"): Effect.Effect<void, MemoryError> =>
    withTransaction(
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT OR REPLACE INTO memory_links (source_id, target_id, link_type, created)
          VALUES (${sourceId}, ${targetId}, ${type}, ${Date.now()})
        `)
      })
    )

  const deleteLink = (sourceId: MemoryNodeID, targetId: MemoryNodeID): Effect.Effect<void, MemoryError> =>
    withTransaction(
      Effect.gen(function* () {
        yield* db.run(sql`DELETE FROM memory_links WHERE source_id = ${sourceId} AND target_id = ${targetId}`)
      })
    )

  const getLinks = (nodeId: MemoryNodeID): Effect.Effect<MemoryLink[], MemoryError> =>
    Effect.gen(function* () {
      const rows = yield* mapDbError(db.all(sql`SELECT * FROM memory_links WHERE source_id = ${nodeId}`))
      return rows.map(rowToLink)
    })

  const getBacklinks = (nodeId: MemoryNodeID): Effect.Effect<MemoryLink[], MemoryError> =>
    Effect.gen(function* () {
      const rows = yield* mapDbError(db.all(sql`SELECT * FROM memory_links WHERE target_id = ${nodeId}`))
      return rows.map(rowToLink)
    })

  const getNodesBySession = (sessionId: string): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      const rows = yield* mapDbError(db.all(sql`SELECT * FROM memory_nodes WHERE session_id = ${sessionId} ORDER BY updated DESC`))
      return rows.map(rowToNode)
    })

  const getNodesByType = (type: MemoryType): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      const rows = yield* mapDbError(db.all(sql`SELECT * FROM memory_nodes WHERE type = ${type} ORDER BY updated DESC`))
      return rows.map(rowToNode)
    })

  const searchNodes = (query: string, limit = 20, projectRoot?: string): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      const searchTerm = `%${query.toLowerCase()}%`
      const scopedRoot = projectRoot?.replace(/[\\/]+$/u, "")
      const projectScope = scopedRoot
        ? sql`AND (
            rtrim(project_root, '/' || char(92)) = ${scopedRoot}
            OR (
              project_root IS NULL
              AND substr(path, 1, length(${scopedRoot})) = ${scopedRoot}
              AND substr(path, length(${scopedRoot}) + 1, 1) IN ('/', char(92))
            )
          )`
        : sql``
      const rows = yield* mapDbError(db.all(sql`
        SELECT * FROM memory_nodes
        WHERE (
          LOWER(title) LIKE ${searchTerm}
          OR LOWER(content) LIKE ${searchTerm}
          OR LOWER(tags) LIKE ${searchTerm}
        )
        ${projectScope}
        ORDER BY
          CASE
            WHEN LOWER(title) = ${query.toLowerCase()} THEN 0
            WHEN LOWER(title) LIKE ${searchTerm} THEN 1
            WHEN LOWER(tags) LIKE ${searchTerm} THEN 2
            ELSE 3
          END,
          confidence DESC,
          updated DESC
        LIMIT ${limit}
      `))
      return rows.map(rowToNode)
    })

  const bindSession = (sessionId: string, rootNodeId: MemoryNodeID): Effect.Effect<void, MemoryError> =>
    withTransaction(
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT INTO session_memories (session_id, root_node_id) VALUES (${sessionId}, ${rootNodeId})
          ON CONFLICT(session_id) DO UPDATE SET root_node_id = excluded.root_node_id
        `)
      })
    )

  const getSessionRoot = (sessionId: string): Effect.Effect<Option.Option<MemoryNodeID>, MemoryError> =>
    Effect.gen(function* () {
      const row = yield* mapDbError(db.get<{ root_node_id: MemoryNodeID }>(sql`SELECT root_node_id FROM session_memories WHERE session_id = ${sessionId}`))
      return row?.root_node_id ? Option.some(row.root_node_id) : Option.none()
    })

  // Optimized: Use recursive CTE to fetch session graph in single query
  const getSessionNodes = (sessionId: string): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      const rootId = yield* getSessionRoot(sessionId)
      if (Option.isNone(rootId)) return []

      // Use recursive CTE to traverse graph in single query
      const rows = yield* mapDbError(db.all(sql`
        WITH RECURSIVE graph(id, depth) AS (
          SELECT ${rootId.value}, 0
          UNION ALL
          SELECT ml.target_id, g.depth + 1
          FROM memory_links ml
          JOIN graph g ON ml.source_id = g.id
          WHERE g.depth < 2
          UNION ALL
          SELECT ml.source_id, g.depth + 1
          FROM memory_links ml
          JOIN graph g ON ml.target_id = g.id
          WHERE g.depth < 2
        )
        SELECT DISTINCT mn.*
        FROM memory_nodes mn
        JOIN graph g ON mn.id = g.id
        ORDER BY g.depth, mn.updated DESC
        LIMIT 20
      `))

      return rows.map(rowToNode)
    })

  const getRecentNodes = (limit: number, since?: number): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      const rows = yield* mapDbError(db.all(sql`
        SELECT * FROM memory_nodes
        ${since !== undefined ? sql`WHERE updated > ${since}` : sql``}
        ORDER BY updated DESC LIMIT ${limit}
      `))
      return rows.map(rowToNode)
    })

const getLinkedNodes = (nodeId: MemoryNodeID, depth: number): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      if (depth <= 0) return []

      const rows = yield* mapDbError(db.all(sql`
        WITH RECURSIVE graph(id, d) AS (
          SELECT ${nodeId}, 0
          UNION ALL
          SELECT ml.target_id, g.d + 1
          FROM memory_links ml
          JOIN graph g ON ml.source_id = g.id
          WHERE g.d < ${depth}
          UNION ALL
          SELECT ml.source_id, g.d + 1
          FROM memory_links ml
          JOIN graph g ON ml.target_id = g.id
          WHERE g.d < ${depth}
        )
        SELECT DISTINCT mn.*
        FROM memory_nodes mn
        JOIN graph g ON mn.id = g.id
      `))

      return rows.map(rowToNode)
    })

  const countNodes = (): Effect.Effect<number, MemoryError> =>
    Effect.gen(function* () {
      const row = yield* mapDbError(db.get<{ count: number }>(sql`SELECT COUNT(*) as count FROM memory_nodes`))
      return row?.count ?? 0
    })

  const countLinks = (): Effect.Effect<number, MemoryError> =>
    Effect.gen(function* () {
      const row = yield* mapDbError(db.get<{ count: number }>(sql`SELECT COUNT(*) as count FROM memory_links`))
      return row?.count ?? 0
    })

  const countSessions = (): Effect.Effect<number, MemoryError> =>
    Effect.gen(function* () {
      const row = yield* mapDbError(db.get<{ count: number }>(sql`SELECT COUNT(*) as count FROM session_memories`))
      return row?.count ?? 0
    })

  const rebuildIndex = (): Effect.Effect<void, MemoryError> =>
    withTransaction(
      Effect.gen(function* () {
        yield* mapDbError(db.run(`DELETE FROM memory_nodes`))
        yield* mapDbError(db.run(`DELETE FROM memory_links`))
      })
    )

  // Multi-project methods

  // Hash a path to create a stable project ID
  const hashProjectPath = (path: string): string => {
    // Simple hash - sufficient for project identification
    let hash = 0
    for (let i = 0; i < path.length; i++) {
      const char = path.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return `proj_${Math.abs(hash).toString(16)}`
  }

  const rowToProject = (row: any): ProjectInfo => ({
    id: row.id,
    rootPath: row.root_path,
    name: row.name ?? row.root_path.split("/").pop() ?? row.root_path,
    memoryDir: row.memory_dir ?? "",
    lastScanned: row.last_scanned ?? 0,
    isActive: Boolean(row.is_active),
    nodeCount: row.node_count ?? 0,
  })

  const registerProject = (rootPath: string, memoryDir: string, name?: string): Effect.Effect<ProjectInfo, MemoryError> =>
    withTransaction(
      Effect.gen(function* () {
        const id = hashProjectPath(rootPath)
        const now = Date.now()
        const projectName = name ?? rootPath.split("/").pop() ?? rootPath.split("\\").pop() ?? rootPath
        yield* db.run(sql`
          INSERT INTO memory_projects (id, root_path, name, memory_dir, last_scanned, is_active, node_count)
          VALUES (${id}, ${rootPath}, ${projectName}, ${memoryDir}, ${now}, 1, 0)
          ON CONFLICT(id) DO UPDATE SET
            memory_dir = excluded.memory_dir,
            last_scanned = excluded.last_scanned,
            is_active = 1
        `)
        const row = yield* mapDbError(db.get<any>(sql`SELECT * FROM memory_projects WHERE id = ${id}`))
        if (!row) {
          return yield* Effect.fail(new MemoryError({ cause: new Error("Failed to register project") }))
        }
        return rowToProject(row)
      })
    )

  const listProjects = (): Effect.Effect<ProjectInfo[], MemoryError> =>
    Effect.gen(function* () {
      const rows = yield* mapDbError(db.all(sql`SELECT * FROM memory_projects WHERE is_active = 1 ORDER BY last_scanned DESC`))
      return rows.map(rowToProject)
    })

  const getNodesByProject = (projectId: ProjectID): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      const rows = yield* mapDbError(db.all(sql`SELECT * FROM memory_nodes WHERE project_id = ${projectId} ORDER BY updated DESC`))
      return rows.map(rowToNode)
    })

  // Orphan detection: check if file still exists, mark if not
  const verifyFileExists = (nodeId: MemoryNodeID): Effect.Effect<boolean, MemoryError> =>
    Effect.gen(function* () {
      const row = yield* mapDbError(db.get<{ path: string }>(sql`SELECT path FROM memory_nodes WHERE id = ${nodeId}`))
      if (!row) return false
      const fs = yield* Effect.promise(() => import("fs/promises"))
      // Check file existence - treat any error as "not exists"
      const exists = yield* Effect.tryPromise({
        try: async () => {
          try {
            await fs.access(row.path)
            return true
          } catch {
            return false // ENOENT or any error = file doesn't exist
          }
        },
        catch: (cause) => new MemoryError({ cause }) // Unexpected error
      })
      if (exists) {
        yield* mapDbError(db.run(sql`UPDATE memory_nodes SET file_exists = 1 WHERE id = ${nodeId}`))
        return true
      } else {
        yield* mapDbError(db.run(sql`UPDATE memory_nodes SET file_exists = 0 WHERE id = ${nodeId}`))
        return false
      }
    })

  const markOrphaned = (nodeId: MemoryNodeID): Effect.Effect<void, MemoryError> =>
    mapDbError(db.run(sql`UPDATE memory_nodes SET file_exists = 0 WHERE id = ${nodeId}`))

  // Post-commit filesystem reconciliation (Phase C cleanup hook). A committed
  // transaction whose file writes failed leaves .md files with no index row;
  // this sweep removes exactly those (never touching unknown files or files
  // young enough to belong to a node whose row write is still in flight).
  const ORPHAN_FILE_MIN_AGE_MS = 60_000
  const cleanupOrphanFiles = (): Effect.Effect<number, MemoryError> =>
    Effect.gen(function* () {
      const fs = yield* Effect.promise(() => import("node:fs/promises"))
      const path = yield* Effect.promise(() => import("node:path"))
      const projectRows = yield* mapDbError(
        db.all<{ memory_dir: string | null }>(sql`SELECT memory_dir FROM memory_projects WHERE is_active = 1`),
      )
      const dirs = new Set<string>([config.memoryDir])
      for (const row of projectRows) if (row.memory_dir) dirs.add(row.memory_dir)

      let removed = 0
      for (const dir of dirs) {
        const nodesDir = path.join(dir, "nodes")
        const files: string[] = yield* Effect.tryPromise({
          try: () => fs.readdir(nodesDir),
          catch: (cause) => new MemoryError({ cause }),
        }).pipe(Effect.orElseSucceed(() => [] as string[]))
        for (const file of files) {
          if (!file.endsWith(".md")) continue
          const id = file.slice(0, -3)
          // Unknown files are never data of ours — leave them alone.
          if (!NODE_ID_REGEX.test(id)) continue
          const row = yield* mapDbError(db.get<{ id: string }>(sql`SELECT id FROM memory_nodes WHERE id = ${id}`))
          if (row) continue
          // Fresh file: could be a concurrent create whose row write has not
          // landed yet — skip instead of racing the writer.
          const stat = yield* Effect.tryPromise({
            try: () => fs.stat(path.join(nodesDir, file)),
            catch: (cause) => new MemoryError({ cause }),
          }).pipe(Effect.orElseSucceed(() => null))
          if (stat && Date.now() - stat.mtimeMs < ORPHAN_FILE_MIN_AGE_MS) continue
          const deleted = yield* Effect.tryPromise({
            try: () => fs.unlink(path.join(nodesDir, file)).then(() => 1),
            catch: (cause) => new MemoryError({ cause }),
          }).pipe(
            Effect.tapError((error) => Effect.logWarning("memory indexer: orphan file could not be removed", { file: path.join(nodesDir, file), error })),
            Effect.orElseSucceed(() => 0),
          )
          removed += deleted
        }
      }
      if (removed > 0) {
        yield* Effect.logWarning("memory indexer: removed orphan markdown files with no index row", { removed })
      }
      return removed
    })

  const getOrphanedNodes = (): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      const rows = yield* mapDbError(db.all(sql`SELECT * FROM memory_nodes WHERE file_exists = 0 ORDER BY updated DESC`))
      return rows.map(rowToNode)
    })

  // Extraction idempotency log (see interface doc).
  const getExtractionRecord = (sessionId: string, messagesHash: string): Effect.Effect<boolean, MemoryError> =>
    Effect.gen(function* () {
      const row = yield* mapDbError(
        db.get<{ extracted_at: number }>(
          sql`SELECT extracted_at FROM memory_extractions WHERE session_id = ${sessionId} AND messages_hash = ${messagesHash}`,
        ),
      )
      return row !== undefined
    })

  const recordExtraction = (sessionId: string, messagesHash: string, nodeCount: number): Effect.Effect<void, MemoryError> =>
    mapDbError(
      db.run(
        sql`INSERT INTO memory_extractions (session_id, messages_hash, extracted_at, node_count) VALUES (${sessionId}, ${messagesHash}, ${Date.now()}, ${nodeCount}) ON CONFLICT(session_id, messages_hash) DO NOTHING`,
      ),
    )

  return {
    ready,
    isReady,
    waitForReady,
    initialize,
    // Every data method waits for schema init; see `afterReady`.
    upsertNode: (node) => afterReady(upsertNode(node)),
    deleteNode: (nodeId) => afterReady(deleteNode(nodeId)),
    getNode: (nodeId) => afterReady(getNode(nodeId)),
    getNodes: (ids) => afterReady(getNodes(ids)),
    upsertLink: (sourceId, targetId, type) => afterReady(upsertLink(sourceId, targetId, type)),
    deleteLink: (sourceId, targetId) => afterReady(deleteLink(sourceId, targetId)),
    getLinks: (nodeId) => afterReady(getLinks(nodeId)),
    getBacklinks: (nodeId) => afterReady(getBacklinks(nodeId)),
    getNodesBySession: (sessionId) => afterReady(getNodesBySession(sessionId)),
    getNodesByType: (type) => afterReady(getNodesByType(type)),
    getNodesByProject: (projectId) => afterReady(getNodesByProject(projectId)),
    searchNodes: (query, limit, projectRoot) => afterReady(searchNodes(query, limit, projectRoot)),
    bindSession: (sessionId, rootNodeId) => afterReady(bindSession(sessionId, rootNodeId)),
    getSessionRoot: (sessionId) => afterReady(getSessionRoot(sessionId)),
    getSessionNodes: (sessionId) => afterReady(getSessionNodes(sessionId)),
    getRecentNodes: (limit, since) => afterReady(getRecentNodes(limit, since)),
    getLinkedNodes: (nodeId, depth) => afterReady(getLinkedNodes(nodeId, depth)),
    countNodes: () => afterReady(countNodes()),
    countLinks: () => afterReady(countLinks()),
    countSessions: () => afterReady(countSessions()),
    rebuildIndex: () => afterReady(rebuildIndex()),
    // Generic transaction runner: see interface doc. Reads/writes issued through
    // this service inside `effect` execute on the transaction connection.
    runInTransaction: (effect) => afterReady(withTransaction(effect)),
    // Multi-project
    registerProject: (rootPath, memoryDir, name) => afterReady(registerProject(rootPath, memoryDir, name)),
    listProjects: () => afterReady(listProjects()),
    getOrphanedNodes: () => afterReady(getOrphanedNodes()),
    verifyFileExists: (nodeId) => afterReady(verifyFileExists(nodeId)),
    markOrphaned: (nodeId) => afterReady(markOrphaned(nodeId)),
    cleanupOrphanFiles: () => afterReady(cleanupOrphanFiles()),
    getExtractionRecord: (sessionId, hash) => afterReady(getExtractionRecord(sessionId, hash)),
    recordExtraction: (sessionId, hash, count) => afterReady(recordExtraction(sessionId, hash, count)),
  }
})

export const IndexerLive = Layer.effect(
  IndexerService,
  makeIndexer
)

export * as Indexer from "./indexer"
