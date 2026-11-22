// packages/learning/src/eval/gates.ts
//
// Promotion-gate evaluation (RETRIEVAL_V2_PLAN.md §7 / §10) — the same gate
// contract training/promote.py implements, evaluated by the tl:eval harness:
//
//   recall@10 ≥ 0.95 · recall@5 ≥ 0.93 · mrr@10 ≥ 0.93 · ndcg@10 ≥ 0.93
//     (student/teacher RATIOS on a held-out set; when the harness runs a
//      single embedder the same floors apply to the absolute values and the
//      report says so explicitly)
//   cross-lingual recall@10 ≥ 0.90 — slices under the 20-query sample floor
//     are recorded as SKIPPED and are NOT silently counted as coverage
//   gate separability: in-book p5 best score must sit above off-topic p95
//   false-refusal increase bounded by 2 percentage points (plan §7)
//
// Latency/RSS rows are labelled advisory measurements: per the plan they are
// host-specific objectives, never universal guarantees, and the HNSW decision
// needs measured library-scale p95 on the real corpus.

import type {
  GateCheck,
  GateReport,
  GateVerdict,
  HnswDecision,
  RunResult,
} from "./types"

export const PROMOTION_THRESHOLDS = {
  recallAt10: 0.95,
  recallAt5: 0.93,
  mrrAt10: 0.93,
  ndcgAt10: 0.93,
  crossLingualRecallAt10: 0.9,
  maxFalseRefusalRate: 0.02,
  minCrossLingualQueries: 20,
  latencyTargetP95Ms: 30,
  steadyStateRssTargetBytes: 1024 * 1024 * 1024,
} as const

export interface GateEvaluationInput {
  /** runs[0] is the baseline (teacher); later runs are students. */
  runs: RunResult[]
  kList: number[]
  corpusChunkCount: number
  thresholds?: Partial<typeof PROMOTION_THRESHOLDS>
}

const ratio = (student: number, baseline: number): number => (baseline > 0 ? student / baseline : 0)

const fmt = (x: number): string => (Number.isFinite(x) ? x.toFixed(4) : String(x))

export const evaluatePromotionGates = (input: GateEvaluationInput): GateReport => {
  const t = { ...PROMOTION_THRESHOLDS, ...(input.thresholds ?? {}) }
  const baseline = input.runs[0]
  const student = input.runs.length > 1 ? input.runs[input.runs.length - 1] : undefined
  // Ratio semantics need exactly the teacher/student pair; with one run the same
  // floors apply to absolute values (labelled in every check).
  const useRatio = baseline !== undefined && student !== undefined
  const semantics: GateCheck["semantics"] = useRatio ? "ratio" : "absolute"

  const checks: GateCheck[] = []

  const metricChecks: Array<{ id: string; label: string; floor: number; pick: (r: RunResult) => number }> = [
    { id: "recall_at_10", label: "Recall@10 (fused)", floor: t.recallAt10, pick: (r) => r.metrics.perRetriever.fused?.recallAtK["10"] ?? 0 },
    { id: "recall_at_5", label: "Recall@5 (fused)", floor: t.recallAt5, pick: (r) => r.metrics.perRetriever.fused?.recallAtK["5"] ?? 0 },
    { id: "mrr_at_10", label: "MRR@10 (fused)", floor: t.mrrAt10, pick: (r) => r.metrics.mrrAt10 },
    { id: "ndcg_at_10", label: "nDCG@10 (fused)", floor: t.ndcgAt10, pick: (r) => r.metrics.ndcgAt10 },
  ]
  for (const m of metricChecks) {
    const base = baseline ? m.pick(baseline) : 0
    const stud = student ? m.pick(student) : base
    const value = useRatio ? ratio(stud, base) : stud
    const verdict: GateVerdict = value >= m.floor ? "PASS" : "FAIL"
    checks.push({
      id: m.id,
      description: m.label,
      semantics,
      value,
      floor: m.floor,
      verdict,
      detail: useRatio
        ? `student ${fmt(stud)} / teacher ${fmt(base)} = ${fmt(value)} (promote.py ratio semantics)`
        : `absolute ${fmt(value)} — single-embedder run; promote.py normally uses student/teacher ratios`,
    })
  }

  // Cross-lingual slice: recorded always, gated only above the sample floor.
  const crossBase = baseline ? crossLingualRecall(baseline) : { value: 0, queries: 0 }
  const crossStud = student ? crossLingualRecall(student) : crossBase
  if (crossStud.queries < t.minCrossLingualQueries) {
    checks.push({
      id: "cross_lingual_recall_at_10",
      description: "Cross-lingual Recall@10 (fused)",
      semantics,
      value: crossStud.value,
      floor: t.crossLingualRecallAt10,
      verdict: "SKIPPED",
      detail: `${crossStud.queries} cross-lingual queries < sample floor ${t.minCrossLingualQueries} — recorded, not gated (promote.py semantics); collect more judgements before promoting`,
    })
  } else {
    const value = useRatio ? ratio(crossStud.value, crossBase.value) : crossStud.value
    checks.push({
      id: "cross_lingual_recall_at_10",
      description: "Cross-lingual Recall@10 (fused)",
      semantics,
      value,
      floor: t.crossLingualRecallAt10,
      verdict: value >= t.crossLingualRecallAt10 ? "PASS" : "FAIL",
      detail: useRatio
        ? `student ${fmt(crossStud.value)} / teacher ${fmt(crossBase.value)} over ${crossStud.queries} queries`
        : `absolute ${fmt(value)} over ${crossStud.queries} cross-lingual queries`,
    })
  }

  // Gate separability (blocking in promote.py): in-book p5 above off-topic p95.
  const sep = separability(student ?? baseline)
  if (sep) {
    checks.push({
      id: "gate_separability",
      description: "Gate separability (in-book p5 > off-topic p95)",
      semantics: "absolute",
      value: sep.score,
      verdict: sep.separable ? "PASS" : "FAIL",
      detail: `${sep.scoreName}: in-book p5 ${fmt(sep.inBookP5)} vs off-topic p95 ${fmt(sep.offTopicP95)}`,
    })
  } else {
    checks.push({
      id: "gate_separability",
      description: "Gate separability (in-book p5 > off-topic p95)",
      semantics: "absolute",
      value: 0,
      verdict: "SKIPPED",
      detail: "no off-topic probes or no in-book questions in the golden set — add refusal probes before promoting",
    })
  }

  // False-refusal bound (plan §7): increase bounded by 2 percentage points.
  const frBase = baseline ? baseline.metrics.falseRefusalRate : 0
  const frStud = student ? student.metrics.falseRefusalRate : frBase
  if (useRatio) {
    const delta = frStud - frBase
    checks.push({
      id: "false_refusal_delta",
      description: "False-refusal increase (student − teacher)",
      semantics: "ratio",
      value: delta,
      floor: t.maxFalseRefusalRate,
      verdict: delta <= t.maxFalseRefusalRate ? "PASS" : "FAIL",
      detail: `student ${fmt(frStud)} − teacher ${fmt(frBase)} = ${fmt(delta)} (max allowed ${t.maxFalseRefusalRate})`,
    })
  } else {
    checks.push({
      id: "false_refusal_rate",
      description: "False-refusal rate on in-book questions",
      semantics: "absolute",
      value: frStud,
      floor: t.maxFalseRefusalRate,
      verdict: frStud <= t.maxFalseRefusalRate ? "PASS" : "FAIL",
      detail: `absolute ${fmt(frStud)}; the plan bounds the student-vs-teacher increase at ${t.maxFalseRefusalRate}`,
    })
  }

  // Advisory measurements — host-specific objectives, never universal guarantees.
  const p95 = student ? student.metrics.latency.retrieveP95Ms : (baseline?.metrics.latency.retrieveP95Ms ?? 0)
  checks.push({
    id: "latency_p95",
    description: `Retrieval p95 latency (advisory target ≤ ${t.latencyTargetP95Ms} ms on deployment hardware)`,
    semantics: "advisory",
    value: p95,
    floor: t.latencyTargetP95Ms,
    verdict: p95 <= t.latencyTargetP95Ms ? "PASS" : "FAIL",
    detail: "measured on this host with this corpus size; not a universal guarantee (plan §7)",
  })
  const rss = student ? student.metrics.peakRssBytes : (baseline?.metrics.peakRssBytes ?? 0)
  checks.push({
    id: "peak_rss",
    description: `Peak eval-process RSS (advisory target < ${Math.round(t.steadyStateRssTargetBytes / 1024 / 1024)} MiB)`,
    semantics: "advisory",
    value: rss,
    floor: t.steadyStateRssTargetBytes,
    verdict: rss <= t.steadyStateRssTargetBytes ? "PASS" : "FAIL",
    detail: "eval-process peak; steady-state chat RSS must be measured on the live host separately",
  })

  const blocking = checks.filter((c) => c.semantics !== "advisory")
  const hasFail = blocking.some((c) => c.verdict === "FAIL")
  const hasIncompleteSkip = blocking.some((c) => c.verdict === "SKIPPED" && c.id === "gate_separability")
  const overallVerdict: GateReport["overallVerdict"] = hasFail ? "FAIL" : hasIncompleteSkip ? "INCOMPLETE" : "PASS"

  const hnsw = hnswDecision(p95, input.corpusChunkCount, t.latencyTargetP95Ms)

  return { checks, overallVerdict, hnsw }
}

const crossLingualRecall = (run: RunResult): { value: number; queries: number } => {
  const rows = run.rows.filter((r) => r.kind === "cross-lingual")
  if (rows.length === 0) return { value: 0, queries: 0 }
  // Slice recall@10: mean of the per-question set recall stored on the rows
  // (metrics.py semantics restricted to the cross-lingual slice).
  const value = rows.reduce((sum, r) => sum + r.recallAt10, 0) / rows.length
  return { value, queries: rows.length }
}

interface SeparabilityResult {
  separable: boolean
  inBookP5: number
  offTopicP95: number
  score: number
  scoreName: string
}

/** Mirrors promote.py: p5 of the per-query best score for in-book vs p95 for
 * off-topic. Dense score when the run has vectors, fused otherwise. */
const separability = (run: RunResult | undefined): SeparabilityResult | null => {
  if (!run) return null
  const useDense = run.metrics.inBookBestDense.n > 0 && (run.metrics.inBookBestDense.max > 0 || run.metrics.offTopicBestDense.max > 0)
  const inBook = useDense ? run.metrics.inBookBestDense : run.metrics.inBookBestFused
  const offTopic = useDense ? run.metrics.offTopicBestDense : run.metrics.offTopicBestFused
  if (inBook.n === 0 || offTopic.n === 0) return null
  const scoreName = useDense ? "bestDenseScore" : "bestFusedScore"
  return {
    separable: inBook.p5 > offTopic.p95,
    inBookP5: inBook.p5,
    offTopicP95: offTopic.p95,
    score: Math.max(0, inBook.p5 - offTopic.p95),
    scoreName,
  }
}

/** HNSW decision hint (TODO §4): approximate search is only justified when the
 * measured library-scale p95 misses the 30 ms target on the real corpus. */
export const hnswDecision = (p95Ms: number, corpusChunkCount: number, targetMs: number): HnswDecision => {
  if (corpusChunkCount < 5000) {
    return {
      p95Ms,
      targetMs,
      recommendation: "measure-on-host",
      detail: `corpus has ${corpusChunkCount} chunks — the HNSW-vs-bruteforce decision must come from the finished real-book corpus (plan §10); this run's p95 ${fmt(p95Ms)} ms is a mechanics check only`,
    }
  }
  if (p95Ms > targetMs) {
    return {
      p95Ms,
      targetMs,
      recommendation: "consider-hnsw",
      detail: `measured p95 ${fmt(p95Ms)} ms exceeds the ${targetMs} ms target at library scale — evaluate approximate search (HNSW) against its added dependency and index complexity`,
    }
  }
  return {
    p95Ms,
    targetMs,
    recommendation: "keep-bruteforce",
    detail: `measured p95 ${fmt(p95Ms)} ms is within the ${targetMs} ms target at library scale — brute-force scan is sufficient`,
  }
}
