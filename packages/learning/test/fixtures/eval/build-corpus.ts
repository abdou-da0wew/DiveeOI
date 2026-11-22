// packages/learning/test/fixtures/eval/build-corpus.ts
//
// Builds the two mini books (books.db rows + standin vectors) from the
// fixture corpus .txt files. Shared by test/eval-harness.test.ts and any
// manual `tl:eval` demo run against the synthetic corpus.
//
// Fixture corpus format (one file per book):
//   # <slug> | <title> | <lang>
//   %% <section title>
//   <paragraph → one chunk>
//
//   (blank line between paragraphs)
//
// Deterministic ids: book id = slug, section ids `<slug>-s<ord>`, chunk ids
// `<slug>-c<ord>` (0-based across the book). chunk.page = chunkIndex + 1 so
// expectedPageRange expectations are discriminative on this synthetic paging.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { BooksDbHandle } from "../../../src/store"
import { SCHEMA_SQL } from "../../../src/store/schema"
import { normalizeForSearch } from "../../../src/lang/arabic"
import { standinEmbed } from "../../../src/eval/embedder"
import { vectorToB64 } from "../../../src/self-test"

export interface FixtureBook {
  slug: string
  title: string
  lang: string
  sections: Array<{ title: string; chunks: string[] }>
}

export const parseFixtureCorpus = (txt: string): FixtureBook => {
  const lines = txt.split(/\r?\n/)
  const header = lines[0]!
  const headerMatch = /^#\s*([^|]+)\|\s*([^|]+)\|\s*(\S+)\s*$/.exec(header)
  if (!headerMatch) throw new Error(`fixture corpus header must be "# <slug> | <title> | <lang>", got: ${header}`)
  const book: FixtureBook = {
    slug: headerMatch[1]!.trim(),
    title: headerMatch[2]!.trim(),
    lang: headerMatch[3]!.trim(),
    sections: [],
  }
  let current: { title: string; chunks: string[] } | null = null
  const flushParagraph = (buf: string[]): void => {
    const text = buf.join("\n").trim()
    if (text && current) current.chunks.push(text)
  }
  let buf: string[] = []
  for (const line of lines.slice(1)) {
    const sectionMatch = /^%%\s*(.+)$/.exec(line.trim())
    if (sectionMatch) {
      flushParagraph(buf)
      buf = []
      current = { title: sectionMatch[1]!.trim(), chunks: [] }
      book.sections.push(current)
      continue
    }
    if (line.trim() === "") {
      flushParagraph(buf)
      buf = []
      continue
    }
    buf.push(line)
  }
  flushParagraph(buf)
  return book
}

export const loadFixtureBooks = (fixturesDir: string): FixtureBook[] =>
  ["biology-basics", "astronomy-essentials"].map((slug) =>
    parseFixtureCorpus(readFileSync(join(fixturesDir, "corpus", `${slug}.txt`), "utf8")),
  )

/**
 * Creates the books + sections + chunks + chunk_vecs rows for the fixture
 * books in a fresh books.db (the caller opens/creates the database and runs
 * SCHEMA_SQL first). Returns the per-book chunk ids in insertion order.
 */
export const insertFixtureBooks = async (db: BooksDbHandle, books: FixtureBook[]): Promise<Map<string, string[]>> => {
  await db._execRaw(SCHEMA_SQL)
  const chunkIdsByBook = new Map<string, string[]>()
  for (const book of books) {
    await db.run(
      "INSERT INTO books(id, slug, title, lang, source_hash, source_path, pages, status, embed_signature, normalizer_version, created_at, chunk_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      book.slug,
      book.slug,
      book.title,
      book.lang,
      `fixture-${book.slug}`,
      `fixtures/eval/corpus/${book.slug}.txt`,
      6,
      "ready",
      JSON.stringify({ repo: "standin", dtype: "standin" }),
      1,
      Date.now(),
      0,
    )

    const chunkIds: string[] = []
    let chunkOrd = 0
    for (let s = 0; s < book.sections.length; s++) {
      const section = book.sections[s]!
      const sectionId = `${book.slug}-s${s}`
      const sectionText = section.chunks.join("\n\n")
      const startPage = chunkOrd + 1
      const endPage = chunkOrd + section.chunks.length
      await db.run(
        "INSERT INTO sections(id, book_id, level, ord, title, page_start, page_end, text, heading_path) VALUES(?,?,?,?,?,?,?,?,?)",
        sectionId,
        book.slug,
        1,
        s,
        section.title,
        startPage,
        endPage,
        sectionText,
        section.title,
      )
      for (const chunkText of section.chunks) {
        const chunkId = `${book.slug}-c${chunkOrd}`
        const page = chunkOrd + 1
        const textNorm = normalizeForSearch(chunkText)
        await db.run(
          "INSERT INTO chunks(id, book_id, section_id, ord, page, text, text_norm, token_count) VALUES(?,?,?,?,?,?,?,?)",
          chunkId,
          book.slug,
          sectionId,
          chunkOrd,
          page,
          chunkText,
          textNorm,
          Math.ceil(chunkText.length / 4),
        )
        await db.run("INSERT INTO chunk_vecs(chunk_id, vec) VALUES(?,?)", chunkId, vectorToB64(standinEmbed(chunkText)))
        chunkIds.push(chunkId)
        chunkOrd++
      }
    }
    await db.run("UPDATE books SET chunk_count = ? WHERE id = ?", chunkIds.length, book.slug)
    chunkIdsByBook.set(book.slug, chunkIds)
  }
  return chunkIdsByBook
}
