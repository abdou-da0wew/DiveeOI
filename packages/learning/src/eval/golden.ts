// packages/learning/src/eval/golden.ts
//
// Golden-set loading and expectation resolution against books.db.
//
// parseGoldenSet() validates a JSON document against the v2 schema and fails
// loudly (with the file name and question id in the message) so a malformed
// golden set can never silently produce a meaningless eval report.
//
// resolveGoldenQuestions() binds every question's expectations to the indexed
// corpus: bookSlug → bookId, expectedSectionTitles → section ids
// (case-insensitive substring match on sections.title / sections.heading_path),
// and records warnings for anything that did not resolve instead of failing
// the whole run (a real corpus always has a few stale titles).

import { Schema } from "effect"
import type { BooksDbHandle } from "../store"
import {
  GoldenSetFile,
  type GoldenQuestion,
  type GoldenSetRole,
  type ResolvedQuestion,
} from "./types"

// ---------------------------------------------------------------------------
// Parsing / validation
// ---------------------------------------------------------------------------

export class GoldenSetError extends Error {
  readonly source: string
  constructor(source: string, message: string) {
    super(`golden set ${source}: ${message}`)
    this.name = "GoldenSetError"
    this.source = source
  }
}

export const parseGoldenSet = (json: unknown, source: string): GoldenSetFile => {
  let decoded: GoldenSetFile
  try {
    decoded = Schema.decodeUnknownSync(GoldenSetFile)(json)
  } catch (cause) {
    const detail =
      cause instanceof Error
        ? cause.message.replace(/\s+/g, " ").slice(0, 400)
        : String(cause).slice(0, 400)
    throw new GoldenSetError(source, `schema validation failed — ${detail}`)
  }
  const seen = new Set<string>()
  for (const q of decoded.questions) {
    if (!q.bookId && !q.bookSlug) {
      throw new GoldenSetError(source, `question "${q.id}" needs "bookId" or "bookSlug"`)
    }
    if (seen.has(q.id)) {
      throw new GoldenSetError(source, `duplicate question id "${q.id}"`)
    }
    seen.add(q.id)
    if (q.kind === "off-topic" && (q.expectedSectionTitles?.length || q.expectedChunkIds?.length)) {
      throw new GoldenSetError(
        source,
        `off-topic question "${q.id}" must not carry expected sections/chunks (it must be refused)`,
      )
    }
    if (q.kind !== "off-topic" && q.kind !== "follow-up" && !hasExpectation(q)) {
      throw new GoldenSetError(
        source,
        `question "${q.id}" (kind ${q.kind}) needs expectedSectionTitles, expectedChunkIds, or expectedPageRange`,
      )
    }
  }
  // followUpOf targets must exist inside the same set.
  const ids = new Set(decoded.questions.map((q) => q.id))
  for (const q of decoded.questions) {
    if (q.followUpOf && !ids.has(q.followUpOf)) {
      throw new GoldenSetError(source, `question "${q.id}" references unknown followUpOf "${q.followUpOf}"`)
    }
  }
  return decoded
}

export const hasExpectation = (q: GoldenQuestion): boolean =>
  (q.expectedSectionTitles?.length ?? 0) > 0 ||
  (q.expectedChunkIds?.length ?? 0) > 0 ||
  q.expectedPageRange !== undefined

// ---------------------------------------------------------------------------
// Resolution against the corpus
// ---------------------------------------------------------------------------

interface BookMeta {
  id: string
  slug: string
  title: string
}
interface SectionMeta {
  id: string
  bookId: string
  title: string | null
  headingPath: string | null
}
interface ChunkMeta {
  id: string
  bookId: string
  sectionId: string
  page: number | undefined
}

export interface CorpusIndex {
  booksBySlug: Map<string, BookMeta>
  booksById: Map<string, BookMeta>
  sectionsByBook: Map<string, SectionMeta[]>
  chunksByBook: Map<string, ChunkMeta[]>
}

export const buildCorpusIndex = async (db: BooksDbHandle): Promise<CorpusIndex> => {
  const books = await db.all<{ id: string; slug: string; title: string }>("SELECT id, slug, title FROM books")
  const sections = await db.all<{ id: string; book_id: string; title: string | null; heading_path: string | null }>(
    "SELECT id, book_id, title, heading_path FROM sections",
  )
  const chunks = await db.all<{ id: string; book_id: string; section_id: string; page: number | null }>(
    "SELECT id, book_id, section_id, page FROM chunks",
  )
  const index: CorpusIndex = {
    booksBySlug: new Map(),
    booksById: new Map(),
    sectionsByBook: new Map(),
    chunksByBook: new Map(),
  }
  for (const b of books) {
    const meta = { id: b.id, slug: b.slug, title: b.title }
    index.booksById.set(b.id, meta)
    index.booksBySlug.set(b.slug, meta)
  }
  for (const s of sections) {
    const list = index.sectionsByBook.get(s.book_id) ?? []
    list.push({ id: s.id, bookId: s.book_id, title: s.title, headingPath: s.heading_path })
    index.sectionsByBook.set(s.book_id, list)
  }
  for (const c of chunks) {
    const list = index.chunksByBook.get(c.book_id) ?? []
    list.push({ id: c.id, bookId: c.book_id, sectionId: c.section_id, page: c.page ?? undefined })
    index.chunksByBook.set(c.book_id, list)
  }
  return index
}

const titleMatches = (section: SectionMeta, wanted: string): boolean => {
  const needle = wanted.trim().toLowerCase()
  if (!needle) return false
  for (const hay of [section.title ?? "", section.headingPath ?? ""]) {
    if (hay.toLowerCase().includes(needle)) return true
  }
  return false
}

export const resolveQuestion = (
  q: GoldenQuestion,
  role: GoldenSetRole | undefined,
  index: CorpusIndex,
): { resolved: ResolvedQuestion | null; warnings: string[] } => {
  const warnings: string[] = []
  const book = q.bookId ? index.booksById.get(q.bookId) : q.bookSlug ? index.booksBySlug.get(q.bookSlug) : undefined
  if (!book) {
    warnings.push(`question "${q.id}": book ${q.bookSlug ?? q.bookId} not found in corpus — skipped`)
    return { resolved: null, warnings }
  }

  const expectedSectionIds = new Set<string>()
  const unresolved: string[] = []
  for (const wanted of q.expectedSectionTitles ?? []) {
    const sections = (index.sectionsByBook.get(book.id) ?? []).filter((s) => titleMatches(s, wanted))
    if (sections.length === 0) {
      unresolved.push(`section title "${wanted}"`)
      continue
    }
    for (const s of sections) expectedSectionIds.add(s.id)
  }

  const expectedChunkIds = [...(q.expectedChunkIds ?? [])]
  const chunkIds = new Set((index.chunksByBook.get(book.id) ?? []).map((c) => c.id))
  for (const id of expectedChunkIds) {
    if (!chunkIds.has(id)) unresolved.push(`chunk id "${id}"`)
  }

  if (q.kind !== "off-topic" && q.kind !== "follow-up" && expectedSectionIds.size === 0 && expectedChunkIds.length === 0 && !q.expectedPageRange) {
    warnings.push(`question "${q.id}": no expectation resolved against the corpus (${unresolved.join("; ") || "none given"}) — it will count as a miss`)
  }

  return {
    resolved: {
      id: q.id,
      bookId: book.id,
      bookSlug: book.slug,
      query: q.query,
      language: q.language,
      kind: q.kind,
      role,
      expectedChunkIds,
      expectedSectionIds,
      expectedPageRange: q.expectedPageRange,
      followUpOf: q.followUpOf,
      unresolved,
    },
    warnings,
  }
}

export interface ResolvedGoldenSet {
  file: string
  name: string
  role?: GoldenSetRole
  questions: ResolvedQuestion[]
  warnings: string[]
}

/** Resolves every question of every set against the corpus; questions whose book
 * is missing are skipped with a warning (a real library rarely has every book). */
export const resolveGoldenSets = async (
  sets: Array<{ file: string; set: GoldenSetFile }>,
  index: CorpusIndex,
): Promise<ResolvedGoldenSet[]> => {
  const out: ResolvedGoldenSet[] = []
  for (const { file, set } of sets) {
    const questions: ResolvedQuestion[] = []
    const warnings: string[] = []
    for (const q of set.questions) {
      const { resolved, warnings: qWarnings } = resolveQuestion(q, set.role, index)
      warnings.push(...qWarnings)
      if (resolved) questions.push(resolved)
    }
    out.push({ file, name: set.name, role: set.role, questions, warnings })
  }
  return out
}
