// Debug: what dense score does an off-topic query get against biology chunks?
import { Effect } from "effect"
import { Database as BunDatabase } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseTxt } from "../src/parsers/index.ts"
import { chunk } from "../src/chunk/index.ts"
import { normalizeForSearch } from "../src/lang/arabic.ts"
import * as Pipeline from "../src/embed/pipeline.ts"
import { vectorToB64, cosine } from "../src/self-test/index.ts"
import { SCHEMA_SQL } from "../src/store/schema.ts"

const BOOK = `
Chapter 1: Photosynthesis
Photosynthesis is the process by which green plants convert light energy into chemical energy. Plants absorb sunlight through chlorophyll in their leaves. Water and carbon dioxide are the raw materials. Glucose and oxygen are the products.
التمثيل الضوئي هو العملية التي تحوّل بها النباتات الخضراء طاقة الضوء إلى طاقة كيميائية. تمتص النباتات ضوء الشمس من خلال الكلوروفيل في أوراقها.
The light-dependent reactions happen in the thylakoid membranes. The Calvin cycle happens in the stroma.
Chapter 2: The Circulatory System
The heart has four chambers: two atria and two ventricles. Arteries carry blood away from the heart. Veins carry blood back to the heart.
القلب له أربع غرف: أذينان وبطينان. تحمل الشرايين الدم بعيدًا عن القلب.
Blood pressure is measured in millimeters of mercury. Normal blood pressure is around 120 over 80.
`

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
  const vecs: Float32Array[] = []
  for (const c of norm) vecs.push(yield* Pipeline.embed(c.text))

  for (const q of [
    "what is the capital of France",
    "who won the world cup in 2022",
    "how do I bake a chocolate cake",
    "how do plants make food from sunlight",
    "how many chambers does the heart have",
  ]) {
    const qv = yield* Pipeline.embed(q)
    const scores = norm.map((c, i) => ({ id: c.id, score: cosine(qv, vecs[i]!), text: c.text.slice(0, 35).replace(/\n/g, " ") }))
    scores.sort((a, b) => b.score - a.score)
    console.log(`"${q}"  →  best dense = ${scores[0]!.score.toFixed(4)} (${scores[0]!.text})`)
  }
})
Effect.runPromise(run).then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
