// packages/learning/src/eval/metrics.ts
//
// Ranking metrics + run aggregation for the eval harness.
//
// Semantics deliberately mirror packages/learning/training/metrics.py (and
// native/retrieval/src/metrics.rs) so the TS harness numbers are directly
// comparable with the Python/Rust eval numbers:
//   - recall@k: per-query set recall |top-k ∩ relevant| / |relevant|, averaged
//   - mrr@k: reciprocal rank of the first relevant item within the top k
//   - ndcg@k: binary-relevance nDCG
// Percentiles use linear interpolation (numpy default).

import type {
  QuestionRow,
  RetrieverLeg,
  RetrieverMetrics,
  RunMetrics,
  ScoreDistribution,
  LatencyStats,
} from "./types"

// ---------------------------------------------------------------------------
// Primitives (mirror training/metrics.py)
// ---------------------------------------------------------------------------

export const recallAt = (ranked: string[], relevant: Set<string>, k: number): number => {
  if (relevant.size === 0) return 0
  let hits = 0
  for (let i = 0; i < Math.min(k, ranked.length); i++) {
    if (relevant.has(ranked[i]!)) hits++
  }
  return hits / relevant.size
}

export const reciprocalRankAt = (ranked: string[], relevant: Set<string>, k: number): number => {
  for (let i = 0; i < Math.min(k, ranked.length); i++) {
    if (relevant.has(ranked[i]!)) return 1 / (i + 1)
  }
  return 0
}

export const ndcgAt = (ranked: string[], relevant: Set<string>, k: number): number => {
  if (relevant.size === 0) return 0
  const gain = (index: number) => 1 / Math.log2(index + 2)
  let dcg = 0
  for (let i = 0; i < Math.min(k, ranked.length); i++) {
    if (relevant.has(ranked[i]!)) dcg += gain(i)
  }
  let ideal = 0
  for (let i = 0; i < Math.min(k, relevant.size); i++) ideal += gain(i)
  return ideal === 0 ? 0 : dcg / ideal
}

/** numpy-style percentile with linear interpolation. */
export const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const pos = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length)

export const distribution = (values: number[]): ScoreDistribution => ({
  p5: percentile(values, 5),
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  max: values.length === 0 ? 0 : Math.max(...values),
  n: values.length,
})

// ---------------------------------------------------------------------------
// Run aggregation
// ---------------------------------------------------------------------------

export interface RunAggregateInput {
  rows: QuestionRow[]
  /** Ranked chunk ids per question, keyed by leg. Off-topic rows may be absent. */
  rankings: Map<string, { bm25?: string[]; dense?: string[]; fused: string[] }>
  relevantSets: Map<string, Set<string>>
  kList: number[]
  peakRssBytes: number
}

const emptyLegMetrics = (kList: number[]): RetrieverMetrics => ({
  recallAtK: Object.fromEntries(kList.map((k) => [String(k), 0])),
  mrrAt10: 0,
  ndcgAt10: 0,
  queries: 0,
})

export const aggregateRun = (input: RunAggregateInput): RunMetrics => {
  const { rows, rankings, relevantSets, kList } = input
  const inBookRows = rows.filter((r) => r.kind !== "off-topic")
  const offTopicRows = rows.filter((r) => r.kind === "off-topic")

  const perRetriever: Record<RetrieverLeg, RetrieverMetrics> = {
    bm25: emptyLegMetrics(kList),
    dense: emptyLegMetrics(kList),
    fused: emptyLegMetrics(kList),
  }
  const legs: RetrieverLeg[] = ["bm25", "dense", "fused"]
  for (const leg of legs) perRetriever[leg].queries = inBookRows.length

  for (const row of inBookRows) {
    const relevant = relevantSets.get(row.questionId) ?? new Set<string>()
    if (relevant.size === 0) continue
    const rankedFor = rankings.get(row.questionId)
    if (!rankedFor) continue
    for (const leg of legs) {
      const ranked = leg === "fused" ? rankedFor.fused : rankedFor[leg]
      if (!ranked) continue // leg unavailable for this question (e.g. no vectors → no dense ranking)
      const m = perRetriever[leg]!
      for (const k of kList) {
        m.recallAtK[String(k)] = (m.recallAtK[String(k)] ?? 0) + recallAt(ranked, relevant, k)
      }
      m.mrrAt10 += reciprocalRankAt(ranked, relevant, 10)
      m.ndcgAt10 += ndcgAt(ranked, relevant, 10)
    }
  }
  for (const leg of legs) {
    const m = perRetriever[leg]!
    const n = inBookRows.length
    if (n > 0) {
      for (const k of Object.keys(m.recallAtK)) m.recallAtK[k] = (m.recallAtK[k] ?? 0) / n
      m.mrrAt10 /= n
      m.ndcgAt10 /= n
    }
  }

  const fusedMrrUnCapped = mean(inBookRows.map((r) => r.mrr))
  const hitRate = (k: number) =>
    inBookRows.length === 0
      ? 0
      : inBookRows.filter((r) => r.hitAtK !== undefined && r.hitAtK <= k).length / inBookRows.length

  const refused = rows.filter((r) => r.gateDecision === "refused")
  const correctlyRefused = refused.filter((r) => r.kind === "off-topic").length
  const falseRefusals = refused.filter((r) => r.kind !== "off-topic").length
  const gatePrecision = refused.length > 0 ? correctlyRefused / refused.length : 1
  const gateRecall = offTopicRows.length > 0 ? offTopicRows.filter((r) => r.gateDecision === "refused").length / offTopicRows.length : 1
  const falseRefusalRate = inBookRows.length > 0 ? falseRefusals / inBookRows.length : 0

  const embedMs = rows.map((r) => r.embedMs)
  const retrieveMs = rows.map((r) => r.retrieveMs)
  const totalMs = rows.map((r) => r.embedMs + r.retrieveMs)
  const latency: LatencyStats = {
    embedP50Ms: percentile(embedMs, 50),
    embedP95Ms: percentile(embedMs, 95),
    retrieveP50Ms: percentile(retrieveMs, 50),
    retrieveP95Ms: percentile(retrieveMs, 95),
    totalP50Ms: percentile(totalMs, 50),
    totalP95Ms: percentile(totalMs, 95),
    meanTotalMs: mean(totalMs),
  }

  const inBookDense = inBookRows.map((r) => r.bestDenseScore)
  const offTopicDense = offTopicRows.map((r) => r.bestDenseScore)

  return {
    totalQuestions: rows.length,
    inBookQuestions: inBookRows.length,
    offTopicQuestions: offTopicRows.length,
    perRetriever,
    recallAt1: hitRate(1),
    recallAt3: hitRate(3),
    recallAt5: hitRate(5),
    recallAt8: hitRate(8),
    mrr: fusedMrrUnCapped,
    mrrAt10: perRetriever.fused!.mrrAt10,
    ndcgAt10: perRetriever.fused!.ndcgAt10,
    gatePrecision,
    gateRecall,
    refusalRateOffTopic: gateRecall,
    falseRefusalRate,
    passed: rows.filter((r) => r.correct).length,
    latency,
    peakRssBytes: input.peakRssBytes,
    inBookBestDense: distribution(inBookDense),
    offTopicBestDense: distribution(offTopicDense),
    inBookBestFused: distribution(inBookRows.map((r) => r.bestFusedScore)),
    offTopicBestFused: distribution(offTopicRows.map((r) => r.bestFusedScore)),
  }
}
