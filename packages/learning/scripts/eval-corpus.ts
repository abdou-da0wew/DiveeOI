// packages/learning/scripts/eval-corpus.ts
//
// `bun run tl:eval` — offline corpus evaluation for Targeted Learning
// (TODO.md §4 / RETRIEVAL_V2_PLAN.md §10).
//
// Runs every golden question through the SAME retrieval path production uses
// (retrieve/hybrid + gate + heuristic rewrite for follow-ups) and writes
// eval-report.md + eval-report.json with per-retriever recall@k, MRR@10,
// nDCG@10, gate precision/recall, refusal + false-refusal rates, p50/p95
// latency, peak RSS, and the promotion-gate PASS/FAIL verdicts.
//
// Hardware-gated runs (fill in later on a model host):
//   bun run tl:eval --corpus <tl-data-dir> --golden golden.json --embedder real
//   bun run tl:eval --corpus <tl-data-dir> --golden golden.json --embedder real,student   # student-vs-teacher
//
// Offline mechanics check (no model needed):
//   bun run tl:eval --corpus <dir-with-books.db> --golden golden.json --embedder standin
//
// Example manifest file (JSON) instead of a directory:
//   { "booksDb": "/path/to/books.db", "settings": { "gate": { "minDenseScore": 0.5 } } }

import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { Database as BunDatabase } from "bun:sqlite"
import {
  makeEmbedderFromSpec,
  parseGoldenSet,
  runHarness,
  type EvalEmbedder,
  type GoldenSetFile,
  type HarnessOutput,
} from "../src/eval/index"
import type { BooksDbHandle } from "../src/store"

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

export interface EvalCliArgs {
  corpus?: string
  golden: string[]
  embedders: string[]
  kList: number[]
  tag?: string
  outDir?: string
  minDense?: number
  minFused?: number
  finalTopK?: number
  bm25TopK?: number
  denseTopK?: number
  noReports: boolean
  help: boolean
}

export const USAGE = `Usage: bun run tl:eval [options]

Required:
  --corpus <dir|books.db|manifest.json>
        Targeted Learning data dir containing books.db, a books.db file, or a
        JSON manifest { "booksDb": "...", "dataDir": "...", "settings": {...} }.
        Falls back to $DIVEEOI_TL_DATA_DIR when omitted.
  --golden <file.json[,file2.json...]>
        Golden-set JSON file(s) (schemaVersion 2 — see
        packages/learning/test/fixtures/eval/README.md). Repeatable.
        Sets labelled "role": "student" / "teacher" produce a comparison table.

Embedder:
  --embedder real|student|standin[,...]     (default: standin)
        real    pinned BGE-M3 teacher — fails fast when the model is absent
        student installed compact student encoder — fails fast when absent
        standin deterministic hash embedder — offline/CI mechanics checks only
        Comma list (e.g. real,student) runs each and emits the
        student-vs-teacher comparison table (plan §10).

Quality / output:
  --k 5,10            extra recall@k values (5 and 10 are always measured)
  --tag <name>        label for the report files and title
  --out <dir>         report directory (default: ./eval-reports)
  --no-reports        compute metrics without writing report files

Gate / retrieval overrides (defaults come from the Targeted Learning settings):
  --min-dense <n>     gate minDenseScore     (default 0.5)
  --min-fused <n>     gate minFusedScore     (default 0.1)
  --final-top-k <n>   production finalTopK   (default 8)
  --bm25-top-k <n>    BM25 leg top-K         (default 30)
  --dense-top-k <n>   dense leg top-K        (default 30)

Other:
  --help              this message

Exit codes: 0 gates evaluated (any verdicts), 1 usage/config error or gate
evaluation crashed. Gate PASS/FAIL itself is reported, not used as exit code.
`

export const parseEvalArgs = (argv: string[]): EvalCliArgs => {
  const args: EvalCliArgs = { golden: [], embedders: [], kList: [], noReports: false, help: false }
  const needValue = (flag: string, value: string | undefined): string => {
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${flag} requires a value\n\n${USAGE}`)
    }
    return value
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eq = arg.indexOf("=")
    const flag = eq > 0 ? arg.slice(0, eq) : arg
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined
    const next = (): string => needValue(flag.slice(2), inline ?? argv[++i])
    // List flags consume their value PLUS any following bare arguments
    // (`--golden a.json b.json` ≡ `--golden a.json,b.json` ≡ repeated flags).
    const nextList = (): string[] => {
      const values = [next()]
      if (inline === undefined) {
        while (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
          values.push(argv[++i]!)
        }
      }
      return values
    }
    switch (flag) {
      case "--corpus":
        args.corpus = next()
        break
      case "--golden":
        for (const value of nextList()) {
          for (const part of value.split(",")) {
            const f = part.trim()
            if (f) args.golden.push(f)
          }
        }
        break
      case "--embedder":
        for (const value of nextList()) {
          for (const part of value.split(",")) {
            const e = part.trim()
            if (e) args.embedders.push(e)
          }
        }
        break
      case "--k":
        for (const value of nextList()) {
          for (const part of value.split(",")) {
            const k = Number.parseInt(part.trim(), 10)
            if (Number.isFinite(k) && k > 0) args.kList.push(k)
          }
        }
        break
      case "--tag":
        args.tag = next()
        break
      case "--out":
        args.outDir = next()
        break
      case "--min-dense":
        args.minDense = Number(next())
        break
      case "--min-fused":
        args.minFused = Number(next())
        break
      case "--final-top-k":
        args.finalTopK = Number.parseInt(next(), 10)
        break
      case "--bm25-top-k":
        args.bm25TopK = Number.parseInt(next(), 10)
        break
      case "--dense-top-k":
        args.denseTopK = Number.parseInt(next(), 10)
        break
      case "--no-reports":
        args.noReports = true
        break
      case "--help":
      case "-h":
        args.help = true
        break
      default:
        throw new Error(`unknown argument "${arg}"\n\n${USAGE}`)
    }
  }
  if (args.embedders.length === 0) args.embedders.push("standin")
  return args
}

// ---------------------------------------------------------------------------
// Corpus + golden loading
// ---------------------------------------------------------------------------

export interface CorpusResolution {
  dbPath: string
  dataDir: string
  db: BooksDbHandle
  settings: Record<string, unknown>
}

const wrapBunDb = (db: BunDatabase): BooksDbHandle => ({
  run: (sql, ...params) => Promise.resolve().then(() => db.run(sql, ...(params as never[]))),
  all: <T>(sql: string, ...params: unknown[]) =>
    Promise.resolve().then(() => {
      const q = db.prepare(sql)
      const r = params.length > 0 ? q.all(...(params as never[])) : q.all()
      q.finalize()
      return r as T[]
    }),
  get: <T>(sql: string, ...params: unknown[]) =>
    Promise.resolve().then(() => {
      const q = db.prepare(sql)
      const r = params.length > 0 ? q.get(...(params as never[])) : q.get()
      q.finalize()
      return r as T | undefined
    }),
  _execRaw: (sql: string) => Promise.resolve().then(() => db.exec(sql)),
})

/** `--corpus` accepts a data dir (containing books.db), a books.db path, or a JSON manifest. */
export const resolveCorpus = (corpus: string | undefined): CorpusResolution => {
  const raw = corpus ?? process.env.DIVEEOI_TL_DATA_DIR
  if (!raw) {
    throw new Error(
      "no corpus given — pass --corpus <dir|books.db|manifest.json> or set DIVEEOI_TL_DATA_DIR\n\n" + USAGE,
    )
  }
  const p = isAbsolute(raw) ? raw : resolve(process.cwd(), raw)
  if (!existsSync(p)) {
    throw new Error(`corpus path does not exist: ${p}`)
  }

  let dbPath: string | undefined
  let dataDir: string | undefined
  let manifestSettings: Record<string, unknown> = {}

  const stat = statSync(p)
  if (stat.isDirectory()) {
    const candidate = join(p, "books.db")
    if (existsSync(candidate)) {
      dbPath = candidate
      dataDir = p
    } else {
      throw new Error(`directory ${p} has no books.db — pass the Targeted Learning data dir (contains books.db)`)
    }
  } else if (basename(p) === "books.db" || p.endsWith(".db")) {
    dbPath = p
    dataDir = dirname(p)
  } else if (p.endsWith(".json")) {
    const manifest = JSON.parse(readFileSync(p, "utf8")) as {
      booksDb?: string
      dataDir?: string
      settings?: Record<string, unknown>
    }
    const base = dirname(p)
    const dbFrom = manifest.booksDb
      ? (isAbsolute(manifest.booksDb) ? manifest.booksDb : join(base, manifest.booksDb))
      : manifest.dataDir
        ? join(isAbsolute(manifest.dataDir) ? manifest.dataDir : join(base, manifest.dataDir), "books.db")
        : undefined
    if (!dbFrom || !existsSync(dbFrom)) {
      throw new Error(`manifest ${p} must point at an existing books.db via "booksDb" or "dataDir"`)
    }
    dbPath = dbFrom
    dataDir = dirname(dbFrom)
    manifestSettings = manifest.settings ?? {}
  } else {
    throw new Error(`unsupported --corpus target: ${p} (use a dir, a books.db file, or a JSON manifest)`)
  }

  const db = new BunDatabase(dbPath, { readonly: true })
  return { dbPath, dataDir: dataDir!, db: wrapBunDb(db), settings: manifestSettings }
}

export const loadGoldenSets = (files: string[]): Array<{ file: string; set: GoldenSetFile }> => {
  if (files.length === 0) {
    throw new Error("no golden set given — pass --golden <file.json> (see test/fixtures/eval/README.md)")
  }
  return files.map((file) => {
    const p = isAbsolute(file) ? file : resolve(process.cwd(), file)
    if (!existsSync(p)) throw new Error(`golden set not found: ${p}`)
    const json = JSON.parse(readFileSync(p, "utf8")) as unknown
    return { file: p, set: parseGoldenSet(json, p) }
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export const formatSummary = (out: HarnessOutput): string => {
  const lines: string[] = []
  lines.push(`tl:eval — ${out.timestamp}${out.config.tag ? ` [${out.config.tag}]` : ""}`)
  lines.push(`corpus: ${out.config.corpus}  golden: ${out.config.goldenFiles.length} set(s), ${out.environment.goldenQuestionCount} questions`)
  for (const run of out.runs) {
    const m = run.metrics
    lines.push(
      `run ${run.embedder}: recall@5=${(m.perRetriever.fused?.recallAtK["5"] ?? 0).toFixed(3)} recall@10=${(m.perRetriever.fused?.recallAtK["10"] ?? 0).toFixed(3)} mrr@10=${m.mrrAt10.toFixed(3)} ndcg@10=${m.ndcgAt10.toFixed(3)} | gate P=${m.gatePrecision.toFixed(3)} R=${m.gateRecall.toFixed(3)} falseRefusal=${m.falseRefusalRate.toFixed(3)} | p95=${m.latency.totalP95Ms.toFixed(1)}ms rss=${(m.peakRssBytes / 1048576).toFixed(0)}MiB`,
    )
  }
  for (const c of out.gates.checks) {
    lines.push(`gate ${c.id}: ${c.verdict} (value=${Number.isFinite(c.value) ? c.value.toFixed(4) : c.value}${c.floor !== undefined ? ` floor=${c.floor}` : ""} [${c.semantics}])`)
  }
  lines.push(`overall: ${out.gates.overallVerdict} — hnsw: ${out.gates.hnsw.recommendation}`)
  if (out.reportFiles) {
    lines.push(`report: ${out.reportFiles.markdown}`)
    lines.push(`report: ${out.reportFiles.json}`)
  }
  return lines.join("\n")
}

export const main = async (argv: string[]): Promise<number> => {
  let args: EvalCliArgs
  try {
    args = parseEvalArgs(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
  if (args.help) {
    console.log(USAGE)
    return 0
  }

  try {
    const corpus = resolveCorpus(args.corpus)
    const goldenSets = loadGoldenSets(args.golden)
    const embedders: EvalEmbedder[] = args.embedders.map((spec) =>
      makeEmbedderFromSpec(spec, { dataDir: corpus.dataDir, userSettings: corpus.settings }),
    )

    const outDir = args.outDir ? (isAbsolute(args.outDir) ? args.outDir : resolve(process.cwd(), args.outDir)) : join(process.cwd(), "eval-reports")

    const output = await runHarness({
      db: corpus.db,
      corpusLabel: corpus.dbPath,
      goldenSets,
      embedders,
      kList: args.kList,
      retrieval: {
        ...(args.finalTopK !== undefined ? { finalTopK: args.finalTopK } : {}),
        ...(args.bm25TopK !== undefined ? { bm25TopK: args.bm25TopK } : {}),
        ...(args.denseTopK !== undefined ? { denseTopK: args.denseTopK } : {}),
      },
      gate: {
        ...(args.minDense !== undefined ? { minDenseScore: args.minDense } : {}),
        ...(args.minFused !== undefined ? { minFusedScore: args.minFused } : {}),
      },
      tag: args.tag,
      outDir: args.noReports ? undefined : outDir,
      rssSampleMs: 25,
    })

    console.log(formatSummary(output))
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`tl:eval failed: ${message}`)
    return 1
  }
}

if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
