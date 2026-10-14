import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { Database } from "@diveeoi/db/database/database"
import { SessionV1 } from "@diveeoi/db/v1/session"
import { Context, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import type { SessionID } from "@/session/schema"

/**
 * Full-text index over session content, so text that compaction drops stays searchable.
 *
 * Kept apart from the anchor service on purpose: indexing is pure SQLite and must never depend
 * on the LLM, agent, or provider graph. That keeps it fast enough to run inline on the compaction
 * path and testable against a real database without standing up a session runner.
 */

/** Chunks shorter than this carry no recoverable meaning and would only dilute BM25 ranking. */
const MIN_INDEX_CHARS = 8

/** How many hits a search returns unless a caller asks for more. */
export const DEFAULT_LIMIT = 8

export type SearchHit = {
  readonly ref: string
  readonly snippet: string
  readonly rank: number
}

export interface Interface {
  /** Index any parts of these messages not already indexed. Returns how many were added. */
  readonly index: (input: {
    sessionID: SessionID
    messages: ReadonlyArray<SessionV1.WithParts>
  }) => Effect.Effect<number>
  readonly search: (input: {
    sessionID: SessionID
    query: string
    limit?: number
  }) => Effect.Effect<ReadonlyArray<SearchHit>>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/AnchorContentIndex") {}

/** Text of a part, or undefined when it holds nothing worth searching. */
const partText = (part: SessionV1.Part): string | undefined => {
  if ((part.type === "text" || part.type === "reasoning") && part.text.trim()) return part.text
  if (part.type === "tool") {
    // `output` only exists on the completed variant of the tool-state union, so the state has
    // to be bound to a local for the narrowing to hold.
    const state = part.state
    if (state && state.status === "completed" && state.output) return state.output
  }
  return undefined
}

/**
 * A second, identifier-split copy of the text, appended to the raw copy.
 *
 * FTS5's default tokenizer splits on non-alphanumerics but keeps `getAdaptiveTargets` as one
 * token, so an exact identifier query and a natural-language query for the same thing do not both
 * match. The split copy makes both work without an English stemmer, which would mangle code
 * identifiers.
 */
export const indexableText = (text: string): string =>
  `${text}\n${text.replace(/[a-z0-9](?=[A-Z])/g, (m) => `${m} `)}`

/** FTS5 query syntax, quoted so punctuation and operators in user input cannot break the MATCH. */
const quote = (query: string) => `"${query.replace(/"/g, '""')}"`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const index: Interface["index"] = Effect.fn("ContentIndex.index")(function* (input) {
      if (input.messages.length === 0) return 0

      // Already-indexed refs are skipped rather than replaced: search_memory is expected to run
      // repeatedly, and re-inserting would duplicate rows and skew BM25 ranking.
      const known = yield* db
        .all<{ ref: string }>(sql`SELECT ref FROM session_content_fts WHERE session_id = ${input.sessionID}`)
        .pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<{ ref: string }>)))
      const seen = new Set(known.map((row) => row.ref))

      const pending: Array<{ ref: string; text: string }> = []
      for (const message of input.messages) {
        for (const part of message.parts) {
          const text = partText(part)
          if (!text || text.length < MIN_INDEX_CHARS) continue
          const ref = String(part.id)
          if (seen.has(ref)) continue
          seen.add(ref)
          pending.push({ ref, text: indexableText(text) })
        }
      }
      if (pending.length === 0) return 0

      // One transaction for the whole range: per-row inserts over a large dropped range are the
      // dominant cost, and the range is only ever appended to. Best-effort - losing the index
      // costs searchability of already-dropped text and must never fail a compaction.
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            for (const row of pending) {
              yield* tx.run(
                sql`INSERT INTO session_content_fts (session_id, ref, text) VALUES (${input.sessionID}, ${row.ref}, ${row.text})`,
              )
            }
          }),
        )
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("ContentIndex.index: insert failed", {
              sessionID: input.sessionID,
              error: String(error),
              rows: pending.length,
            }).pipe(Effect.asVoid),
          ),
        )

      return pending.length
    })

    const search: Interface["search"] = Effect.fn("ContentIndex.search")(function* (input) {
      const query = input.query.trim()
      if (!query) return []
      const rows = yield* db
        .all<{ ref: string; snippet: string; rank: number }>(sql`
          SELECT ref, snippet(session_content_fts, 2, '<b>', '</b>', '...', 12) AS snippet, bm25(session_content_fts) AS rank
          FROM session_content_fts
          WHERE session_id = ${input.sessionID} AND session_content_fts MATCH ${quote(query)}
          ORDER BY rank LIMIT ${input.limit ?? DEFAULT_LIMIT}
        `)
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("ContentIndex.search: query failed", {
              sessionID: input.sessionID,
              query,
              error: String(error),
            }).pipe(Effect.as([])),
          ),
        )
      return rows.map((row) => ({ ref: row.ref, snippet: row.snippet, rank: Number(row.rank) }))
    })

    return Service.of({ index, search })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export const node = LayerNode.make(layer, [Database.node])

export * as AnchorContentIndex from "./content-index"
