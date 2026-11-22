// packages/learning/test/eval-harness.test.ts
//
// Full offline proof of the `tl:eval` harness (TODO.md §4 / T11):
//   - builds the 2-mini-book synthetic corpus (test/fixtures/eval) into a real
//     books.db with deterministic standin vectors
//   - runs the FULL harness (resolve → retrieve/hybrid + gate → metrics →
//     promotion gates → report files) with the standin embedder
//   - asserts the metrics are computed and finite, refusals are counted,
//     reports are written, and the §10 promotion gates are evaluated with the
//     expected deterministic verdicts (a standin run is EXPECTED to fail the
//     promotion gates — that is the gates working, not the harness failing)
//   - exercises the student-vs-teacher comparison plumbing (baseline vs
//     degraded embedder + role-labelled golden sets)
//   - keeps the legacy runEval/calibrateThresholds API compatible (rag-e2e.ts)
//   - verifies the real embedder path FAILS FAST when model files are absent
//   - runs the CLI (`bun run tl:eval`) end-to-end via process spawn
//
// No model download, no network — SKIP_LIVE_EMBED-safe by construction.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  GoldenSetError,
  calibrateThresholds,
  makeDegradedStandinEmbedder,
  makeEmbedderFromSpec,
  makeStandinEmbedder,
  parseGoldenSet,
  runEval,
  runHarness,
  standinEmbed,
  type GoldenSetFile,
  type HarnessOutput,
  type LegacyGoldenQuestion,
  type LegacyRetrievalOptions,
} from "../src/eval/index"
import { insertFixtureBooks, loadFixtureBooks } from "./fixtures/eval/build-corpus"

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "eval")
const LEARNING_DIR = join(import.meta.dir, "..")

// Gate thresholds that separate on the standin fixture (probe-verified:
// in-book dense ≥ ~0.35 or BM25 fused ≈ 0.033; off-topic dense ≤ ~0.13 and
// fused ≈ 0.0164). Production defaults (0.5/0.1) would refuse everything with
// the hash embedder — real-corpus runs calibrate instead (runEval's
// calibrateThresholds / the §7 separability check).
const FIXTURE_GATE = { minDenseScore: 0.3, minFusedScore: 0.02 }

let dir: string
let bunDb: BunDatabase
let db: {
  run: (sql: string, ...params: unknown[]) => Promise<unknown>
  all: <T>(sql: string, ...params: unknown[]) => Promise<T[]>
  get: <T>(sql: string, ...params: unknown[]) => Promise<T | undefined>
  _execRaw: (sql: string) => Promise<void>
}
let goldenSets: Array<{ file: string; set: GoldenSetFile }>

const loadSet = (file: string): GoldenSetFile =>
  parseGoldenSet(JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8")), file)

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tl-eval-harness-"))
  bunDb = new BunDatabase(join(dir, "books.db"))
  db = {
    run: (sql, ...params) => Promise.resolve().then(() => bunDb.run(sql, ...(params as never[]))),
    all: <T>(sql: string, ...params: unknown[]) =>
      Promise.resolve().then(() => {
        const q = bunDb.prepare(sql)
        const r = params.length > 0 ? q.all(...(params as never[])) : q.all()
        q.finalize()
        return r as T[]
      }),
    get: <T>(sql: string, ...params: unknown[]) =>
      Promise.resolve().then(() => {
        const q = bunDb.prepare(sql)
        const r = params.length > 0 ? q.get(...(params as never[])) : q.get()
        q.finalize()
        return r as T | undefined
      }),
    _execRaw: (sql: string) => Promise.resolve().then(() => bunDb.exec(sql)),
  }
  const chunkIds = await insertFixtureBooks(db, loadFixtureBooks(FIXTURES_DIR))
  expect(chunkIds.get("biology-basics")!.length).toBe(6)
  expect(chunkIds.get("astronomy-essentials")!.length).toBe(6)
  goldenSets = [
    { file: "golden-biology.json", set: loadSet("golden-biology.json") },
    { file: "golden-astronomy.json", set: loadSet("golden-astronomy.json") },
  ]
})

afterAll(() => {
  bunDb?.close()
  rmSync(dir, { recursive: true, force: true })
})

const runStandaloneHarness = async (): Promise<HarnessOutput> =>
  await runHarness({
    db,
    corpusLabel: join(dir, "books.db"),
    goldenSets,
    embedders: [makeStandinEmbedder()],
    gate: FIXTURE_GATE,
    writeReports: false,
    rssSampleMs: 10,
  })

// ---------------------------------------------------------------------------
// Golden-set schema + fixture integrity
// ---------------------------------------------------------------------------

describe("golden-set schema", () => {
  test("fixture golden sets parse and cover every question kind", () => {
    const kinds = new Set(goldenSets.flatMap((s) => s.set.questions.map((q) => q.kind)))
    expect(kinds.has("in-book")).toBe(true)
    expect(kinds.has("paraphrased")).toBe(true)
    expect(kinds.has("cross-lingual")).toBe(true)
    expect(kinds.has("follow-up")).toBe(true)
    expect(kinds.has("off-topic")).toBe(true)
    // 10-20 questions per book (fixture: 14 + 12)
    expect(goldenSets[0]!.set.questions.length).toBe(14)
    expect(goldenSets[1]!.set.questions.length).toBe(12)
    expect(goldenSets[0]!.set.role).toBe("teacher")
    expect(goldenSets[1]!.set.role).toBe("student")
  })

  test("rejects malformed golden sets with the file name in the error", () => {
    const base = {
      schemaVersion: 2 as const,
      name: "bad",
      questions: [
        {
          id: "q1",
          bookSlug: "biology-basics",
          query: "what is photosynthesis",
          language: "en" as const,
          kind: "in-book" as const,
        },
      ],
    }
    // in-book without any expectation
    expect(() => parseGoldenSet(structuredClone(base), "a.json")).toThrow(GoldenSetError)
    expect(() => parseGoldenSet(structuredClone(base), "a.json")).toThrow("a.json")
    // off-topic must not carry expectations
    const offTopicWithExpectation = {
      schemaVersion: 2 as const,
      name: "bad",
      questions: [
        {
          id: "q1",
          bookSlug: "biology-basics",
          query: "hamlet",
          language: "en" as const,
          kind: "off-topic" as const,
          expectedChunkIds: ["biology-basics-c0"],
        },
      ],
    }
    expect(() => parseGoldenSet(offTopicWithExpectation, "b.json")).toThrow(GoldenSetError)
    // duplicate ids
    const dup = {
      schemaVersion: 2 as const,
      name: "bad",
      questions: [
        { id: "q1", bookSlug: "biology-basics", query: "x", language: "en" as const, kind: "off-topic" as const },
        { id: "q1", bookSlug: "biology-basics", query: "y", language: "en" as const, kind: "off-topic" as const },
      ],
    }
    expect(() => parseGoldenSet(dup, "c.json")).toThrow(/duplicate question id/)
    // unknown followUpOf target
    const dangling = {
      schemaVersion: 2 as const,
      name: "bad",
      questions: [
        {
          id: "q2",
          bookSlug: "biology-basics",
          query: "explain more",
          language: "en" as const,
          kind: "follow-up" as const,
          followUpOf: "nope",
        },
      ],
    }
    expect(() => parseGoldenSet(dangling, "d.json")).toThrow(/unknown followUpOf/)
    // no book reference at all
    const noBook = {
      schemaVersion: 2 as const,
      name: "bad",
      questions: [{ id: "q3", query: "x", language: "en" as const, kind: "off-topic" as const }],
    }
    expect(() => parseGoldenSet(noBook, "e.json")).toThrow(/bookId.*bookSlug/)
  })
})

// ---------------------------------------------------------------------------
// Full harness run (standin embedder, offline)
// ---------------------------------------------------------------------------

describe("tl:eval harness (standin, offline)", () => {
  let out: HarnessOutput

  beforeAll(async () => {
    out = await runStandaloneHarness()
  })

  test("runs every golden question through the production retrieval path", () => {
    expect(out.runs.length).toBe(1)
    const run = out.runs[0]!
    expect(run.rows.length).toBe(26)
    expect(run.metrics.totalQuestions).toBe(26)
    expect(run.metrics.inBookQuestions).toBe(22)
    expect(run.metrics.offTopicQuestions).toBe(4)
    expect(run.warnings.length).toBe(0)
  })

  test("metrics are computed, finite, and match the deterministic fixture", () => {
    const m = out.runs[0]!.metrics
    const expected = 18 / 22 // every non-cross-lingual in-book question hits at fused rank 1
    // recall@k per retriever (metrics.py semantics)
    expect(m.perRetriever.fused!.recallAtK["5"]).toBeCloseTo(expected, 10)
    expect(m.perRetriever.fused!.recallAtK["10"]).toBeCloseTo(expected, 10)
    expect(m.perRetriever.dense!.recallAtK["5"]).toBeCloseTo(expected, 10)
    expect(m.perRetriever.bm25!.recallAtK["5"]).toBeCloseTo(11 / 22, 10) // only the keyword-style queries AND-match
    expect(m.mrrAt10).toBeCloseTo(expected, 10)
    expect(m.ndcgAt10).toBeCloseTo(expected, 10)
    for (const leg of ["bm25", "dense", "fused"] as const) {
      for (const value of Object.values(m.perRetriever[leg]!.recallAtK)) {
        expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  test("refusals are counted: off-topic refused, gate precision/recall correct", () => {
    const m = out.runs[0]!.metrics
    const run = out.runs[0]!
    const offTopicRows = run.rows.filter((r) => r.kind === "off-topic")
    expect(offTopicRows.length).toBe(4)
    for (const row of offTopicRows) {
      expect(row.gateDecision).toBe("refused")
      expect(row.refusalCorrect).toBe(true)
      expect(row.retrievedChunkIds.length).toBe(0)
    }
    expect(m.gateRecall).toBe(1) // refusal rate on off-topic
    expect(m.refusalRateOffTopic).toBe(1)
    // 7 refusals total = 4 off-topic (correct) + 3 cross-lingual false refusals (standin
    // has no cross-lingual transfer — the honest outcome the harness must surface)
    expect(m.gatePrecision).toBeCloseTo(4 / 7, 10)
    expect(m.falseRefusalRate).toBeCloseTo(3 / 22, 10)
  })

  test("cross-lingual questions fail honestly with the standin embedder", () => {
    const run = out.runs[0]!
    for (const row of run.rows.filter((r) => r.kind === "cross-lingual")) {
      expect(row.hitAtK).toBeUndefined()
      expect(row.recallAt10).toBe(0)
    }
  })

  test("follow-ups run through the production heuristic rewriter", () => {
    const run = out.runs[0]!
    const followUps = run.rows.filter((r) => r.kind === "follow-up")
    expect(followUps.length).toBe(2)
    for (const row of followUps) {
      expect(row.rewrittenQuery).toBeDefined()
      expect(row.rewrittenQuery).toContain("(re:")
      expect(row.hitAtK).toBe(1) // dense leg carries the content words
    }
  })

  test("latency and peak RSS are sampled", () => {
    const m = out.runs[0]!.metrics
    expect(m.peakRssBytes).toBeGreaterThan(0)
    for (const v of [m.latency.embedP50Ms, m.latency.embedP95Ms, m.latency.retrieveP50Ms, m.latency.retrieveP95Ms, m.latency.totalP50Ms, m.latency.totalP95Ms, m.latency.meanTotalMs]) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
    expect(m.latency.totalP95Ms).toBeGreaterThanOrEqual(m.latency.totalP50Ms)
    // per-question rows carry the timing split
    for (const row of out.runs[0]!.rows) {
      expect(row.embedMs).toBeGreaterThanOrEqual(0)
      expect(row.retrieveMs).toBeGreaterThan(0)
    }
  })

  test("expectation types resolve: chunk ids, section titles, and page ranges", () => {
    const run = out.runs[0]!
    const byId = new Map(run.rows.map((r) => [r.questionId, r]))
    expect(byId.get("bio-in-1")!.expectedCount).toBe(1) // expectedChunkIds
    expect(byId.get("bio-sec-1")!.expectedCount).toBe(1) // expectedSectionTitles → 1-chunk section
    expect(byId.get("bio-page-1")!.expectedCount).toBe(1) // expectedPageRange {5,5} → chunk page 5
    expect(byId.get("bio-in-1")!.ranks.fused).toBe(1)
    expect(byId.get("bio-in-1")!.ranks.bm25).toBe(1)
    expect(byId.get("bio-par-1")!.ranks.bm25).toBeUndefined() // paraphrase: BM25 AND misses
    expect(byId.get("bio-par-1")!.ranks.dense).toBe(1)
  })

  test("promotion gates are evaluated with the expected standin verdicts", () => {
    const gates = out.gates
    expect(gates.checks.length).toBe(9)
    const verdicts = Object.fromEntries(gates.checks.map((c) => [c.id, c.verdict]))
    // absolute semantics: the standin's overall recall (18/22 with cross-lingual misses)
    // cannot reach the §7 floors — the gates correctly refuse promotion
    expect(verdicts["recall_at_10"]).toBe("FAIL")
    expect(verdicts["recall_at_5"]).toBe("FAIL")
    expect(verdicts["mrr_at_10"]).toBe("FAIL")
    expect(verdicts["ndcg_at_10"]).toBe("FAIL")
    // cross-lingual slice below the 20-query sample floor: recorded, NOT counted
    expect(verdicts["cross_lingual_recall_at_10"]).toBe("SKIPPED")
    const cross = gates.checks.find((c) => c.id === "cross_lingual_recall_at_10")!
    expect(cross.detail).toContain("sample floor")
    // hash-embedder collisions put off-topic p95 above the in-book p5
    expect(verdicts["gate_separability"]).toBe("FAIL")
    expect(verdicts["false_refusal_rate"]).toBe("FAIL")
    expect(verdicts["latency_p95"]).toBe("PASS")
    expect(verdicts["peak_rss"]).toBe("PASS")
    expect(gates.overallVerdict).toBe("FAIL")
    expect(gates.hnsw.recommendation).toBe("measure-on-host")
    expect(gates.hnsw.detail).toContain("real-book corpus")
  })

  test("writes eval-report.md + eval-report.json", async () => {
    const outDir = join(dir, "reports")
    const withReports = await runHarness({
      db,
      corpusLabel: join(dir, "books.db"),
      goldenSets,
      embedders: [makeStandinEmbedder()],
      gate: FIXTURE_GATE,
      tag: "unit",
      outDir,
      rssSampleMs: 10,
    })
    expect(withReports.reportFiles).toBeDefined()
    const { json, markdown } = withReports.reportFiles!
    expect(existsSync(json)).toBe(true)
    expect(existsSync(markdown)).toBe(true)
    const parsed = JSON.parse(readFileSync(json, "utf8")) as HarnessOutput
    expect(parsed.config.tag).toBe("unit")
    expect(parsed.runs[0]!.metrics.totalQuestions).toBe(26)
    expect(parsed.gates.overallVerdict).toBe("FAIL")
    expect(parsed.environment.goldenQuestionCount).toBe(26)
    const md = readFileSync(markdown, "utf8")
    expect(md).toContain("Overall verdict: FAIL")
    expect(md).toContain("Promotion gates")
    expect(md).toContain("recall@5 (bm25 / dense / fused)")
    expect(md).toContain("HNSW decision hint")
    expect(md).toContain("bio-in-1")
  })
})

// ---------------------------------------------------------------------------
// Student-vs-teacher comparison plumbing
// ---------------------------------------------------------------------------

describe("student-vs-teacher comparison", () => {
  test("two embedders produce the encoder comparison table + ratio-mode gates", async () => {
    const out = await runHarness({
      db,
      corpusLabel: join(dir, "books.db"),
      goldenSets,
      embedders: [makeStandinEmbedder(), makeDegradedStandinEmbedder()],
      gate: FIXTURE_GATE,
      writeReports: false,
      rssSampleMs: 10,
    })
    expect(out.runs.length).toBe(2)
    expect(out.comparisons.length).toBeGreaterThanOrEqual(1)

    const encoderComparison = out.comparisons[0]!
    expect(encoderComparison.kind).toBe("embedder")
    expect(encoderComparison.baseline).toBe("standin-hash")
    const recallRow = encoderComparison.rows.find((r) => r.metric === "recall@5 (fused)")!
    expect(recallRow.ratio).toBeCloseTo(1, 10) // quantized student preserves the rankings
    // the weaker student refuses one more borderline cross-lingual question → breaches the 2pp bound
    expect(encoderComparison.falseRefusalDelta).toBeCloseTo(1 / 22, 10)
    expect(encoderComparison.falseRefusalDelta!).toBeGreaterThan(0.02)

    const verdicts = Object.fromEntries(out.gates.checks.map((c) => [c.id, c.verdict]))
    // ratio semantics (promote.py): the student keeps the teacher's ranking quality…
    expect(out.gates.checks.find((c) => c.id === "recall_at_5")!.semantics).toBe("ratio")
    expect(verdicts["recall_at_10"]).toBe("PASS")
    expect(verdicts["recall_at_5"]).toBe("PASS")
    expect(verdicts["mrr_at_10"]).toBe("PASS")
    expect(verdicts["ndcg_at_10"]).toBe("PASS")
    // …but the false-refusal increase is caught by the plan §7 bound
    expect(verdicts["false_refusal_delta"]).toBe("FAIL")
    expect(out.gates.overallVerdict).toBe("FAIL")
  })

  test("role-labelled golden sets produce the role comparison table", async () => {
    const out = await runHarness({
      db,
      corpusLabel: join(dir, "books.db"),
      goldenSets,
      embedders: [makeStandinEmbedder()],
      gate: FIXTURE_GATE,
      writeReports: false,
      rssSampleMs: 10,
    })
    const roleComparison = out.comparisons.find((c) => c.kind === "role")
    expect(roleComparison).toBeDefined()
    expect(roleComparison!.columns.map((c) => c.role).sort()).toEqual(["student", "teacher"])
    const questionsRow = roleComparison!.rows.find((r) => r.metric === "questions")!
    expect(questionsRow.values.map((v) => v.value).sort()).toEqual([12, 14])
    // teacher-role set (biology): 12 in-book questions, 10 hit (2 cross-lingual miss)
    const teacherRecall = roleComparison!.rows.find((r) => r.metric === "recall@5 (fused)")!
    expect(teacherRecall.values.find((v) => v.run === "teacher")!.value).toBeCloseTo(10 / 12, 10)
    expect(teacherRecall.values.find((v) => v.run === "student")!.value).toBeCloseTo(8 / 10, 10)
  })
})

// ---------------------------------------------------------------------------
// Pluggable embedder: fail-fast real paths + deterministic standin
// ---------------------------------------------------------------------------

describe("pluggable embedder", () => {
  test("standin embedder is deterministic and normalized", async () => {
    const embedder = makeEmbedderFromSpec("standin")
    expect(embedder.dims).toBe(1024)
    const a = await embedder.embed("photosynthesis chlorophyll")
    const b = await embedder.embed("photosynthesis chlorophyll")
    expect([...a]).toEqual([...b])
    const norm = a.reduce((s, x) => s + x * x, 0)
    expect(norm).toBeCloseTo(1, 6)
    const c = await embedder.embed("الجينات تنتقل")
    expect(c.length).toBe(1024)
  })

  test("real teacher embedder fails fast with a clear message when the model is absent", () => {
    expect(() => makeEmbedderFromSpec("real")).toThrow(/not running|not downloaded/)
    expect(() => makeEmbedderFromSpec("teacher")).toThrow(/not running|not downloaded/)
  })

  test("student embedder fails fast when no student artifact is installed", () => {
    expect(() => makeEmbedderFromSpec("student")).toThrow(/not registered|not usable|no student model/)
  })

  test("unknown embedder spec lists the supported names", () => {
    expect(() => makeEmbedderFromSpec("bogus")).toThrow(/standin.*real.*student/)
  })
})

// ---------------------------------------------------------------------------
// Legacy API compatibility (scripts/rag-e2e.ts keeps working)
// ---------------------------------------------------------------------------

describe("legacy runEval / calibrateThresholds", () => {
  const questions: LegacyGoldenQuestion[] = [
    {
      id: "l1",
      bookId: "biology-basics",
      query: "chlorophyll inside the chloroplasts absorbs sunlight",
      language: "en",
      kind: "in-book",
      expectedChunkIds: ["biology-basics-c0"],
    },
    {
      id: "l2",
      bookId: "biology-basics",
      query: "how green plants convert light into chemical energy during photosynthesis",
      language: "en",
      kind: "paraphrased",
      expectedChunkIds: ["biology-basics-c0"],
    },
    {
      id: "l3",
      bookId: "biology-basics",
      query: "hamlet denmark playwright william shakespeare",
      language: "en",
      kind: "off-topic",
      expectedChunkIds: [],
    },
  ]
  const options: LegacyRetrievalOptions = {
    bm25TopK: 10,
    denseTopK: 10,
    rrfK: 60,
    weightBm25: 1,
    weightDense: 1,
    autoWeightByLanguage: true,
    finalTopK: 5,
    parentExpansion: false,
    parentContextMaxTokens: 1000,
    queryRewrite: "off",
    rewriteTurns: 0,
    gate: {
      enabled: true,
      minDenseScore: FIXTURE_GATE.minDenseScore,
      minFusedScore: FIXTURE_GATE.minFusedScore,
      allowSmallTalk: true,
      language: "en",
      libraryAvailable: true,
    },
  }

  test("runEval computes the legacy report shape with a custom embedFn", async () => {
    const { Effect } = await import("effect")
    const result = await Effect.runPromise(
      runEval(db, questions, options, async (text) => standinEmbed(text)),
    )
    expect(result.totalQuestions).toBe(3)
    expect(result.recallAt5).toBe(1)
    expect(result.mrr).toBeCloseTo(1, 10)
    expect(result.gateRecall).toBe(1) // off-topic refused
    expect(result.gatePrecision).toBe(1) // the only refusal is the off-topic probe
    expect(result.falseRefusalRate).toBe(0)
    expect(result.passed).toBe(3)
    expect(result.results.length).toBe(3)
    expect(result.results.every((r) => r.correct)).toBe(true)
  })

  test("calibrateThresholds finds a separating threshold pair on the fixture", async () => {
    const { Effect } = await import("effect")
    const best = await Effect.runPromise(calibrateThresholds(db, questions, options, undefined, async (text) => standinEmbed(text)))
    expect(best.f1).toBeGreaterThanOrEqual(0.999)
    expect(best.minDenseScore).toBeGreaterThanOrEqual(0.1)
    expect(best.minDenseScore).toBeLessThanOrEqual(0.6)
    expect(best.minFusedScore).toBeGreaterThanOrEqual(0.01)
    expect(best.minFusedScore).toBeLessThanOrEqual(0.3)
  })
})

// ---------------------------------------------------------------------------
// CLI (`bun run tl:eval`)
// ---------------------------------------------------------------------------

describe("tl:eval CLI", () => {
  const run = (args: string[]) => {
    const result = Bun.spawnSync({
      cmd: ["bun", join("scripts", "eval-corpus.ts"), ...args],
      cwd: LEARNING_DIR,
      stdout: "pipe",
      stderr: "pipe",
    })
    return {
      code: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    }
  }

  test("--help prints the usage", () => {
    const r = run(["--help"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("Usage: bun run tl:eval")
    expect(r.stdout).toContain("--embedder")
    expect(r.stdout).toContain("--golden")
  })

  test("end-to-end run against the fixture corpus writes tagged reports", () => {
    const outDir = join(dir, "cli-reports")
    const r = run([
      "--corpus",
      dir,
      "--golden",
      join(FIXTURES_DIR, "golden-biology.json"),
      join(FIXTURES_DIR, "golden-astronomy.json"),
      "--embedder",
      "standin",
      "--tag",
      "cli",
      "--out",
      outDir,
    ])
    expect(r.stderr).toBe("")
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("overall: FAIL")
    expect(r.stdout).toContain("gate recall_at_10: FAIL")
    expect(r.stdout).toContain("gate peak_rss: PASS")
    const jsonPath = join(outDir, "eval-report-cli.json")
    const mdPath = join(outDir, "eval-report-cli.md")
    expect(existsSync(jsonPath)).toBe(true)
    expect(existsSync(mdPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as HarnessOutput
    expect(parsed.config.embedders).toEqual(["standin-hash"])
    expect(parsed.runs[0]!.rows.length).toBe(26)
  })

  test("missing golden set fails with a clear error", () => {
    const r = run(["--corpus", dir, "--golden", join(dir, "nope.json")])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain("golden set not found")
  })

  test("unknown argument fails with the usage", () => {
    const r = run(["--bogus"])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain("unknown argument")
    expect(r.stderr).toContain("Usage:")
  })
})
