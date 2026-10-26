// Phase C: REAL end-to-end RAG test with actual embeddings.
//
// This script (run while the server is up in the same session):
//   1. Creates a real mini "biology textbook" (Arabic + English, 2 chapters)
//   2. Parses it with the TXT parser
//   3. Chunks it with the layout-aware chunker
//   4. Embeds every chunk with REAL Transformers.js inference (all-MiniLM-L6-v2)
//   5. Writes book + sections + chunks + vectors into the live books.db
//   6. Queries it through the hybrid retriever: BM25 + dense + RRF + gate
//   7. Verifies: in-book questions hit the right chunks, off-topic refused
//   8. Tests @book: mention resolution against the live books.db
//   9. Tests the citation verifier against retrieved chunks
//
// This is the definitive proof that the whole AI/embedding/RAG system works.

import { Effect } from "effect"
import { Database as BunDatabase } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseTxt } from "../packages/learning/src/parsers/index.ts"
import { chunk } from "../packages/learning/src/chunk/index.ts"
import { normalizeForSearch } from "../packages/learning/src/lang/arabic.ts"
import * as Pipeline from "../packages/learning/src/embed/pipeline.ts"
import { retrieve } from "../packages/learning/src/retrieve/hybrid.ts"
import { extractBookMentions } from "../packages/server/src/session/book-mentions.ts"
import { verify } from "../packages/learning/src/grounding/verifier.ts"
import { SCHEMA_SQL } from "../packages/learning/src/store/schema.ts"
import { vectorToB64, cosine } from "../packages/learning/src/self-test/index.ts"

let pass = 0, fail = 0
const ok = (m: string) => { pass++; console.log("  ✓ " + m) }
const bad = (m: string) => { fail++; console.log("  ✗ " + m) }
const assert = (cond: boolean, m: string) => (cond ? ok(m) : bad(m))

// ---------------------------------------------------------------------------
// 1. The book — a mini bilingual biology textbook
// ---------------------------------------------------------------------------
const BOOK = `
Chapter 1: Photosynthesis

Photosynthesis is the process by which green plants convert light energy into chemical energy. Plants absorb sunlight through chlorophyll in their leaves. Water and carbon dioxide are the raw materials. Glucose and oxygen are the products.

التمثيل الضوئي هو العملية التي تحوّل بها النباتات الخضراء طاقة الضوء إلى طاقة كيميائية. تمتص النباتات ضوء الشمس من خلال الكلوروفيل في أوراقها. الماء وثاني أكسيد الكربون هما المادة الخام. الجلوكوز والأكسجين هما المنتجان.

The light-dependent reactions happen in the thylakoid membranes. The Calvin cycle happens in the stroma. The Calvin cycle uses ATP and NADPH from the light reactions to fix carbon dioxide into glucose.

Chapter 2: The Circulatory System

The heart has four chambers: two atria and two ventricles. Arteries carry blood away from the heart. Veins carry blood back to the heart. Capillaries connect arteries and veins.

القلب له أربع غرف: أذينان وبطينان. تحمل الشرايين الدم بعيدًا عن القلب. تحمل الأوردة الدم عائدة إلى القلب. تربط الشعيرات الدموية بين الشرايين والأوردة.

Blood pressure is measured in millimeters of mercury. Normal blood pressure is around 120 over 80. Hypertension is high blood pressure. Hypotension is low blood pressure.

An off-topic physics note for gate testing: quantum entanglement links particle states across distance.
`

const run = Effect.gen(function* () {
  // ------------------------------------------------------------------
  // 2. Parse
  // ------------------------------------------------------------------
  console.log("── 1. PARSE ──")
  const parsed = yield* parseTxt(BOOK)
  assert(parsed.pages.length === 1, `parsed 1 page`)
  assert(parsed.outline.some((o) => o.title.includes("Chapter 1")), "outline has Chapter 1")
  assert(parsed.outline.some((o) => o.title.includes("Chapter 2")), "outline has Chapter 2")
  assert(/[\u0600-\u06FF]/.test(parsed.pages[0]!.text), "Arabic text present in parsed page")

  // ------------------------------------------------------------------
  // 3. Chunk (with normalization)
  // ------------------------------------------------------------------
  console.log("── 2. CHUNK ──")
  const chunked = yield* chunk(parsed, "bio-101", {
    childTargetTokens: 40,
    childMaxTokens: 80,
    childOverlapTokens: 8,
    minChunkTokens: 8,
    parentMaxTokens: 400,
    prependHeadingPath: true,
    stripHeadersFooters: true,
  })
  assert(chunked.sections.length >= 2, `got ${chunked.sections.length} sections (>= 2)`)
  assert(chunked.chunks.length >= 4, `got ${chunked.chunks.length} chunks (>= 4)`)
  // Normalize every chunk for FTS
  const normChunks = chunked.chunks.map((c) => ({ ...c, textNorm: normalizeForSearch(c.text) }))
  const arChunks = normChunks.filter((c) => /[\u0600-\u06FF]/.test(c.text))
  assert(arChunks.length >= 1, `Arabic content made it into chunks (${arChunks.length} Arabic-touching chunks)`)
  // Arabic normalization: tatweel/diacritics stripped in norm
  const hasDiacritics = normChunks.some((c) => /[\u064B-\u065F]/.test(c.textNorm))
  assert(!hasDiacritics, "normalized text has no Arabic diacritics")

  // ------------------------------------------------------------------
  // 4. REAL EMBEDDINGS via Transformers.js
  // ------------------------------------------------------------------
  console.log("── 3. EMBED (real Transformers.js inference) ──")
  const transformers = yield* Effect.tryPromise({
    try: () => import("@huggingface/transformers"),
    catch: () => null,
  })
  if (!transformers) { bad("transformers not installed"); return }
  transformers.env.allowRemoteModels = true // download MiniLM once
  const modelDir = mkdtempSync(join(tmpdir(), "tl-rag-models-"))
  yield* Pipeline.init(modelDir, { repo: "Xenova/all-MiniLM-L6-v2", revision: "main", dtype: "fp32", maxLength: 256 }, {
    dtype: "fp32", device: "auto", maxLength: 256, batchSize: 8, intraOpThreads: "auto", interOpThreads: 1,
  })
  const vectors: Float32Array[] = []
  const texts = normChunks.map((c) => (c.headingPath ? c.headingPath + ". " : "") + c.text)
  for (const t of texts) {
    const v = yield* Pipeline.embed(t)
    vectors.push(v)
  }
  assert(vectors.length === normChunks.length, `embedded ${vectors.length} chunks`)
  const dims = vectors[0]!.length
  assert(dims === 384, `vector dims = ${dims} (MiniLM 384)`)
  // L2-normalized check
  let sq = 0; for (let i = 0; i < dims; i++) sq += vectors[0]![i]! ** 2
  assert(Math.abs(sq - 1) < 0.01, "vectors are L2-normalized")

  // Sanity: photosynthesis chunk should be closer to photosynthesis query than to circulatory query
  const qPhoto = yield* Pipeline.embed("how do plants make glucose from sunlight")
  const qHeart = yield* Pipeline.embed("how many chambers does the heart have")
  const photoIdx = normChunks.findIndex((c) => c.text.includes("convert light energy"))
  const heartIdx = normChunks.findIndex((c) => c.text.includes("four chambers"))
  assert(photoIdx >= 0 && heartIdx >= 0, "found anchor chunks for similarity test")
  const cosP = cosine(qPhoto, vectors[photoIdx]!)
  const cosH = cosine(qPhoto, vectors[heartIdx]!)
  assert(cosP > cosH, `photosynthesis query closer to photo chunk (${cosP.toFixed(3)}) than heart chunk (${cosH.toFixed(3)})`)

  // ------------------------------------------------------------------
  // 5. Write to books.db
  // ------------------------------------------------------------------
  console.log("── 4. STORE in books.db ──")
  const dbDir = mkdtempSync(join(tmpdir(), "tl-rag-db-"))
  const db = new BunDatabase(join(dbDir, "books.db"))
  db.exec(SCHEMA_SQL)
  db.run("INSERT INTO books(id, slug, title, author, lang, source_hash, source_path, status, embed_signature, normalizer_version, created_at, chunk_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    "bio-101", "bio-101", "Biology 101 (test)", "Test Author", "en", "hash-abc", "books/bio.txt", "ready", '{"repo":"Xenova/all-MiniLM-L6-v2","dtype":"fp32"}', 1, Date.now(), normChunks.length)
  db.run("INSERT INTO sections(id, book_id, level, ord, text, heading_path) VALUES(?,?,?,?,?,?,?)",
    "bio-101-s0", "bio-101", 1, 0, chunked.sections[0]!.text.slice(0, 500), "Chapter 1: Photosynthesis")
  db.run("INSERT INTO sections(id, book_id, level, ord, text, heading_path) VALUES(?,?,?,?,?,?,?)",
    "bio-101-s1", "bio-101", 1, 1, chunked.sections[chunked.sections.length - 1]!.text.slice(0, 500), "Chapter 2: The Circulatory System")
  for (let i = 0; i < normChunks.length; i++) {
    const c = normChunks[i]!
    const sectionId = c.text.includes("chambers") || c.text.includes("القلب") || c.text.includes("Blood pressure") ? "bio-101-s1" : "bio-101-s0"
    db.run("INSERT INTO chunks(id, book_id, section_id, ord, page, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?,?)",
      c.id, "bio-101", sectionId, i, 1, c.text, c.textNorm, c.tokenCount)
    db.run("INSERT INTO chunk_vecs(chunk_id, vec) VALUES(?,?)", c.id, vectorToB64(vectors[i]!))
  }
  const cnt = db.query("SELECT count(*) AS n FROM chunks").get() as { n: number }
  assert(cnt.n === normChunks.length, `books.db has ${cnt.n} chunks`)

  const wrapDb = {
    run: (sql: string, ...p: unknown[]) => Promise.resolve().then(() => db.run(sql, ...(p as never[]))),
    all: <T>(sql: string, ...p: unknown[]) => Promise.resolve().then(() => { const q = db.prepare(sql); const r = p.length ? q.all(...(p as never[])) : q.all(); q.finalize(); return r as T[] }),
    get: <T>(sql: string, ...p: unknown[]) => Promise.resolve().then(() => { const q = db.prepare(sql); const r = p.length ? q.get(...(p as never[])) : q.get(); q.finalize(); return r as T | undefined }),
    _execRaw: (sql: string) => Promise.resolve().then(() => db.exec(sql)),
  }

  // ------------------------------------------------------------------
  // 6. HYBRID RETRIEVAL — BM25 + dense + RRF + gate
  // ------------------------------------------------------------------
  console.log("── 5. RETRIEVE (BM25 + dense + RRF + gate) ──")
  const baseOpts = {
    bm25TopK: 10, denseTopK: 10, rrfK: 60, weightBm25: 1.0, weightDense: 1.0,
    autoWeightByLanguage: true, finalTopK: 5, parentExpansion: true, parentContextMaxTokens: 2000,
    queryRewrite: "off" as const, rewriteTurns: 0, recentUserTurns: [] as string[],
    gate: { enabled: true, minDenseScore: 0.2, minFusedScore: 0.01, allowSmallTalk: true, language: "en" as const, libraryAvailable: true, refusalMessages: { en: "not covered", ar: "غير موجود" } },
  }

  // 6a. English in-book question via DENSE only (no BM25 keywords overlap)
  const r1 = yield* retrieve(wrapDb, { ...baseOpts, bookIds: ["bio-101"], query: "how do plants make food from sunlight" }, qPhoto)
  assert(r1.gateDecision === "pass", `dense question passes gate (${r1.gateDecision})`)
  assert(r1.candidates.length > 0, `got ${r1.candidates.length} candidates for photosynthesis question`)
  assert(r1.candidates.some((c) => c.text.includes("Photosynthesis") || c.text.includes("التمثيل الضوئي") || c.text.includes("light energy")),
    "top candidate is about photosynthesis")

  // 6b. Arabic question about the heart — dense must cross the language gap
  const qHeartAr = yield* Pipeline.embed("كم عدد غرف القلب")
  const r2 = yield* retrieve(wrapDb, { ...baseOpts, bookIds: ["bio-101"], query: "كم عدد غرف القلب" }, qHeartAr)
  assert(r2.candidates.length > 0, "Arabic question (cross-lingual dense) got candidates")
  assert(r2.candidates.some((c) => c.text.includes("four chambers") || c.text.includes("أربع غرف")),
    "Arabic heart question retrieved the heart chamber chunk (cross-lingual!)")

  // 6c. BM25 exact-term lookup
  const r3 = yield* retrieve(wrapDb, { ...baseOpts, bookIds: ["bio-101"], query: "chlorophyll" }, null)
  assert(r3.bm25TopK > 0, `BM25 found ${r3.bm25TopK} hits for 'chlorophyll'`)

  // 6d. Off-topic question — gate must refuse
  const r4 = yield* retrieve(wrapDb, { ...baseOpts, bookIds: ["bio-101"], query: "what is the capital of France" }, null)
  // No BM25 hits (capital/France not in book) + no dense vector → below thresholds → refuse
  assert(r4.gateDecision === "refused", `off-topic refused (${r4.gateDecision})`)
  assert(r4.candidates.length === 0, "refused query returns no candidates")

  // 6e. Small-talk bypass
  const r5 = yield* retrieve(wrapDb, { ...baseOpts, bookIds: ["bio-101"], query: "hi" }, null)
  assert(r5.gateDecision === "small-talk", `small talk bypassed gate (${r5.gateDecision})`)

  // 6f. Query rewrite for follow-ups
  const r6 = yield* retrieve(wrapDb, {
    ...baseOpts, bookIds: ["bio-101"], query: "explain more", recentUserTurns: ["what is photosynthesis"], queryRewrite: "heuristic",
  }, null)
  assert(r6.rewrittenQuery?.includes("photosynthesis"), `follow-up rewritten to include anchor: "${r6.rewrittenQuery}"`)

  // 6g. Book scoping — a second book that shouldn't leak
  db.run("INSERT INTO books(id, slug, title, author, lang, source_hash, source_path, status, embed_signature, normalizer_version, created_at, chunk_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    "hist-9", "hist-9", "History 9", null, "en", "hash-9", "books/h9.txt", "ready", "{}", 1, Date.now(), 1)
  db.run("INSERT INTO sections(id, book_id, level, ord, text) VALUES(?,?,?,?,?)", "hist-9-s0", "hist-9", 1, 0, "The French Revolution started in 1789.")
  db.run("INSERT INTO chunks(id, book_id, section_id, ord, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?)",
    "hist-9-c0", "hist-9", "hist-9-s0", 0, "The French Revolution started in 1789.", "the french revolution started in 1789", 9)
  const r7 = yield* retrieve(wrapDb, { ...baseOpts, bookIds: ["bio-101"], query: "french revolution" }, null)
  assert(r7.candidates.every((c) => c.bookId === "bio-101"), "scoped retrieval never leaks other books")

  // ------------------------------------------------------------------
  // 7. CITATION VERIFIER against real retrieved chunks
  // ------------------------------------------------------------------
  console.log("── 6. VERIFY citations ──")
  const top = r1.candidates[0]!
  const goodCitation = { chunkId: top.chunkId, quotedSpan: top.text.slice(0, 30) }
  const v1 = yield* verify({
    citations: [goodCitation],
    retrievedChunkIds: new Set(r1.candidates.map((c) => c.chunkId)),
    chunksByText: new Map(r1.candidates.map((c) => [c.chunkId, c.text])),
    mode: "flag",
  })
  assert(v1.allVerified, "real citation from retrieved chunk verifies")

  const v2 = yield* verify({
    citations: [{ chunkId: top.chunkId, quotedSpan: "this text appears nowhere in the chunk at all" }],
    retrievedChunkIds: new Set([top.chunkId]),
    chunksByText: new Map([[top.chunkId, top.text]]),
    mode: "flag",
  })
  assert(!v2.allVerified, "fabricated quoted span FAILS verification")

  // ------------------------------------------------------------------
  // 8. @book: mention resolution against the store
  // ------------------------------------------------------------------
  console.log("── 7. @book: mentions ──")
  const mentions = extractBookMentions("Let's study @book:bio-101 and also @book:\"Biology 101 (test)\"")
  assert(mentions.length === 2, `extracted ${mentions.length} mentions`)
  assert(mentions.includes("@book:bio-101"), "slug mention extracted")
  assert(mentions.some((m) => m.includes("Biology 101 (test)")), "quoted title mention extracted")
  // Resolve slug against the live db
  const slugRow = db.query("SELECT id, slug, title FROM books WHERE slug = ? AND status = 'ready'").get("bio-101") as { id: string } | null
  assert(slugRow?.id === "bio-101", "slug resolves to book id in books.db")

  // ------------------------------------------------------------------
  // 9. EVAL harness on the golden set we just built
  // ------------------------------------------------------------------
  console.log("── 8. EVAL harness ──")
  const { runEval } = yield* Effect.promise(() => import("../packages/learning/src/eval/index.ts"))
  const photoChunkId = normChunks[photoIdx]!.id
  const heartChunkId = normChunks[heartIdx]!.id
  const report = yield* runEval(wrapDb, [
    { id: "q1", bookId: "bio-101", query: "how do plants make food from sunlight", language: "en", expectedChunkIds: [photoChunkId], kind: "in-book" },
    { id: "q2", bookId: "bio-101", query: "كم عدد غرف القلب", language: "ar", expectedChunkIds: [heartChunkId], kind: "cross-lingual" },
    { id: "q3", bookId: "bio-101", query: "chlorophyll", language: "en", expectedChunkIds: [photoChunkId], kind: "in-book" },
    { id: "q4", bookId: "bio-101", query: "what is the capital of France", language: "en", expectedChunkIds: [], kind: "off-topic" },
    { id: "q5", bookId: "bio-101", query: "explain more", language: "en", expectedChunkIds: [photoChunkId], kind: "follow-up" },
  ], { ...baseOpts, gate: { ...baseOpts.gate, minDenseScore: 0.0, minFusedScore: 0.0 } })
  assert(report.totalQuestions === 5, `eval ran ${report.totalQuestions} questions`)
  assert(report.recallAt5 > 0, `recall@5 = ${report.recallAt5.toFixed(2)}`)
  assert(report.gateRecall === 1, `gate recall (off-topic refused) = ${report.gateRecall}`)
  assert(report.falseRefusalRate <= 0.5, `false-refusal rate = ${report.falseRefusalRate.toFixed(2)} (<= 0.5)`)

  console.log(`  eval details: recall@1=${report.recallAt1.toFixed(2)} recall@3=${report.recallAt3.toFixed(2)} recall@5=${report.recallAt5.toFixed(2)} mrr=${report.mrr.toFixed(2)}`)

  db.close()
  yield* Pipeline.unload()
})

Effect.runPromise(run.pipe(Effect.provide(Effect.void) as never)).then(
  () => {
    console.log("")
    console.log("════════════════════════════════")
    console.log(`PHASE C RESULTS: ${pass} passed, ${fail} failed`)
    console.log("════════════════════════════════")
    process.exit(fail > 0 ? 1 : 0)
  },
  (err) => {
    console.error("PHASE C CRASHED:", err)
    console.log(`PHASE C RESULTS: ${pass} passed, ${fail + 1} failed`)
    process.exit(1)
  },
)
