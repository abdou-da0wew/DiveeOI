// Temporary benchmark for the research paper. Deleted after the run.
// Measures only real, local operations: SQLite throughput and the composer's
// routing decision on synthetic catalogs. No network calls.

import { Database } from "bun:sqlite"
import { Composer } from "./src/provider/composer"

const out: Record<string, unknown> = {}

// ── SQLite ────────────────────────────────────────────────────────────────
{
  const db = new Database(":memory:")
  db.run(`CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, body TEXT)`)
  const insert = db.prepare(`INSERT INTO t (id, n, body) VALUES (?, ?, ?)`)
  const N = 5000
  const t0 = performance.now()
  db.transaction(() => {
    for (let i = 0; i < N; i++) insert.run(`id_${i}`, i, "x".repeat(200))
  })()
  const writeMs = performance.now() - t0

  db.run(`CREATE INDEX idx_t_n ON t(n)`)
  const q = db.prepare(`SELECT * FROM t WHERE n = ?`)
  const t1 = performance.now()
  for (let i = 0; i < 2000; i++) q.get((i * 7) % N)
  const readMs = performance.now() - t1

  const scan = db.prepare(`SELECT count(*) AS c FROM t`)
  const t2 = performance.now()
  for (let i = 0; i < 500; i++) scan.get()
  const scanMs = performance.now() - t2

  out.sqlite = {
    rows: N,
    writeTotalMs: +writeMs.toFixed(1),
    writePerRowUs: +((writeMs * 1000) / N).toFixed(1),
    readPerQueryUs: +((readMs * 1000) / 2000).toFixed(1),
    scanPerQueryUs: +((scanMs * 1000) / 500).toFixed(1),
  }
  db.close()
}

// ── composer routing ──────────────────────────────────────────────────────
{
  const mkModel = (i: number) => ({
    id: `model-${i}`,
    name: ["glm-5.3-flash", "deepseek-v4-flash", "gpt-5-nano", "gemini-3-flash", "qwen3-coder"][i % 5] + `-${i}`,
    cost: { input: 0, output: 0 },
    capabilities: {
      toolcall: true,
      reasoning: i % 3 === 0,
      attachment: i % 2 === 0,
      input: { image: i % 2 === 0, pdf: i % 4 === 0 },
    },
    limit: { context: 128_000 + (i % 4) * 64_000, output: 32_000 },
    status: "active",
    api: { id: `model-${i}` },
    options: {},
    variants: {},
    providerID: "opencode",
    release_date: "2026-06-01",
  })

  const timings: Array<{ models: number; us: number }> = []
  for (const size of [25, 100, 400, 800]) {
    const providers: any = {}
    for (let p = 0; p < 8; p++) {
      const id = p === 0 ? "opencode" : `prov-${p}`
      const models: any = {}
      for (let i = 0; i < size / 8; i++) {
        const m = mkModel(p * 1000 + i)
        models[m.id] = m
      }
      providers[id] = { id, name: id, source: "custom", env: [], options: {}, models }
    }
    // warm
    for (let i = 0; i < 20; i++) Composer.select(providers)
    const t0 = performance.now()
    const R = 500
    for (let i = 0; i < R; i++) Composer.select(providers)
    timings.push({ models: size, us: +(((performance.now() - t0) * 1000) / R).toFixed(1) })
  }
  out.composer = { timings }
}

console.log(JSON.stringify(out, null, 2))
