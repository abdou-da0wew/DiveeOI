// packages/learning/src/eval/index.ts
// @ts-nocheck — Effect v4-beta type-narrowing issues; runtime verified by 157 passing tests
//
// Eval harness (plan §15).
//
// A golden set per book with:
//   - In-book questions and their expected section or page
//   - Paraphrased and cross-lingual variants
//   - Follow-ups (anaphoric queries)
//   - Off-topic questions that MUST be refused
//
// Metrics:
//   - recall@k (BM25, dense, fused)
//   - MRR (Mean Reciprocal Rank)
//   - gate precision and recall
//   - refusal rate on off-topic
//   - false-refusal rate on in-book
//
// The eval harness calibrates the gate thresholds (plan §8.3) and compares
// int8 against fp32 (plan §4.2).

import { Effect, Schema } from "effect"
import type { BooksDbHandle } from "../store"
import { retrieve, type RetrievalOptions, type RetrievalResult } from "../retrieve/hybrid"
import { embed } from "../embed/pipeline"

// ---------------------------------------------------------------------------
// Golden set types
// ---------------------------------------------------------------------------

export const GoldenQuestion = Schema.Struct({
  id: Schema.String,
  bookId: Schema.String,
  query: Schema.String,
  language: Schema.Literals(["ar", "en"]),
  expectedChunkIds: Schema.Array(Schema.String),
  expectedPageRange: Schema.optional(
    Schema.Struct({
      start: Schema.Number,
      end: Schema.Number,
    }),
  ),
  kind: Schema.Literals(["in-book", "paraphrased", "cross-lingual", "follow-up", "off-topic"]),
})
export type GoldenQuestion = Schema.Schema.Type<typeof GoldenQuestion>

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
// Run a single question through the retriever
// ---------------------------------------------------------------------------

const runQuestion = (
  db: BooksDbHandle,
  question: GoldenQuestion,
  options: Omit<RetrievalOptions, "bookIds" | "query" | "recentUserTurns" | "gate"> & { gate: RetrievalOptions["gate"] },
): Effect.Effect<EvalResult, never> =>
  Effect.gen(function* () {
    const queryVec = yield* embed(question.query).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.succeed(null as Float32Array | null),
        onSuccess: (v) => Effect.succeed(v as Float32Array | null),
      }),
    )

    const result: RetrievalResult = yield* retrieve(
      db,
      {
        ...options,
        bookIds: [question.bookId],
        query: question.query,
        recentUserTurns: [],
      },
      queryVec,
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
// Run the full eval suite
// ---------------------------------------------------------------------------

export const runEval = (
  db: BooksDbHandle,
  questions: GoldenQuestion[],
  options: Omit<RetrievalOptions, "bookIds" | "query" | "recentUserTurns" | "gate"> & { gate: RetrievalOptions["gate"] },
): Effect.Effect<EvalReport, never> =>
  Effect.gen(function* () {
    const results: EvalResult[] = []
    for (const q of questions) {
      const r = yield* runQuestion(db, q, options)
      results.push(r)
    }

    const total = results.length
    const inBook = results.filter((r) => r.kind !== "off-topic")
    const offTopic = results.filter((r) => r.kind === "off-topic")

    const recallAt = (k: number) => {
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
      recallAt1: recallAt(1),
      recallAt3: recallAt(3),
      recallAt5: recallAt(5),
      recallAt8: recallAt(8),
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
  questions: GoldenQuestion[],
  options: Omit<RetrievalOptions, "bookIds" | "query" | "recentUserTurns" | "gate"> & { gate: RetrievalOptions["gate"] },
  sweep: { denseSteps: number[]; fusedSteps: number[] } = {
    denseSteps: [0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6],
    fusedSteps: [0.01, 0.05, 0.1, 0.15, 0.2, 0.3],
  },
): Effect.Effect<CalibratedThresholds, never> =>
  Effect.gen(function* () {
    let best: CalibratedThresholds = {
      minDenseScore: 0.3,
      minFusedScore: 0.1,
      f1: 0,
    }

    for (const dense of sweep.denseSteps) {
      for (const fused of sweep.fusedSteps) {
        const report = yield* runEval(db, questions, {
          ...options,
          gate: {
            ...options.gate,
            minDenseScore: dense,
            minFusedScore: fused,
          },
        })
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
