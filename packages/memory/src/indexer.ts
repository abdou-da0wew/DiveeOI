import { Effect, Layer, Context, Option, Schema } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "@diveeoi/db/database/database"
import type { MemoryNode, MemoryLink, MemoryNodeID, LinkType, MemoryType } from "./schema"
import { MemoryError } from "./schema"
import { MemoryConfig } from "./config"

// SQLite schema for memory index
export const MemoryIndexSchema = {
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
    `CREATE INDEX IF NOT EXISTS idx_memory_nodes_content ON memory_nodes(content);`
  ],
  sessionMemories: `
    CREATE TABLE IF NOT EXISTS session_memories (
      session_id TEXT PRIMARY KEY,
      root_node_id TEXT NOT NULL,
      FOREIGN KEY (root_node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
    );
  `
}

export interface IndexerService {
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
  readonly searchNodes: (query: string, limit?: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly bindSession: (sessionId: string, rootNodeId: MemoryNodeID) => Effect.Effect<void, MemoryError>
  readonly getSessionRoot: (sessionId: string) => Effect.Effect<Option.Option<MemoryNodeID>, MemoryError>
  readonly getSessionNodes: (sessionId: string) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getRecentNodes: (limit: number, since?: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly getLinkedNodes: (nodeId: MemoryNodeID, depth: number) => Effect.Effect<MemoryNode[], MemoryError>
  readonly countNodes: () => Effect.Effect<number, MemoryError>
  readonly countLinks: () => Effect.Effect<number, MemoryError>
  readonly countSessions: () => Effect.Effect<number, MemoryError>
  readonly rebuildIndex: () => Effect.Effect<void, MemoryError>
}

export const IndexerService = Context.Service<IndexerService, IndexerService>()("@diveeoi/memory/IndexerService")

const makeIndexer = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const config = yield* MemoryConfig

  const initialize = (): Effect.Effect<void, MemoryError> =>
    Effect.gen(function* () {
      yield* mapDbError(db.run(MemoryIndexSchema.nodes))
      yield* mapDbError(db.run(MemoryIndexSchema.links))
      for (const idx of MemoryIndexSchema.indexes) {
        yield* mapDbError(db.run(idx))
      }
      yield* mapDbError(db.run(MemoryIndexSchema.sessionMemories))
      // Enable foreign keys
      yield* mapDbError(db.run(`PRAGMA foreign_keys = ON`))
    })

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
    path: row.path
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

  const withTransaction = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, MemoryError> =>
    mapDbError(db.transaction(() => effect))

  const upsertNode = (node: MemoryNode): Effect.Effect<void, MemoryError> =>
    withTransaction(
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT OR REPLACE INTO memory_nodes (id, type, title, content, session_id, created, updated, confidence, tags, path)
          VALUES (${node.id}, ${node.type}, ${node.title}, ${node.content}, ${node.sessionId}, ${node.created}, ${node.updated}, ${node.confidence}, ${JSON.stringify(node.tags)}, ${node.path})
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

  const searchNodes = (query: string, limit = 20): Effect.Effect<MemoryNode[], MemoryError> =>
    Effect.gen(function* () {
      const searchTerm = `%${query.toLowerCase()}%`
      const rows = yield* mapDbError(db.all(sql`
        SELECT * FROM memory_nodes
        WHERE LOWER(title) LIKE ${searchTerm} OR LOWER(content) LIKE ${searchTerm}
        ORDER BY updated DESC LIMIT ${limit}
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

  return {
    initialize,
    upsertNode,
    deleteNode,
    getNode,
    getNodes,
    upsertLink,
    deleteLink,
    getLinks,
    getBacklinks,
    getNodesBySession,
    getNodesByType,
    searchNodes,
    bindSession,
    getSessionRoot,
    getSessionNodes,
    getRecentNodes,
    getLinkedNodes,
    countNodes,
    countLinks,
    countSessions,
    rebuildIndex
  }
})

export const IndexerLive = Layer.effect(
  IndexerService,
  makeIndexer
)

export * as Indexer from "./indexer"
