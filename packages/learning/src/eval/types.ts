// packages/learning/src/eval/types.ts
//
// Shared types for the offline eval harness (`tl:eval`, TODO.md §4).
//
// Golden-set JSON schema (v2) — 10–20 questions per book covering:
//   - in-book questions with their expected section and/or page
//   - paraphrased variants of the same target
//   - cross-lingual variants (query language ≠ expected section language)
//   - anaphoric follow-ups (`followUpOf` links to the parent question; the
//     harness feeds the parent query through the production rewriter)
//   - off-topic probes that MUST be refused by the gate
//
// Expectations are portable across re-indexing: prefer `expectedSectionTitles`
// (matched against `sections.title` / `sections.heading_path`,
// case-insensitive substring) and `expectedPageRange` over raw
// `expectedChunkIds`, which only survive when chunk ids are stable.

import { Schema } from "effect"

// ---------------------------------------------------------------------------
// Golden-set schema
// ---------------------------------------------------------------------------

export const QuestionKind = Schema.Literals(["in-book", "paraphrased", "cross-lingual", "follow-up", "off-topic"])
export type QuestionKind = Schema.Schema.Type<typeof QuestionKind>

/** Cross-lingual judgements cover Arabic ↔ English/French (RETRIEVAL_V2_PLAN.md §10). */
export const QuestionLanguage = Schema.Literals(["ar", "en", "fr"])
export type QuestionLanguage = Schema.Schema.Type<typeof QuestionLanguage>

export const GoldenQuestion = Schema.Struct({
  id: Schema.String,
  /** Internal id from books.db (takes precedence over `bookSlug` when both are given). */
  bookId: Schema.optional(Schema.String),
  /** Slug from books.db `books.slug` — the portable reference. */
  bookSlug: Schema.optional(Schema.String),
  query: Schema.String,
  language: QuestionLanguage,
  kind: QuestionKind,
  expectedChunkIds: Schema.optional(Schema.Array(Schema.String)),
  expectedSectionTitles: Schema.optional(Schema.Array(Schema.String)),
  expectedPageRange: Schema.optional(
    Schema.Struct({
      start: Schema.Number,
      end: Schema.Number,
    }),
  ),
  /** id of the question this follow-up refers to (anaphoric context). */
  followUpOf: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
})
export type GoldenQuestion = Schema.Schema.Type<typeof GoldenQuestion>

/** `role` labels a golden set as the student or the teacher evaluation set; when both
 * roles are present the report emits a student-vs-teacher comparison table. */
export const GoldenSetRole = Schema.Literals(["student", "teacher"])
export type GoldenSetRole = Schema.Schema.Type<typeof GoldenSetRole>

export const GoldenSetFile = Schema.Struct({
  schemaVersion: Schema.Literals([2]),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  role: Schema.optional(GoldenSetRole),
  questions: Schema.Array(GoldenQuestion),
})
export type GoldenSetFile = Schema.Schema.Type<typeof GoldenSetFile>

// ---------------------------------------------------------------------------
// Resolved question — expectations bound to the indexed corpus
// ---------------------------------------------------------------------------

export interface ResolvedQuestion {
  id: string
  bookId: string
  bookSlug?: string
  query: string
  language: QuestionLanguage
  kind: QuestionKind
  role?: GoldenSetRole
  expectedChunkIds: string[]
  expectedSectionIds: Set<string>
  expectedPageRange?: { start: number; end: number }
  followUpOf?: string
  /** Human-readable warnings for expectations that did not resolve (e.g. unknown section title). */
  unresolved: string[]
}

// ---------------------------------------------------------------------------
// Embedder port
// ---------------------------------------------------------------------------

export interface EvalEmbedder {
  /** Shown in the report ("bge-m3 (teacher)", "student", "standin-hash", …). */
  name: string
  kind: "real" | "student" | "standin" | "custom"
  dims: number
  embed: (text: string) => Promise<Float32Array>
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type RetrieverLeg = "bm25" | "dense" | "fused"

export interface RetrieverMetrics {
  /** recall@k per requested k (metrics.py semantics: per-query set recall, averaged). */
  recallAtK: Record<string, number>
  mrrAt10: number
  ndcgAt10: number
  queries: number
}

export interface ScoreDistribution {
  p5: number
  p50: number
  p95: number
  max: number
  n: number
}

export interface LatencyStats {
  embedP50Ms: number
  embedP95Ms: number
  retrieveP50Ms: number
  retrieveP95Ms: number
  totalP50Ms: number
  totalP95Ms: number
  meanTotalMs: number
}

export interface RunMetrics {
  totalQuestions: number
  inBookQuestions: number
  offTopicQuestions: number
  perRetriever: Record<RetrieverLeg, RetrieverMetrics>
  /** Legacy aggregates (fused leg), kept for the EvalReport shape. */
  recallAt1: number
  recallAt3: number
  recallAt5: number
  recallAt8: number
  mrr: number
  mrrAt10: number
  ndcgAt10: number
  gatePrecision: number
  gateRecall: number
  refusalRateOffTopic: number
  falseRefusalRate: number
  passed: number
  latency: LatencyStats
  peakRssBytes: number
  /** Best-score distributions used for gate-separability calibration. */
  inBookBestDense: ScoreDistribution
  offTopicBestDense: ScoreDistribution
  inBookBestFused: ScoreDistribution
  offTopicBestFused: ScoreDistribution
}

export interface QuestionRow {
  questionId: string
  bookId: string
  kind: QuestionKind
  language: QuestionLanguage
  role?: GoldenSetRole
  query: string
  gateDecision: "pass" | "refused" | "small-talk" | "library-unavailable"
  bestDenseScore: number
  bestFusedScore: number
  /** 1-based rank of the first relevant chunk in the fused ranking (undefined = no hit). */
  hitAtK?: number
  /** Per-question set recall at k=10 over the fused ranking (slice metrics build on this). */
  recallAt10: number
  mrr: number
  ranks: { bm25?: number; dense?: number; fused?: number }
  retrievedChunkIds: string[]
  expectedCount: number
  correct: boolean
  refusalCorrect: boolean
  embedMs: number
  retrieveMs: number
  rewrittenQuery?: string
  warnings: string[]
}

export interface RunResult {
  embedder: string
  embedderKind: EvalEmbedder["kind"]
  role?: GoldenSetRole
  goldenSets: string[]
  metrics: RunMetrics
  rows: QuestionRow[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Promotion gates (RETRIEVAL_V2_PLAN.md §7, training/promote.py)
// ---------------------------------------------------------------------------

export type GateVerdict = "PASS" | "FAIL" | "SKIPPED"

export interface GateCheck {
  id: string
  description: string
  /** "ratio" = student/teacher ratio (promote.py semantics); "absolute" = single-run value;
   * "advisory" = measured, not promotion-blocking. */
  semantics: "ratio" | "absolute" | "advisory"
  value: number
  floor?: number
  verdict: GateVerdict
  detail: string
}

export interface HnswDecision {
  p95Ms: number
  targetMs: number
  recommendation: "keep-bruteforce" | "consider-hnsw" | "measure-on-host"
  detail: string
}

export interface GateReport {
  checks: GateCheck[]
  overallVerdict: "PASS" | "FAIL" | "INCOMPLETE"
  hnsw: HnswDecision
}

// ---------------------------------------------------------------------------
// Comparison tables
// ---------------------------------------------------------------------------

export interface ComparisonRow {
  metric: string
  values: Array<{ run: string; value: number | string }>
  /** student/teacher ratio for numeric rows, when a baseline exists. */
  ratio?: number
}

export interface ComparisonTable {
  kind: "embedder" | "role"
  baseline: string
  columns: Array<{ run: string; role?: GoldenSetRole }>
  rows: ComparisonRow[]
  falseRefusalDelta?: number
}

// ---------------------------------------------------------------------------
// Harness output
// ---------------------------------------------------------------------------

export interface HarnessConfigEcho {
  corpus: string
  goldenFiles: string[]
  embedders: string[]
  kList: number[]
  retrieval: Record<string, unknown>
  gate: Record<string, unknown>
  tag?: string
}

export interface HarnessOutput {
  timestamp: string
  config: HarnessConfigEcho
  environment: Record<string, unknown>
  runs: RunResult[]
  comparisons: ComparisonTable[]
  gates: GateReport
  reportFiles?: { json: string; markdown: string }
}
