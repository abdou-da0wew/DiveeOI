// packages/learning/test/retrieval-fts-marker.test.ts
//
// Regression tests for the 4-g finding: heuristic-rewritten follow-up queries
// (`"… (re: last turn)"` appended by retrieve/rewrite.ts) produced 0 BM25 hits
// because runBm25 quotes every whitespace token and FTS5 joins them with an
// implicit AND — the marker's own tokens ("(re:", "light?)"-style fragments)
// can never appear in text_norm, so the whole lexical leg blanked.
//
// Fix (4-k): strip the trailing ` (re: …)` marker at the FTS query-construction
// boundary (stripRewriteMarker, used by runBm25). The dense leg is untouched —
// the query vector is embedded from the raw query upstream (session/turn.ts) —
// and RetrievalResult.rewrittenQuery keeps the full string for the inspector.

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Database as BunDatabase } from "bun:sqlite"
import { SCHEMA_SQL } from "../src/store/schema"
import { retrieve, stripRewriteMarker, type RetrievalOptions } from "../src/retrieve/hybrid"
import { normalizeForSearch } from "../src/lang/arabic"

// ---------------------------------------------------------------------------
// stripRewriteMarker — the FTS query-construction boundary
// ---------------------------------------------------------------------------

describe("stripRewriteMarker", () => {
  test("a heuristic-rewritten query reduces to its core terms", () => {
    const rewritten = "more on photosynthesis (re: How does chlorophyll absorb light?)"
    expect(stripRewriteMarker(rewritten)).toBe("more on photosynthesis")
  })

  test("the FTS match expression built from the stripped query contains only the core terms", () => {
    // Exact runBm25 tokenization, asserted so a regression here is caught even
    // if the SQL side changes.
    const rewritten = normalizeForSearch("explain the Krebs cycle (re: What does the Krebs cycle produce?)")
    const terms = stripRewriteMarker(rewritten)
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t.replace(/"/g, "")}"`)
      .join(" ")
    expect(terms).toBe(`"explain" "the" "Krebs" "cycle"`)
  })

  test("non-rewritten queries pass through unchanged", () => {
    expect(stripRewriteMarker("How does chlorophyll absorb light?")).toBe("How does chlorophyll absorb light?")
    expect(stripRewriteMarker("photosynthesis")).toBe("photosynthesis")
    expect(stripRewriteMarker("  spaced query  ")).toBe("spaced query")
    // An embedded "(re: …)" that is NOT a trailing suffix is user content.
    expect(stripRewriteMarker("why (re: x) is that")).toBe("why (re: x) is that")
    expect(stripRewriteMarker("")).toBe("")
  })

  test("Arabic core queries keep their terms; the Latin marker is removed", () => {
    expect(stripRewriteMarker("اشرح التمثيل الضوئي (re: كيف يمتص الكلوروفيل الضوء؟)")).toBe("اشرح التمثيل الضوئي")
  })

  test("an empty marker body still reduces to the core", () => {
    expect(stripRewriteMarker("explain more (re: )")).toBe("explain more")
  })
})

// ---------------------------------------------------------------------------
// End-to-end through the real FTS5 leg of retrieve()
// ---------------------------------------------------------------------------

describe("retrieve BM25 leg with rewritten follow-ups", () => {
  let tempDir: string
  let db: BunDatabase

  // Wrap the bun:sqlite handle to match BooksDbHandle (same shim as hybrid.test.ts).
  const wrapDb = (raw: BunDatabase) => ({
    run: (sql: string, ...params: unknown[]) => Promise.resolve().then(() => raw.run(sql, ...(params as never[]))),
    all: <T>(sql: string, ...params: unknown[]) =>
      Promise.resolve().then(() => {
        const q = raw.prepare(sql)
        const r = params.length > 0 ? q.all(...(params as never[])) : q.all()
        q.finalize()
        return r as T[]
      }),
    get: <T>(sql: string, ...params: unknown[]) =>
      Promise.resolve().then(() => {
        const q = raw.prepare(sql)
        const r = params.length > 0 ? q.get(...(params as never[])) : q.get()
        q.finalize()
        return r as T | undefined
      }),
    _execRaw: (sql: string) => Promise.resolve().then(() => raw.exec(sql)),
  })

  const openDb = () => {
    tempDir = mkdtempSync(join(tmpdir(), "tl-fts-marker-"))
    db = new BunDatabase(join(tempDir, "books.db"))
    db.exec(SCHEMA_SQL)
    db.run(
      "INSERT INTO books(id, slug, title, source_hash, source_path, status, embed_signature, normalizer_version, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      "bio",
      "biology",
      "Biology 101",
      "h1",
      "bio.pdf",
      "ready",
      "{}",
      1,
      Date.now(),
    )
    db.run(
      "INSERT INTO sections(id, book_id, level, ord, text, heading_path) VALUES(?,?,?,?,?,?)",
      "bio-s1",
      "bio",
      1,
      0,
      "Photosynthesis converts sunlight into chemical energy.",
      "Chapter 1",
    )
    // Chunk 3 deliberately contains BOTH core terms of the anaphoric follow-up
    // "more on photosynthesis" — with the marker kept, even this chunk scored 0.
    db.run(
      "INSERT INTO chunks(id, book_id, section_id, ord, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?)",
      "bio-c1",
      "bio",
      "bio-s1",
      0,
      "Photosynthesis converts sunlight into glucose and oxygen.",
      "photosynthesis converts sunlight into glucose and oxygen",
      8,
    )
    db.run(
      "INSERT INTO chunks(id, book_id, section_id, ord, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?)",
      "bio-c2",
      "bio",
      "bio-s1",
      1,
      "Read more on photosynthesis in the next section.",
      "read more on photosynthesis in the next section",
      8,
    )
  }

  const closeDb = () => {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  }

  const options = (query: string, extra: Partial<RetrievalOptions> = {}): RetrievalOptions => ({
    bookIds: ["bio"],
    query,
    bm25TopK: 10,
    denseTopK: 10,
    rrfK: 60,
    weightBm25: 1,
    weightDense: 1,
    autoWeightByLanguage: false,
    finalTopK: 8,
    parentExpansion: false,
    parentContextMaxTokens: 500,
    queryRewrite: "heuristic",
    rewriteTurns: 2,
    recentUserTurns: [],
    // engine "typescript": runBm25 is the FTS boundary under test; the native
    // engine's Rust fts_expression OR-joins terms and already tolerated the marker.
    engine: "typescript",
    gate: { enabled: false, language: "auto", minDenseScore: 0, minFusedScore: 0, allowSmallTalk: false, libraryAvailable: true },
    ...extra,
  })

  test("a heuristic-rewritten follow-up gets BM25 hits again (was 0 with the marker)", async () => {
    openDb()
    try {
      const result = await Effect.runPromise(
        retrieve(
          wrapDb(db),
          options("more on photosynthesis", { recentUserTurns: ["How does chlorophyll absorb light?"], debug: true }),
          null,
        ),
      )
      // The rewrite fired, so the provenance marker is reported for the inspector…
      expect(result.rewrittenQuery).toContain("(re:")
      // …but the FTS match expression only carried the core terms, so the
      // lexical leg actually hits. (Regression guard: this was 0 before the fix.)
      expect(result.bm25TopK).toBeGreaterThan(0)
      expect(result.ungatedCandidates!.some((c) => c.chunkId === "bio-c2" && c.bm25Score !== undefined)).toBe(true)
    } finally {
      closeDb()
    }
  })

  test("the stripped rewritten query and the plain core query produce the same BM25 hit count", async () => {
    openDb()
    try {
      const rewritten = await Effect.runPromise(
        retrieve(
          wrapDb(db),
          options("more on photosynthesis", { recentUserTurns: ["How does chlorophyll absorb light?"] }),
          null,
        ),
      )
      const plain = await Effect.runPromise(
        retrieve(wrapDb(db), options("more on photosynthesis", { queryRewrite: "off" }), null),
      )
      expect(rewritten.bm25TopK).toBe(plain.bm25TopK)
      // Guard against a trivially-equal 0 === 0: the plain query must actually hit.
      expect(plain.bm25TopK).toBeGreaterThan(0)
    } finally {
      closeDb()
    }
  })

  test("a non-rewritten query keeps its full FTS expression", async () => {
    openDb()
    try {
      const result = await Effect.runPromise(retrieve(wrapDb(db), options("How does chlorophyll absorb light?"), null))
      // No rewrite fired (query is not anaphoric) — the whole query is searched
      // exactly as before the fix, marker or not.
      expect(result.rewrittenQuery).toBeUndefined()
      expect(result.bm25TopK).toBe(0) // AND(How, does, chlorophyll, absorb, light?) — no chunk has them all; honest unchanged behavior
    } finally {
      closeDb()
    }
  })
})
