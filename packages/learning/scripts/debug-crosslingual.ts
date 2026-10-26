// Debug: cross-lingual retrieval behavior with MiniLM (English-centric) vs
// what bge-m3 (multilingual, the shipped model) will do.
import { Effect } from "effect"
import { Database as BunDatabase } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseTxt } from "../src/parsers/index.ts"
import { chunk } from "../src/chunk/index.ts"
import { normalizeForSearch } from "../src/lang/arabic.ts"
import * as Pipeline from "../src/embed/pipeline.ts"
import { retrieve } from "../src/retrieve/hybrid.ts"
import { vectorToB64 } from "../src/self-test/index.ts"
import { SCHEMA_SQL } from "../src/store/schema.ts"

const BOOK = `
Chapter 1: Photosynthesis
Photosynthesis is the process by which green plants convert light energy into chemical energy. Plants absorb sunlight through chlorophyll in their leaves.
التمثيل الضوئي هو العملية التي تحوّل بها النباتات الخضراء طاقة الضوء إلى طاقة كيميائية. تمتص النباتات ضوء الشمس من خلال الكلوروفيل في أوراقها.
Chapter 2: The Circulatory System
The heart has four chambers: two atria and two ventricles. Arteries carry blood away from the heart.
القلب له أربع غرف: أذينان وبطينان. تحمل الشرايين الدم بعيدًا عن القلب.
`

type Row = Record<string, unknown>
const wrap = (db: BunDatabase) => ({
  run: (s: string, ...p: unknown[]) => Promise.resolve().then(() => db.run(s, ...(p as never[]))),
  all: <T>(s: string, ...p: unknown[]) =>
    Promise.resolve().then(() => {
      const q = db.prepare(s)
      const r = p.length ? q.all(...(p as never[])) : q.all()
      q.finalize()
      return r as T[]
    }),
  get: <T>(s: string, ...p: unknown[]) =>
    Promise.resolve().then(() => {
      const q = db.prepare(s)
      const r = p.length ? q.get(...(p as never[])) : q.get()
      q.finalize()
      return r as T | undefined
    }),
  _execRaw: (s: string) => Promise.resolve().then(() => db.exec(s)),
})

const run = Effect.gen(function* () {
  const t = yield* Effect.tryPromise({ try: () => import("@huggingface/transformers"), catch: () => null })
  t!.env.allowRemoteModels = true
  yield* Pipeline.init(mkdtempSync(join(tmpdir(), "m-")), { repo: "Xenova/all-MiniLM-L6-v2", revision: "main", dtype: "fp32", maxLength: 256 }, {
    dtype: "fp32", device: "auto", maxLength: 256, batchSize: 8, intraOpThreads: "auto", interOpThreads: 1,
  })
  const parsed = yield* parseTxt(BOOK)
  const chunked = yield* chunk(parsed, "b", {
    childTargetTokens: 40, childMaxTokens: 80, childOverlapTokens: 8, minChunkTokens: 8,
    parentMaxTokens: 400, prependHeadingPath: true, stripHeadersFooters: true,
  })
  const norm = chunked.chunks.map((c) => ({ ...c, textNorm: normalizeForSearch(c.text) }))
  const db = new BunDatabase(join(mkdtempSync(join(tmpdir(), "d-")), "books.db"))
  db.exec(SCHEMA_SQL)
  db.run("INSERT INTO books(id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at) VALUES('b','b','B','h','p','ready','{}',1,1)")
  db.run("INSERT INTO sections(id, book_id, level, ord, text) VALUES('s0','b',1,0,'x')")
  for (const c of norm) {
    const v = yield* Pipeline.embed(c.text)
    db.run("INSERT INTO chunks(id, book_id, section_id, ord, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?)", c.id, "b", "s0", 0, c.text, c.textNorm, c.tokenCount)
    db.run("INSERT INTO chunk_vecs(chunk_id, vec) VALUES(?,?)", c.id, vectorToB64(v))
  }
  const w = wrap(db)
  const qAr = yield* Pipeline.embed("كم عدد غرف القلب")
  const qEn = yield* Pipeline.embed("how many chambers does the heart have")
  const base = {
    bookIds: ["b"], bm25TopK: 10, denseTopK: 10, rrfK: 60, weightBm25: 1, weightDense: 1,
    autoWeightByLanguage: true, parentExpansion: false, parentContextMaxTokens: 2000,
    queryRewrite: "off" as const, rewriteTurns: 0, recentUserTurns: [] as string[],
    gate: { enabled: false, minDenseScore: 0, minFusedScore: 0, allowSmallTalk: true, language: "en" as const, libraryAvailable: true },
  }
  const heartIdx = norm.findIndex((c) => c.text.includes("four chambers"))
  const heartId = norm[heartIdx]!.id
  for (const [label, q, vec, k] of [
    ["EN k=5", "how many chambers does the heart have", qEn, 5],
    ["AR k=5", "كم عدد غرف القلب", qAr, 5],
    ["AR k=10", "كم عدد غرف القلب", qAr, 10],
    ["AR k=18", "كم عدد غرف القلب", qAr, 18],
  ] as const) {
    const r = yield* retrieve(w, { ...base, query: q, finalTopK: k }, vec)
    const pos = r.candidates.findIndex((c) => c.chunkId === heartId)
    console.log(`${label}: heart chunk rank = ${pos >= 0 ? pos + 1 : "NOT FOUND"} | top1: ${r.candidates[0]?.text.slice(0, 50).replace(/\n/g, " ")}`)
  }
  // Dense-only scores for the Arabic query against every chunk
  console.log("--- dense cosine scores for AR query ---")
  const qArVec = qAr
  const scores = norm.map((c, i) => {
    // recompute from stored vectors
    const row = db.query("SELECT vec FROM chunk_vecs WHERE chunk_id = ?").get(c.id) as { vec: string }
    const binary = atob(row.vec)
    const bytes = new Uint8Array(binary.length)
    for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j)
    const vec = new Float32Array(bytes.buffer)
    let dot = 0, na = 0, nb = 0
    for (let j = 0; j < vec.length; j++) { dot += vec[j]! * qArVec[j]!; na += vec[j]! ** 2; nb += qArVec[j]! ** 2 }
    return { id: c.id, score: dot / (Math.sqrt(na) * Math.sqrt(nb)), isHeart: c.id === heartId }
  })
  scores.sort((a, b) => b.score - a.score)
  for (const s of scores.slice(0, 5)) console.log(`  ${s.isHeart ? "★ HEART" : "       "} ${s.id}: ${s.score.toFixed(4)}`)
})
Effect.runPromise(run).then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
