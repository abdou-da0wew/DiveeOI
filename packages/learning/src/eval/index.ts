// packages/learning/src/eval/index.ts
//
// Eval harness (plan §15) + the offline `tl:eval` corpus-evaluation harness
// (TODO.md §4 / RETRIEVAL_V2_PLAN.md §10).
//
// A golden set per book with:
//   - In-book questions and their expected section or page
//   - Paraphrased and cross-lingual variants
//   - Follow-ups (anaphoric queries)
//   - Off-topic questions that MUST be refused
//
// Metrics:
//   - recall@k (BM25, dense, fused), MRR@10, nDCG@10
//   - gate precision and recall
//   - refusal rate on off-topic
//   - false-refusal rate on in-book
//   - p50/p95 latency and peak RSS
//
// The eval harness calibrates the gate thresholds (plan §8.3), compares query
// encoders (student vs teacher) through the same complete retrieval path, and
// evaluates the promotion gates of RETRIEVAL_V2_PLAN.md §7 (promote.py
// semantics). See ./types.ts, ./run.ts, ./gates.ts, ./report.ts.
//
// This file keeps the original legacy API (`runEval` / `runQuestion` /
// `calibrateThresholds` — used by scripts/rag-e2e.ts) and re-exports the new
// harness. It carries NO `@ts-nocheck`: the old file needed it for an
// Effect v4-beta narrowing pattern (matchEffect-then-narrow) that no longer
// appears here; the legacy entry points are plain async cores wrapped in
// Effect.promise, which tsgo handles without narrowing help.

import { Effect, Schema } from "effect"
import type { BooksDbHandle } from "../store"
import { retrieve, type RetrievalOptions, type RetrievalResult } from "../retrieve/hybrid"
import { embed as pipelineEmbed } from "../embed/pipeline"
import type { GoldenQuestion, QuestionKind, ResolvedQuestion } from "./types"

// ---------------------------------------------------------------------------
// Re-exports: the v2 golden-set schema, the harness, and its pieces
// ---------------------------------------------------------------------------

export {
  GoldenQuestion,
  GoldenSetFile,
  GoldenSetRole,
  QuestionKind,
  QuestionLanguage,
} from "./types"
export type {
  EvalEmbedder,
  ResolvedQuestion,
  RunResult,
  RunMetrics,
  QuestionRow,
  GateCheck,
  GateReport,
  GateVerdict,
  ComparisonTable,
  HarnessOutput,
  HarnessConfigEcho,
} from "./types"
export { GoldenSetError, parseGoldenSet, buildCorpusIndex, resolveGoldenSets, resolveQuestion } from "./golden"
export type { CorpusIndex, ResolvedGoldenSet } from "./golden"
export {
  standinEmbed,
  makeStandinEmbedder,
  makeDegradedStandinEmbedder,
  makeEmbedderFromSpec,
  makeRealTeacherEmbedder,
  makeStudentEmbedder,
  ensureEvalRuntime,
} from "./embedder"
export { recallAt, reciprocalRankAt, ndcgAt, percentile, aggregateRun } from "./metrics"
export { evaluatePromotionGates, PROMOTION_THRESHOLDS, hnswDecision } from "./gates"
export { renderMarkdown, writeReportFiles } from "./report"
export { runHarness } from "./run"
export type { HarnessConfig, HarnessRunArtifacts } from "./run"

// ---------------------------------------------------------------------------
// Legacy eval result/report schemas (unchanged shape, used by rag-e2e.ts)
// ---------------------------------------------------------------------------

export const EvalResult = Schema.Struct({
  questionId: Schema.String,
  query: Schema.String,
  kind: Schema.Literals(["in-book", "paraphrased", "cross-lingual", "follow-up", "off-topic"]),
  retrievedChunkIds: Schema.Array(Schema.String),
  expectedChunkIds: Schema.Array(Schema.String),
  hitAtK: Schema.optional(Schema.Number),
  mrr: Schema.Number,
  gateDecision: Schema.Literals(["pass", "refused", "small-talk", "library-unavailable"]),
  correct: Schema.Boolean,
  refusalCorrect: Schema.Boolean,
})
export type EvalResult = Schema.Schema.Type<typeof EvalResult>

export const EvalReport = Schema.Struct({
  totalQuestions: Schema.Number,
  passed: Schema.Number,
  recallAt1: Schema.Number,
  recallAt3: Schema.Number,
  recallAt5: Schema.Number,
  recallAt8: Schema.Number,
  mrr: Schema.Number,
  gatePrecision: Schema.Number,
  gateRecall: Schema.Number,
  falseRefusalRate: Schema.Number,
  results: Schema.Array(EvalResult),
})
export type EvalReport = Schema.Schema.Type<typeof EvalReport>

// ---------------------------------------------------------------------------
// Legacy question shape: the v2 GoldenQuestion with bookId and
// expectedChunkIds mandatory (the original pre-v2 contract).
// ---------------------------------------------------------------------------

export type LegacyGoldenQuestion = GoldenQuestion & {
  bookId: string
  expectedChunkIds: string[]
}

export type LegacyEmbedFn = (text: string) => Promise<Float32Array | null>

/** The production pipeline, degrading to a vectorless (BM25-only) leg when it
 * is not initialized — exactly like a chat turn without a loaded model. */
export const defaultLegacyEmbed: LegacyEmbedFn = async (text) =>
  await Effect.runPromise(pipelineEmbed(text).pipe(Effect.orElseSucceed(() => null as Float32Array | null)))

export type LegacyRetrievalOptions = Omit<RetrievalOptions, "bookIds" | "query" | "recentUserTurns" | "debug">

const legacyOptions = (options: LegacyRetrievalOptions): Omit<RetrievalOptions, "bookIds" | "query" | "recentUserTurns"> => ({
  bm25TopK: options.bm25TopK,
  denseTopK: options.denseTopK,
  rrfK: options.rrfK,
  weightBm25: options.weightBm25,
  weightDense: options.weightDense,
  autoWeightByLanguage: options.autoWeightByLanguage,
  finalTopK: options.finalTopK,
  parentExpansion: options.parentExpansion,
  parentContextMaxTokens: options.parentContextMaxTokens,
  queryRewrite: options.queryRewrite,
  rewriteTurns: options.rewriteTurns,
  gate: options.gate,
  debug: false,
})

// ---------------------------------------------------------------------------
// Run a single question through the retriever (legacy shape)
// ---------------------------------------------------------------------------

export const runQuestion = (
  db: BooksDbHandle,
  question: LegacyGoldenQuestion,
  options: LegacyRetrievalOptions,
  embedFn: LegacyEmbedFn = defaultLegacyEmbed,
): Effect.Effect<EvalResult, never> =>
  Effect.promise(async () => {
    const queryVec = await embedFn(question.query)

    const result: RetrievalResult = await Effect.runPromise(
      retrieve(
        db,
        {
          ...legacyOptions(options),
          bookIds: [question.bookId],
          query: question.query,
          recentUserTurns: [],
        },
        queryVec,
      ),
    )

    const retrievedChunkIds = result.candidates.map((c) => c.chunkId)
    const isOffTopic = question.kind === "off-topic"

    let hitAtK: number | undefined
    let mrr = 0
    if (!isOffTopic && question.expectedChunkIds.length > 0) {
      for (let i = 0; i < retrievedChunkIds.length; i++) {
        if (question.expectedChunkIds.includes(retrievedChunkIds[i]!)) {
          hitAtK = i + 1
          mrr = 1 / (i + 1)
          break
        }
      }
    }

    const refusalCorrect = isOffTopic
      ? result.gateDecision === "refused"
      : result.gateDecision !== "refused"
    const retrievalCorrect = isOffTopic
      ? true
      : hitAtK !== undefined && hitAtK <= (options.finalTopK ?? 8)
    const correct = refusalCorrect && retrievalCorrect

    return EvalResult.make({
      questionId: question.id,
      query: question.query,
      kind: question.kind,
      retrievedChunkIds,
      expectedChunkIds: question.expectedChunkIds,
      hitAtK,
      mrr,
      gateDecision: result.gateDecision,
      correct,
      refusalCorrect,
    })
  })

// ---------------------------------------------------------------------------
// Run the full eval suite (legacy shape)
// ---------------------------------------------------------------------------

export const runEval = (
  db: BooksDbHandle,
  questions: LegacyGoldenQuestion[],
  options: LegacyRetrievalOptions,
  embedFn: LegacyEmbedFn = defaultLegacyEmbed,
): Effect.Effect<EvalReport, never> =>
  Effect.promise(async () => {
    const results: EvalResult[] = []
    for (const q of questions) {
      results.push(await Effect.runPromise(runQuestion(db, q, options, embedFn)))
    }

    const total = results.length
    const inBook = results.filter((r) => r.kind !== "off-topic")
    const offTopic = results.filter((r) => r.kind === "off-topic")

    const recallAtK = (k: number) => {
      if (inBook.length === 0) return 0
      const hits = inBook.filter((r) => r.hitAtK !== undefined && r.hitAtK <= k).length
      return hits / inBook.length
    }
    const mrr =
      inBook.length > 0 ? inBook.reduce((sum, r) => sum + r.mrr, 0) / inBook.length : 0
    const passed = results.filter((r) => r.correct).length

    const refused = results.filter((r) => r.gateDecision === "refused")
    const correctlyRefused = refused.filter((r) => r.kind === "off-topic").length
    const incorrectlyRefused = refused.filter((r) => r.kind !== "off-topic").length
    const gatePrecision = refused.length > 0 ? correctlyRefused / refused.length : 1
    const gateRecall =
      offTopic.length > 0
        ? offTopic.filter((r) => r.gateDecision === "refused").length / offTopic.length
        : 1
    const falseRefusalRate = inBook.length > 0 ? incorrectlyRefused / inBook.length : 0

    return EvalReport.make({
      totalQuestions: total,
      passed,
      recallAt1: recallAtK(1),
      recallAt3: recallAtK(3),
      recallAt5: recallAtK(5),
      recallAt8: recallAtK(8),
      mrr,
      gatePrecision,
      gateRecall,
      falseRefusalRate,
      results,
    })
  })

// ---------------------------------------------------------------------------
// Threshold calibration (plan §8.3, §15)
// ---------------------------------------------------------------------------

export interface CalibratedThresholds {
  minDenseScore: number
  minFusedScore: number
  f1: number
}

/**
 * Sweep gate thresholds to find the pair that maximizes gate F1 score.
 * Used by the eval harness to calibrate the gate on real books.
 */
export const calibrateThresholds = (
  db: BooksDbHandle,
  questions: LegacyGoldenQuestion[],
  options: LegacyRetrievalOptions,
  sweep: { denseSteps: number[]; fusedSteps: number[] } = {
    denseSteps: [0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6],
    fusedSteps: [0.01, 0.05, 0.1, 0.15, 0.2, 0.3],
  },
  embedFn: LegacyEmbedFn = defaultLegacyEmbed,
): Effect.Effect<CalibratedThresholds, never> =>
  Effect.promise(async () => {
    let best: CalibratedThresholds = {
      minDenseScore: 0.3,
      minFusedScore: 0.1,
      f1: 0,
    }

    for (const dense of sweep.denseSteps) {
      for (const fused of sweep.fusedSteps) {
        const report = await Effect.runPromise(
          runEval(
            db,
            questions,
            {
              ...options,
              gate: {
                ...options.gate,
                minDenseScore: dense,
                minFusedScore: fused,
              },
            },
            embedFn,
          ),
        )
        const precision = report.gatePrecision
        const recall = report.gateRecall
        const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
        if (f1 > best.f1) {
          best = { minDenseScore: dense, minFusedScore: fused, f1 }
        }
      }
    }

    return best
  })

// ---------------------------------------------------------------------------
// Bridge: resolved v2 question → legacy question (for runEval reuse)
// ---------------------------------------------------------------------------

export const toLegacyQuestion = (q: ResolvedQuestion): LegacyGoldenQuestion => ({
  id: q.id,
  bookId: q.bookId,
  query: q.query,
  language: q.language,
  kind: q.kind as QuestionKind,
  expectedChunkIds: [...q.expectedChunkIds],
  ...(q.expectedPageRange ? { expectedPageRange: q.expectedPageRange } : {}),
})
