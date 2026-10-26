// packages/learning/src/retrieve/hybrid.ts
//
// Hybrid retrieval: BM25 (FTS5) + dense (brute-force cosine) + RRF
// fusion + parent expansion (plan §8).
//
// Phase 3 implementation. Uses the BooksStore to run BM25 over chunks_fts
// and brute-force cosine over chunk_vecs. Parent expansion loads the
// parent section text from the sections table.

import { Effect, Schema } from "effect"
import type { BooksDbHandle } from "../store"
import { normalizeForSearch } from "../lang/arabic"
import { rrf } from "./rrf"
import { evaluate as evaluateGate, type GateInput } from "./gate"
import { rewrite as rewriteQuery } from "./rewrite"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const Candidate = Schema.Struct({
  chunkId: Schema.String,
  bookId: Schema.String,
  sectionId: Schema.String,
  page: Schema.optional(Schema.Number),
  text: Schema.String,
  bm25Score: Schema.optional(Schema.Number),
  denseScore: Schema.optional(Schema.Number),
  fusedScore: Schema.Number,
  parent: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      headingPath: Schema.optional(Schema.String),
    }),
  ),
})
export type Candidate = Schema.Schema.Type<typeof Candidate>

export const RetrievalResult = Schema.Struct({
  candidates: Schema.Array(Candidate),
  bm25TopK: Schema.Number,
  denseTopK: Schema.Number,
  fusedTopK: Schema.Number,
  finalTopK: Schema.Number,
  gateDecision: Schema.Literals(["pass", "refused", "small-talk", "library-unavailable"]),
  gateReason: Schema.optional(Schema.String),
  rewrittenQuery: Schema.optional(Schema.String),
  totalContextTokens: Schema.Number,
})
export type RetrievalResult = Schema.Schema.Type<typeof RetrievalResult>

export interface RetrievalOptions {
  bookIds: string[]
  query: string
  bm25TopK: number
  denseTopK: number
  rrfK: number
  weightBm25: number
  weightDense: number
  autoWeightByLanguage: boolean
  finalTopK: number
  parentExpansion: boolean
  parentContextMaxTokens: number
  queryRewrite: "heuristic" | "llm" | "off"
  rewriteTurns: number
  recentUserTurns: string[]
  gate: Omit<GateInput, "query" | "bestDenseScore" | "bestFusedScore">
}

// ---------------------------------------------------------------------------
// b64 <-> Float32Array (re-used from self-test)
// ---------------------------------------------------------------------------

const b64ToVector = (b64: string): Float32Array => {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

const cosine = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!
    const bv = b[i]!
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ---------------------------------------------------------------------------
// BM25 via FTS5 (lexical search over text_norm)
// ---------------------------------------------------------------------------

interface Bm25Hit {
  chunkId: string
  bookId: string
  sectionId: string
  page: number | undefined
  text: string
  bm25Score: number
}

const runBm25 = (
  db: BooksDbHandle,
  bookIds: string[],
  normalizedQuery: string,
  topK: number,
): Effect.Effect<Bm25Hit[], never> =>
  Effect.gen(function* () {
    if (bookIds.length === 0 || !normalizedQuery) return []

    // Sanitize the query for FTS5: split into terms, wrap each in quotes
    // to avoid MATCH syntax errors from punctuation.
    const terms = normalizedQuery
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t.replace(/"/g, "")}"`)
      .join(" ")
    if (!terms) return []

    const placeholders = bookIds.map(() => "?").join(",")
    const sql = `
      SELECT c.id, c.book_id, c.section_id, c.page, c.text,
             -bm25(chunks_fts) AS score
      FROM chunks_fts
      JOIN chunks c ON c.rowid = chunks_fts.rowid
      WHERE chunks_fts MATCH ?
        AND c.book_id IN (${placeholders})
      ORDER BY score DESC
      LIMIT ?
    `
    const params = [terms, ...bookIds, topK] as unknown[]
    const rawRows = yield* Effect.tryPromise({
      try: () =>
        db.all<{
          id: string
          book_id: string
          section_id: string
          page: number | null
          text: string
          score: number
        }>(sql, ...params),
      catch: () => [] as Record<string, unknown>[],
    }).pipe(Effect.orElseSucceed(() => [] as Record<string, unknown>[]))
    const rows = (rawRows ?? []) as { id: string; book_id: string; section_id: string; page: number | null; text: string; score: number }[]
    return rows.map((r) => ({
      chunkId: r.id,
      bookId: r.book_id,
      sectionId: r.section_id,
      page: r.page ?? undefined,
      text: r.text,
      bm25Score: r.score,
    }))
  })

// ---------------------------------------------------------------------------
// Dense via brute-force cosine over chunk_vecs
// ---------------------------------------------------------------------------

interface DenseHit {
  chunkId: string
  bookId: string
  sectionId: string
  page: number | undefined
  text: string
  denseScore: number
}

const runDense = (
  db: BooksDbHandle,
  bookIds: string[],
  queryVector: Float32Array | null,
  topK: number,
): Effect.Effect<DenseHit[], never> =>
  Effect.gen(function* () {
    if (bookIds.length === 0 || !queryVector) return []

    // Load all vectors for the session's books and compute cosine.
    // Phase 6 optimization: use sqlite-vec or an in-memory LRU cache.
    const placeholders = bookIds.map(() => "?").join(",")
    const sql = `
      SELECT v.chunk_id, v.vec, c.book_id, c.section_id, c.page, c.text
      FROM chunk_vecs v
      JOIN chunks c ON c.id = v.chunk_id
      WHERE c.book_id IN (${placeholders})
    `
    const rawRows = yield* Effect.tryPromise({
      try: () =>
        db.all<{
          chunk_id: string
          vec: string
          book_id: string
          section_id: string
          page: number | null
          text: string
        }>(sql, ...bookIds),
      catch: () => [] as Record<string, unknown>[],
    }).pipe(Effect.orElseSucceed(() => [] as Record<string, unknown>[]))
    const rows = (rawRows ?? []) as { chunk_id: string; vec: string; book_id: string; section_id: string; page: number | null; text: string }[]

    const scored = rows.map((r) => {
      const vec = b64ToVector(r.vec)
      const score = cosine(queryVector, vec)
      return {
        chunkId: r.chunk_id,
        bookId: r.book_id,
        sectionId: r.section_id,
        page: r.page ?? undefined,
        text: r.text,
        denseScore: score,
      }
    })
    scored.sort((a, b) => b.denseScore - a.denseScore)
    return scored.slice(0, topK)
  })

// ---------------------------------------------------------------------------
// Parent expansion
// ---------------------------------------------------------------------------

const expandParents = (
  db: BooksDbHandle,
  candidates: Candidate[],
  maxTokens: number,
): Effect.Effect<Candidate[], never> =>
  Effect.gen(function* () {
    if (candidates.length === 0) return candidates
    const sectionIds = [...new Set(candidates.map((c) => c.sectionId))]
    if (sectionIds.length === 0) return candidates

    const placeholders = sectionIds.map(() => "?").join(",")
    const sql = `SELECT id, text, heading_path FROM sections WHERE id IN (${placeholders})`
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.all<{ id: string; text: string; heading_path: string | null }>(sql, ...sectionIds),
      catch: () => [] as Record<string, unknown>[],
    }).pipe(Effect.orElseSucceed(() => [] as Record<string, unknown>[]))
    const safeRows = (rows ?? []) as { id: string; text: string; heading_path: string | null }[]
    const sectionMap = new Map(safeRows.map((r) => [r.id, r]))

    // Rough token estimate: 1 token per 4 chars.
    let tokenBudget = maxTokens
    return candidates.map((c) => {
      const section = sectionMap.get(c.sectionId)
      if (!section || tokenBudget <= 0) return c
      const parentTokens = Math.ceil(section.text.length / 4)
      tokenBudget -= parentTokens
      return {
        ...c,
        parent: {
          id: section.id,
          text: section.text,
          headingPath: section.heading_path ?? undefined,
        },
      }
    })
  })

// ---------------------------------------------------------------------------
// Main retrieval pipeline
// ---------------------------------------------------------------------------

export const retrieve = (
  db: BooksDbHandle | null,
  options: RetrievalOptions,
  queryVector: Float32Array | null,
): Effect.Effect<RetrievalResult, never> =>
  Effect.gen(function* () {
    // Library unavailable
    if (!db) {
      return RetrievalResult.make({
        candidates: [],
        bm25TopK: 0,
        denseTopK: 0,
        fusedTopK: 0,
        finalTopK: 0,
        gateDecision: "library-unavailable",
        gateReason: "books.db not available",
        totalContextTokens: 0,
      })
    }

    // Query rewriting
    const rewrittenQuery = yield* rewriteQuery({
      query: options.query,
      recentUserTurns: options.recentUserTurns,
      mode: options.queryRewrite,
      rewriteTurns: options.rewriteTurns,
    })
    const normalizedQuery = normalizeForSearch(rewrittenQuery)

    // BM25 and dense in parallel
    const [bm25Hits, denseHits] = yield* Effect.all([
      runBm25(db, options.bookIds, normalizedQuery, options.bm25TopK),
      runDense(db, options.bookIds, queryVector, options.denseTopK),
    ])

    // RRF fusion
    const bm25Ranked = bm25Hits.map((h) => h.chunkId)
    const denseRanked = denseHits.map((h) => h.chunkId)
    const fusedScores = rrf(bm25Ranked, denseRanked, options.rrfK, options.weightBm25, options.weightDense)

    // Build candidate map from both lists
    const candidateMap = new Map<string, Candidate>()
    for (const h of bm25Hits) {
      candidateMap.set(h.chunkId, {
        chunkId: h.chunkId,
        bookId: h.bookId,
        sectionId: h.sectionId,
        page: h.page,
        text: h.text,
        bm25Score: h.bm25Score,
        fusedScore: fusedScores.get(h.chunkId) ?? 0,
      })
    }
    for (const h of denseHits) {
      const existing = candidateMap.get(h.chunkId)
      if (existing) {
        // Schema.Struct fields are readonly — replace the entry instead of mutating.
        candidateMap.set(h.chunkId, { ...existing, denseScore: h.denseScore })
      } else {
        candidateMap.set(h.chunkId, {
          chunkId: h.chunkId,
          bookId: h.bookId,
          sectionId: h.sectionId,
          page: h.page,
          text: h.text,
          denseScore: h.denseScore,
          fusedScore: fusedScores.get(h.chunkId) ?? 0,
        })
      }
    }

    // Sort by fused score, take finalTopK
    let candidates = [...candidateMap.values()].sort((a, b) => b.fusedScore - a.fusedScore).slice(0, options.finalTopK)

    // Parent expansion
    if (options.parentExpansion) {
      candidates = yield* expandParents(db, candidates, options.parentContextMaxTokens)
    }

    // Gate
    const bestDenseScore = Math.max(0, ...denseHits.map((h) => h.denseScore))
    const bestFusedScore = candidates.length > 0 ? candidates[0]!.fusedScore : 0
    const gateResult = yield* evaluateGate({
      ...options.gate,
      query: options.query,
      bestDenseScore,
      bestFusedScore,
    })

    // If gate refuses, return empty candidates
    const finalCandidates = gateResult.decision === "pass" ? candidates : []
    const totalContextTokens = finalCandidates.reduce(
      (sum, c) => sum + Math.ceil(c.text.length / 4) + (c.parent ? Math.ceil(c.parent.text.length / 4) : 0),
      0,
    )

    return RetrievalResult.make({
      candidates: finalCandidates,
      bm25TopK: bm25Hits.length,
      denseTopK: denseHits.length,
      fusedTopK: candidateMap.size,
      finalTopK: finalCandidates.length,
      gateDecision: gateResult.decision,
      gateReason: gateResult.reason,
      rewrittenQuery: rewrittenQuery !== options.query ? rewrittenQuery : undefined,
      totalContextTokens,
    })
  })
