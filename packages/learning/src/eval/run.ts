// packages/learning/src/eval/run.ts
//
// The tl:eval orchestrator: resolves golden sets against a books.db corpus,
// pushes every question through the SAME retrieval path production uses
// (retrieve/hybrid + gate + heuristic rewrite for follow-ups), aggregates
// metrics per embedder, evaluates the promotion gates, and writes the report.
//
// Measurement notes (documented in the report):
//   - Retrieval runs once per question with finalTopK = bm25TopK + denseTopK
//     and debug candidates so the per-retriever rankings (BM25/dense/fused)
//     can be scored independently; the gate decision is unaffected because
//     the gate consumes best dense/fused scores measured BEFORE the top-K cut
//     (RETRIEVAL_V2_PLAN.md §2.5). Answer-view correctness (hit ≤ finalTopK)
//     still uses the production finalTopK.
//   - follow-up questions receive their parent question's query as the
//     recent user turn, exactly like the session loop does, so the
//     production heuristic rewriter resolves the anaphora.
//   - peak RSS is sampled on an interval plus around every question.

import { Effect } from "effect"
import { arch, cpus, platform, totalmem } from "node:os"
import { retrieve, type RetrievalOptions } from "../retrieve/hybrid"
import type { BooksDbHandle } from "../store"
import { withDefaults } from "../settings/defaults"
import { buildCorpusIndex, resolveGoldenSets, type CorpusIndex } from "./golden"
import { aggregateRun, recallAt } from "./metrics"
import { evaluatePromotionGates } from "./gates"
import { writeReportFiles } from "./report"
import type {
  ComparisonTable,
  ComparisonRow,
  EvalEmbedder,
  GoldenSetFile,
  GoldenSetRole,
  QuestionRow,
  ResolvedQuestion,
  RunResult,
  HarnessOutput,
  GateReport,
} from "./types"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface HarnessConfig {
  db: BooksDbHandle
  /** Shown in the report (path of books.db / data dir). */
  corpusLabel: string
  goldenSets: Array<{ file: string; set: GoldenSetFile }>
  embedders: EvalEmbedder[]
  /** Extra k values for recall@k. 5 and 10 are always measured (promotion gates). */
  kList?: number[]
  /** Production retrieval knobs (defaults come from settings/defaults.ts). */
  retrieval?: Partial<Pick<RetrievalOptions, "bm25TopK" | "denseTopK" | "rrfK" | "weightBm25" | "weightDense" | "finalTopK">>
  /** Gate thresholds (defaults from settings/defaults.ts: 0.5 / 0.1). */
  gate?: { minDenseScore?: number; minFusedScore?: number; enabled?: boolean }
  tag?: string
  outDir?: string
  /** Write eval-report.md/.json (default: true when outDir is set). */
  writeReports?: boolean
  rssSampleMs?: number
}

interface ResolvedRetrieval {
  options: Omit<RetrievalOptions, "bookIds" | "query">
  measureFinalTopK: number
  productionFinalTopK: number
}

const resolveRetrievalOptions = (cfg: HarnessConfig): ResolvedRetrieval => {
  const d = withDefaults(undefined)
  const r = (d.retrieval ?? {}) as Record<string, unknown>
  const g = (d.gate ?? {}) as Record<string, unknown>
  const bm25TopK = Number(cfg.retrieval?.bm25TopK ?? r.bm25TopK ?? 30)
  const denseTopK = Number(cfg.retrieval?.denseTopK ?? r.denseTopK ?? 30)
  const productionFinalTopK = Number(cfg.retrieval?.finalTopK ?? r.finalTopK ?? 8)
  // Measurement needs the union of both legs so each retriever can be ranked
  // independently (see file header).
  const measureFinalTopK = Math.max(productionFinalTopK, bm25TopK + denseTopK)
  const options: Omit<RetrievalOptions, "bookIds" | "query"> = {
    bm25TopK,
    denseTopK,
    rrfK: Number(cfg.retrieval?.rrfK ?? r.rrfK ?? 60),
    weightBm25: Number(cfg.retrieval?.weightBm25 ?? r.weightBm25 ?? 1.0),
    weightDense: Number(cfg.retrieval?.weightDense ?? r.weightDense ?? 1.0),
    autoWeightByLanguage: true,
    finalTopK: measureFinalTopK,
    parentExpansion: false, // rankings are over chunks; parents add tokens, not hits
    parentContextMaxTokens: Number(r.parentContextMaxTokens ?? 2500),
    queryRewrite: "heuristic",
    rewriteTurns: Number(r.rewriteTurns ?? 2),
    recentUserTurns: [],
    // The measurement pass needs the pre-gate candidate union (bm25TopK + denseTopK)
    // to score each retriever's ranking independently; the gate decision itself is
    // computed before the top-K cut, so debug candidates never change it.
    debug: true,
    gate: {
      enabled: cfg.gate?.enabled ?? true,
      minDenseScore: Number(cfg.gate?.minDenseScore ?? g.minDenseScore ?? 0.5),
      minFusedScore: Number(cfg.gate?.minFusedScore ?? g.minFusedScore ?? 0.1),
      allowSmallTalk: true,
      language: "auto",
      libraryAvailable: true,
    },
  }
  return { options, measureFinalTopK, productionFinalTopK }
}

// ---------------------------------------------------------------------------
// RSS sampling
// ---------------------------------------------------------------------------

interface RssSampler {
  readonly peakBytes: number
  sample: () => void
  stop: () => void
}

const startRssSampler = (intervalMs: number): RssSampler => {
  const state = { peakBytes: process.memoryUsage().rss }
  const sample = (): void => {
    const rss = process.memoryUsage().rss
    if (rss > state.peakBytes) state.peakBytes = rss
  }
  const timer = setInterval(sample, Math.max(5, intervalMs))
  timer.unref?.()
  return {
    get peakBytes() {
      return state.peakBytes
    },
    sample,
    stop: () => clearInterval(timer),
  }
}

// ---------------------------------------------------------------------------
// Question execution
// ---------------------------------------------------------------------------

export interface HarnessRunArtifacts {
  run: RunResult
  rankings: Map<string, { bm25?: string[]; dense?: string[]; fused: string[] }>
  relevantSets: Map<string, Set<string>>
  questions: ResolvedQuestion[]
}

const relevantSetFor = (q: ResolvedQuestion, index: CorpusIndex): Set<string> => {
  const relevant = new Set<string>(q.expectedChunkIds)
  const chunks = index.chunksByBook.get(q.bookId) ?? []
  for (const c of chunks) {
    if (q.expectedSectionIds.has(c.sectionId)) {
      relevant.add(c.id)
      continue
    }
    if (q.expectedPageRange && c.page !== undefined && c.page >= q.expectedPageRange.start && c.page <= q.expectedPageRange.end) {
      relevant.add(c.id)
    }
  }
  return relevant
}

const runQuestions = async (
  db: BooksDbHandle,
  questions: ResolvedQuestion[],
  embedder: EvalEmbedder,
  resolved: ResolvedRetrieval,
  index: CorpusIndex,
  kList: number[],
  rssSampleMs: number,
): Promise<HarnessRunArtifacts> => {
  const sampler = startRssSampler(rssSampleMs)
  const rows: QuestionRow[] = []
  const rankings = new Map<string, { bm25?: string[]; dense?: string[]; fused: string[] }>()
  const relevantSets = new Map<string, Set<string>>()
  const byId = new Map(questions.map((q) => [q.id, q]))

  try {
    for (const q of questions) {
      const parent = q.followUpOf ? byId.get(q.followUpOf) : undefined
      const recentUserTurns = parent ? [parent.query] : []

      const t0 = performance.now()
      let vec: Float32Array | null = null
      let embedFailed = false
      try {
        vec = await embedder.embed(q.query)
      } catch {
        vec = null
        embedFailed = true
      }
      const embedMs = performance.now() - t0
      sampler.sample()

      const t1 = performance.now()
      const result = await Effect.runPromise(
        retrieve(
          db,
          { ...resolved.options, bookIds: [q.bookId], query: q.query, recentUserTurns },
          vec,
        ),
      )
      const retrieveMs = performance.now() - t1
      sampler.sample()

      const ungated = result.ungatedCandidates ?? []
      const fusedRanking = [...ungated].sort((a, b) => b.fusedScore - a.fusedScore).map((c) => c.chunkId)
      const bm25Ranking = ungated
        .filter((c) => c.bm25Score !== undefined)
        .sort((a, b) => (b.bm25Score ?? 0) - (a.bm25Score ?? 0))
        .map((c) => c.chunkId)
      const denseRanking = ungated
        .filter((c) => c.denseScore !== undefined)
        .sort((a, b) => (b.denseScore ?? 0) - (a.denseScore ?? 0))
        .map((c) => c.chunkId)
      rankings.set(q.id, { bm25: bm25Ranking, dense: denseRanking, fused: fusedRanking })
      const relevant = relevantSetFor(q, index)
      relevantSets.set(q.id, relevant)

      const firstRank = (ranked: string[]): number | undefined => {
        for (let i = 0; i < ranked.length; i++) {
          if (relevant.has(ranked[i]!)) return i + 1
        }
        return undefined
      }
      const hitAtK = firstRank(fusedRanking)
      const isOffTopic = q.kind === "off-topic"
      const rowRecall10 = recallAt(fusedRanking, relevant, 10)

      const refusalCorrect = isOffTopic ? result.gateDecision === "refused" : result.gateDecision !== "refused"
      const retrievalCorrect = isOffTopic ? true : hitAtK !== undefined && hitAtK <= resolved.productionFinalTopK
      const correct = refusalCorrect && retrievalCorrect

      const warnings = [...q.unresolved]
      if (embedFailed) warnings.push("query embedding failed — dense leg ran vectorless (BM25-only)")

      rows.push({
        questionId: q.id,
        bookId: q.bookId,
        kind: q.kind,
        language: q.language,
        role: q.role,
        query: q.query,
        gateDecision: result.gateDecision,
        bestDenseScore: result.bestDenseScore ?? 0,
        bestFusedScore: result.bestFusedScore ?? 0,
        hitAtK,
        recallAt10: rowRecall10,
        mrr: hitAtK === undefined ? 0 : 1 / hitAtK,
        ranks: { bm25: firstRank(bm25Ranking), dense: firstRank(denseRanking), fused: hitAtK },
        retrievedChunkIds: result.candidates.map((c) => c.chunkId),
        expectedCount: relevant.size,
        correct,
        refusalCorrect,
        embedMs,
        retrieveMs,
        rewrittenQuery: result.rewrittenQuery,
        warnings,
      })
    }
  } finally {
    sampler.stop()
  }

  const metrics = aggregateRun({ rows, rankings, relevantSets, kList, peakRssBytes: sampler.peakBytes })

  return {
    run: {
      embedder: embedder.name,
      embedderKind: embedder.kind,
      goldenSets: [],
      metrics,
      rows,
      warnings: [],
    },
    rankings,
    relevantSets,
    questions,
  }
}

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

const compareRuns = (baseline: RunResult, student: RunResult, kList: number[]): ComparisonTable => {
  const rows: ComparisonRow[] = []
  const push = (metric: string, base: number, stud: number, asRatio = true): void => {
    const row: ComparisonRow = {
      metric,
      values: [
        { run: baseline.embedder, value: base },
        { run: student.embedder, value: stud },
      ],
    }
    if (asRatio) row.ratio = base > 0 ? stud / base : undefined
    rows.push(row)
  }
  for (const k of kList) {
    const key = String(k)
    push(
      `recall@${k} (fused)`,
      baseline.metrics.perRetriever.fused?.recallAtK[key] ?? 0,
      student.metrics.perRetriever.fused?.recallAtK[key] ?? 0,
    )
  }
  push("MRR@10 (fused)", baseline.metrics.mrrAt10, student.metrics.mrrAt10)
  push("nDCG@10 (fused)", baseline.metrics.ndcgAt10, student.metrics.ndcgAt10)
  push("gate precision", baseline.metrics.gatePrecision, student.metrics.gatePrecision, false)
  push("gate recall (off-topic refusal rate)", baseline.metrics.gateRecall, student.metrics.gateRecall, false)
  push("false-refusal rate", baseline.metrics.falseRefusalRate, student.metrics.falseRefusalRate, false)
  push("latency p50 (ms)", baseline.metrics.latency.totalP50Ms, student.metrics.latency.totalP50Ms, false)
  push("latency p95 (ms)", baseline.metrics.latency.totalP95Ms, student.metrics.latency.totalP95Ms, false)
  push("peak RSS (MiB)", baseline.metrics.peakRssBytes / 1048576, student.metrics.peakRssBytes / 1048576, false)
  return {
    kind: "embedder",
    baseline: baseline.embedder,
    columns: [
      { run: baseline.embedder, role: baseline.role },
      { run: student.embedder, role: student.role },
    ],
    rows,
    falseRefusalDelta: student.metrics.falseRefusalRate - baseline.metrics.falseRefusalRate,
  }
}

const compareRoles = (roles: Array<{ role: GoldenSetRole; run: RunResult }>): ComparisonTable => {
  const columns = roles.map((r) => ({ run: r.role, role: r.role }))
  const rows: ComparisonRow[] = []
  const metricsToCompare: Array<[string, (m: RunResult["metrics"]) => number]> = [
    ["recall@5 (fused)", (m) => m.perRetriever.fused?.recallAtK["5"] ?? 0],
    ["recall@10 (fused)", (m) => m.perRetriever.fused?.recallAtK["10"] ?? 0],
    ["MRR@10 (fused)", (m) => m.mrrAt10],
    ["nDCG@10 (fused)", (m) => m.ndcgAt10],
    ["gate precision", (m) => m.gatePrecision],
    ["gate recall (off-topic refusal rate)", (m) => m.gateRecall],
    ["false-refusal rate", (m) => m.falseRefusalRate],
    ["questions", (m) => m.totalQuestions],
  ]
  for (const [label, pick] of metricsToCompare) {
    rows.push({
      metric: label,
      values: roles.map((r) => ({ run: r.role, value: pick(r.run.metrics) })),
    })
  }
  const teacher = roles.find((r) => r.role === "teacher")
  const student = roles.find((r) => r.role === "student")
  const falseRefusalDelta =
    teacher && student ? student.run.metrics.falseRefusalRate - teacher.run.metrics.falseRefusalRate : undefined
  return {
    kind: "role",
    baseline: teacher?.role ?? columns[0]?.run ?? "",
    columns,
    rows,
    falseRefusalDelta,
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export const runHarness = async (cfg: HarnessConfig): Promise<HarnessOutput> => {
  if (cfg.embedders.length === 0) throw new Error("runHarness needs at least one embedder")
  const kList = [...new Set([...(cfg.kList ?? []), 5, 10])].sort((a, b) => a - b)
  const resolved = resolveRetrievalOptions(cfg)
  const index = await buildCorpusIndex(cfg.db)
  const resolvedSets = await resolveGoldenSets(cfg.goldenSets, index)
  const warnings: string[] = []
  for (const s of resolvedSets) warnings.push(...s.warnings)

  const questions = resolvedSets.flatMap((s) => s.questions)
  if (questions.length === 0) {
    throw new Error("no golden questions resolved against the corpus — check bookSlug/bookId values and the corpus path")
  }

  const runs: RunResult[] = []
  const artifactsByEmbedder: HarnessRunArtifacts[] = []
  for (const embedder of cfg.embedders) {
    const artifacts = await runQuestions(
      cfg.db,
      questions,
      embedder,
      resolved,
      index,
      kList,
      cfg.rssSampleMs ?? 25,
    )
    artifacts.run.goldenSets = resolvedSets.map((s) => s.name || s.file)
    artifacts.run.warnings = warnings
    artifactsByEmbedder.push(artifacts)
    runs.push(artifacts.run)
  }

  const comparisons: ComparisonTable[] = []
  if (runs.length >= 2) {
    comparisons.push(compareRuns(runs[0]!, runs[runs.length - 1]!, kList))
  }
  const rolesSeen = [...new Set(questions.map((q) => q.role).filter((r): r is "student" | "teacher" => r !== undefined))]
  if (rolesSeen.length >= 2) {
    const roleRuns = rolesSeen.map((role) => ({
      role,
      run: aggregateRoleRun(artifactsByEmbedder[0]!, role, kList),
    }))
    comparisons.push(compareRoles(roleRuns))
  }

  const corpusChunkCount = [...index.chunksByBook.values()].reduce((sum, list) => sum + list.length, 0)
  const gates: GateReport = evaluatePromotionGates({ runs, kList, corpusChunkCount })

  const output: HarnessOutput = {
    timestamp: new Date().toISOString(),
    config: {
      corpus: cfg.corpusLabel,
      goldenFiles: cfg.goldenSets.map((s) => s.file),
      embedders: cfg.embedders.map((e) => e.name),
      kList,
      retrieval: {
        bm25TopK: resolved.options.bm25TopK,
        denseTopK: resolved.options.denseTopK,
        rrfK: resolved.options.rrfK,
        weightBm25: resolved.options.weightBm25,
        weightDense: resolved.options.weightDense,
        finalTopKProduction: resolved.productionFinalTopK,
        finalTopKMeasurement: resolved.measureFinalTopK,
      },
      gate: { ...resolved.options.gate },
      tag: cfg.tag,
    },
    environment: {
      bun: typeof Bun !== "undefined" ? Bun.version : "unknown",
      platform: platform(),
      arch: arch(),
      cpus: cpus().length,
      totalMemBytes: totalmem(),
      corpusChunkCount,
      corpusBookCount: index.booksById.size,
      goldenQuestionCount: questions.length,
    },
    runs,
    comparisons,
    gates,
  }

  if (cfg.outDir && (cfg.writeReports ?? true)) {
    output.reportFiles = writeReportFiles(output, cfg.outDir, cfg.tag)
  }
  return output
}

/** Aggregates a role subset from a full run without re-running retrieval. */
const aggregateRoleRun = (artifacts: HarnessRunArtifacts, role: GoldenSetRole, kList: number[]): RunResult => {
  const questionIds = new Set(artifacts.questions.filter((q) => q.role === role).map((q) => q.id))
  const rows = artifacts.run.rows.filter((r) => questionIds.has(r.questionId))
  const rankings = new Map([...artifacts.rankings].filter(([id]) => questionIds.has(id)))
  const relevantSets = new Map([...artifacts.relevantSets].filter(([id]) => questionIds.has(id)))
  const metrics = aggregateRun({ rows, rankings, relevantSets, kList, peakRssBytes: artifacts.run.metrics.peakRssBytes })
  return { ...artifacts.run, role, metrics, rows }
}
