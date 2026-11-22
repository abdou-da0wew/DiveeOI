// packages/learning/test/chunk-arabic.test.ts
//
// Regression tests for bug #11 (TODO §2): Arabic RTL word-order garbling in
// chunk extraction, which fed wrong figures into Arabic numeric answers (bug #4).
//
// Invariants asserted here:
//   1. Chunking preserves the logical word order of the source exactly:
//      no reordering, no dropped tokens, no duplicated tokens.
//   2. Digit runs (Latin and Arabic-Indic, decimals and version strings)
//      survive verbatim — a "." inside a number is never a sentence boundary.
//   3. `text` (display) stays byte-identical to the source; `textNorm`
//      (search) is produced by normalizeForSearch so FTS5 matches the
//      normalized queries the retriever sends (retrieve/hybrid.ts).

import { expect, test, describe } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { chunk, type ChunkOptions, setTokenizer } from "../src/chunk"
import { normalizeForSearch } from "../src/lang/arabic"
import type { ParseResult } from "../src/parsers"

setTokenizer({
  encode: (text: string) => ({
    length: text.trim().split(/\s+/).filter(Boolean).length,
  }),
})

const options: ChunkOptions = {
  childTargetTokens: 30,
  childMaxTokens: 50,
  childOverlapTokens: 5,
  minChunkTokens: 5,
  parentMaxTokens: 200,
  prependHeadingPath: true,
  stripHeadersFooters: true,
}

const makeParseResult = (text: string, outline: { title: string; page: number; level: number }[] = []): ParseResult => ({
  pages: [{ page: 1, text }],
  outline: outline as never,
  language: "ar",
  textDensity: 1.0,
  metadata: { pages: 1 },
})

const wordsOf = (s: string) => s.trim().split(/\s+/).filter(Boolean)

// Realistic Arabic prose: Arabic-Indic + Latin numerals, decimals, an English
// term, several sentences, Arabic punctuation ؟ ، ؛ and a mixed RTL/LTR flow.
const ARABIC_PROSE =
  "في عام ١٩٦٩ بلغ عدد سكان المدينة ١٢٣٤٥ نسمة، وقد نما هذا الرقم بمعدل سنوي قدره 3.5 بالمئة. " +
  "The term photosynthesis يعني التصوير الضوئي في اللغة العربية؛ وهو عملية حيوية مهمة. " +
  "سؤال: ما هي نسبة النمو بين عامي ١٩٩٠ و٢٠٢٠؟ الجواب تعتمد على بيانات التعداد السكاني، " +
  "حيث بلغ التعداد ٢٠٠٠٠٠ في بداية الفترة و٣٥٠٠٠٠ في نهايتها. النتيجة النهائية: نمو بنسبة 75٪."

describe("chunker — Arabic RTL extraction invariants (bug #11)", () => {
  test("chunk stream preserves the source word sequence exactly (no reorder/drop/duplicate)", async () => {
    const result = await Effect.runPromise(chunk(makeParseResult(ARABIC_PROSE), "ar-book", options))
    expect(result.chunks.length).toBeGreaterThan(0)

    const sourceWords = wordsOf(ARABIC_PROSE)
    const chunkWords = result.chunks.flatMap((c) => wordsOf(c.text))

    // Exact sequence: same tokens, same order, same multiplicity.
    expect(chunkWords).toEqual(sourceWords)
  })

  test("digit runs (Latin + Arabic-Indic) survive verbatim in the chunk text", async () => {
    const text =
      "بلغ الناتج المحلي 12345.67 مليون دينار، أي بنمو 3.5 بالمئة خلال الربع الأول. " +
      "وبلغ عدد الطلاب ١٢٣٤٥ طالبًا، بنسبة نجاح 98.2٪. الإصدار v3.5.1 مستقر تمامًا."
    const result = await Effect.runPromise(chunk(makeParseResult(text), "ar-book", options))
    const joined = result.chunks.map((c) => c.text).join("\n")

    for (const run of ["12345.67", "3.5", "١٢٣٤٥", "98.2٪", "v3.5.1"]) {
      expect(joined).toContain(run)
    }
    // The decimal must appear as one contiguous token, not split across tokens.
    for (const c of result.chunks) {
      expect(c.text).not.toMatch(/\b3\.\s+5\b/)
    }
  })

  test("a sentence boundary after a digit is still respected (no over-gluing)", async () => {
    const text = "كان العدد 3. 2015 كان عامًا حاسمًا في التاريخ."
    const result = await Effect.runPromise(chunk(makeParseResult(text), "ar-book", options))
    const words = result.chunks.flatMap((c) => wordsOf(c.text))
    expect(words).toEqual(wordsOf(text))
    // The first sentence must end at "3." — "2015 …" starts the next one.
    expect(result.chunks[0]!.text.startsWith("كان العدد 3.")).toBe(true)
  })

  test("Arabic punctuation ؟ ، ؛ never breaks or reorders word flow", async () => {
    const text = "س1: من هو المؤلف؟ الجواب: أحمد، وكذلك أخوه؛ وقد كتبا معًا. س2: متى نُشر الكتاب؟ في ٢٠١٠."
    const result = await Effect.runPromise(chunk(makeParseResult(text), "ar-book", options))
    const words = result.chunks.flatMap((c) => wordsOf(c.text))
    expect(words).toEqual(wordsOf(text))
  })

  test("chunk.text keeps the display form; chunk.textNorm is search-normalized", async () => {
    // Diacritized Arabic with alef / ya / ta-marbuta variants.
    const text = "القِراءةُ تَنمِّي الذَّهنَ، وإِنْسانٌ آخَرُ يَقرأُ مِئَةَ كِتَابٍ. قِطَّةٌ نَائِمَةٌ."
    const result = await Effect.runPromise(chunk(makeParseResult(text), "ar-book", options))
    const c = result.chunks[0]!

    // Display text is the original, byte-identical.
    expect(c.text).toContain("القِراءةُ")
    expect(c.text).toContain("إِنْسانٌ")
    expect(c.text).toContain("نَائِمَةٌ")

    // Search text: diacritics/tatweel stripped, alef→ا, ى→ي, ة→ه.
    expect(c.textNorm).not.toMatch(/[\u064B-\u065F\u0640]/)
    expect(c.textNorm).not.toMatch(/[\u0622\u0623\u0625\u0649\u0629]/)
    expect(c.textNorm).toContain("القراءه")
    expect(c.textNorm).toContain("انسان")
    expect(c.textNorm).toContain("نائمه")

    // Idempotent: callers that re-normalize (scripts/rag-e2e.ts) see no change.
    expect(normalizeForSearch(c.textNorm)).toBe(c.textNorm)
  })

  test("English/Latin chunk text is byte-identical to the source sentence flow", async () => {
    const text = "This is a short sentence. Here is another one. And a third for good measure."
    const result = await Effect.runPromise(chunk(makeParseResult(text), "en-book", options))
    const texts = result.chunks.map((c) => c.text)
    expect(texts.join(" ").replace(/\s+/g, " ")).toBe(text)
    // English text with single spaces and no diacritics: norm equals display.
    for (const c of result.chunks) expect(c.textNorm).toBe(c.text)
  })

  test("English decimals are no longer split into separate sentence units", async () => {
    const text = "Growth was 3.5 percent. Then it stopped."
    const result = await Effect.runPromise(chunk(makeParseResult(text), "en-book", options))
    expect(result.chunks.length).toBe(1)
    expect(result.chunks[0]!.text).toBe("Growth was 3.5 percent. Then it stopped.")
  })

  test("normalized Arabic queries hit chunks_fts built from chunk.textNorm (the #11 → #4 chain)", () => {
    // Mirrors store/schema.ts: chunks_fts over text_norm, unicode61 + remove_diacritics 2,
    // and retrieve/hybrid.ts which normalizes the query before MATCH.
    const db = new Database(":memory:")
    db.run(`CREATE VIRTUAL TABLE chunks_fts USING fts5(text_norm, tokenize='unicode61 remove_diacritics 2')`)
    db.run(`CREATE TABLE chunks (rowid INTEGER PRIMARY KEY, text TEXT, text_norm TEXT)`)

    const diacritizedBookText = "القِراءةُ تَنمِّي الذَّهنَ، وإِنْسانٌ آخَرُ يَقرأُ مِئَةَ كِتَابٍ."
    const display = diacritizedBookText
    const norm = normalizeForSearch(display)
    db.run(`INSERT INTO chunks (rowid, text, text_norm) VALUES (1, ?, ?)`, display, norm)
    db.run(`INSERT INTO chunks_fts (rowid, text_norm) VALUES (1, ?)`, norm)

    const userQuery = "القراءة تنمي الذهن" // typed without diacritics, as a student would search
    const normalizedQuery = normalizeForSearch(userQuery)
    const terms = normalizedQuery.split(/\s+/).filter((t) => t.length > 0).map((t) => `"${t}"`).join(" ")
    const hits = db.query(`SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?`).all(terms) as unknown[]
    expect(hits.length).toBeGreaterThan(0)
    db.close()
  })

  test("heading path is metadata only — it never leaks into chunk word order", async () => {
    const outline = [{ title: "الفصل الثالث: الإحصاء", page: 1, level: 1 }]
    const result = await Effect.runPromise(chunk(makeParseResult(ARABIC_PROSE, outline), "ar-book", options))
    const sourceWords = wordsOf(ARABIC_PROSE)
    const chunkWords = result.chunks.flatMap((c) => wordsOf(c.text))
    expect(chunkWords).toEqual(sourceWords)
    expect(result.chunks[0]!.headingPath).toContain("الإحصاء")
  })
})
