// packages/learning/src/chunk/index.ts
//
// Layout-aware parent/child chunker (plan §7.4, §7.5).
//
// Children are small (~150 tokens) and get embedded. Parents are larger
// (~1200 tokens) sections and go to the LLM. A heading path (e.g.
// "Chapter 3 > Section 2") is prepended to the embedded text.
//
// Phase 2 implementation:
//   - Parents built from outline entries (PDF outline preferred, fallback
//     to font-size/bold heuristics in the parser)
//   - Children split on sentence boundaries, ~150 target / 220 max tokens,
//     20 overlap, 30 minimum
//   - Heading path prepended to embedded text when prependHeadingPath
//   - Whole sentences never split mid-way when avoidable

import { Effect, Schema } from "effect"
import type { ParseResult, OutlineEntry } from "../parsers"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const ChildChunk = Schema.Struct({
  id: Schema.String,
  bookId: Schema.String,
  sectionId: Schema.String,
  ord: Schema.Number,
  page: Schema.optional(Schema.Number),
  text: Schema.String,
  textNorm: Schema.String,
  tokenCount: Schema.Number,
  headingPath: Schema.optional(Schema.String),
})
export type ChildChunk = Schema.Schema.Type<typeof ChildChunk>

export const ParentSection = Schema.Struct({
  id: Schema.String,
  bookId: Schema.String,
  parentId: Schema.optional(Schema.String),
  level: Schema.Number,
  title: Schema.optional(Schema.String),
  pageStart: Schema.optional(Schema.Number),
  pageEnd: Schema.optional(Schema.Number),
  ord: Schema.Number,
  text: Schema.String,
  headingPath: Schema.optional(Schema.String),
  childIds: Schema.Array(Schema.String),
})
export type ParentSection = Schema.Schema.Type<typeof ParentSection>

export const ChunkResult = Schema.Struct({
  sections: Schema.Array(ParentSection),
  chunks: Schema.Array(ChildChunk),
})
export type ChunkResult = Schema.Schema.Type<typeof ChunkResult>

export interface ChunkOptions {
  childTargetTokens: number
  childMaxTokens: number
  childOverlapTokens: number
  minChunkTokens: number
  parentMaxTokens: number
  prependHeadingPath: boolean
  stripHeadersFooters: boolean
}

// ---------------------------------------------------------------------------
// Token counter — uses a lazy-loaded bge-m3 tokenizer when available,
// otherwise a whitespace + character estimate that's accurate enough for
// chunk-size decisions (not for embedding).
// ---------------------------------------------------------------------------

let _tokenizer: { encode: (text: string) => { length: number } } | null = null

const estimateTokens = (text: string): number => {
  if (_tokenizer) return _tokenizer.encode(text).length
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) ?? []).length
  const latinChars = text.length - arabicChars
  // English ~1 token per 4 chars; Arabic ~1 token per 2 chars (with prefixes/suffixes).
  return Math.max(words, Math.ceil(latinChars / 4 + arabicChars / 2))
}

export const setTokenizer = (tokenizer: { encode: (text: string) => { length: number } }) => {
  _tokenizer = tokenizer
}

// ---------------------------------------------------------------------------
// Sentence splitter — handles Arabic and English punctuation.
// ---------------------------------------------------------------------------

const splitSentences = (text: string): string[] => {
  // Match sentences ending in . ! ? ؟ 。 plus Arabic full stop variants.
  const sentences = text.match(/[^.!?؟。\n]+[.!?؟。\n]+["'”»)]*\s*/g)
  if (!sentences) return text.trim() ? [text] : []
  return sentences.map((s) => s.trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Heading path builder
// ---------------------------------------------------------------------------

const buildHeadingPath = (entry: OutlineEntry, ancestors: OutlineEntry[]): string => {
  const path = [...ancestors, entry].map((e) => e.title).filter(Boolean)
  return path.join(" > ")
}

// ---------------------------------------------------------------------------
// Build parents from outline entries.
// ---------------------------------------------------------------------------

interface SectionText {
  entry: OutlineEntry
  text: string
  pageStart: number
  pageEnd: number
  ancestors: OutlineEntry[]
}

const buildSectionsFromOutline = (parseResult: ParseResult): SectionText[] => {
  if (parseResult.outline.length === 0) {
    return [
      {
        entry: { title: undefined, page: 1, level: 1 } as unknown as OutlineEntry,
        text: parseResult.pages.map((p) => p.text).join("\n\n"),
        pageStart: 1,
        pageEnd: parseResult.metadata.pages,
        ancestors: [],
      },
    ]
  }

  // Sort outline by page then by level (parent before child).
  const sorted = [...parseResult.outline].sort((a, b) => a.page - b.page || a.level - b.level)
  const sections: SectionText[] = []

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!
    const ancestors: OutlineEntry[] = []
    // Walk backwards to find ancestors (entries with lower level on the same or earlier page).
    for (let j = i - 1; j >= 0; j--) {
      const prev = sorted[j]!
      if (prev.level < entry.level) {
        ancestors.unshift(prev)
        // Only keep the nearest ancestor at each level.
        break
      }
    }
    // Text between this entry's page and the next entry at the same or lower level.
    const nextEntry = sorted
      .slice(i + 1)
      .find((e) => e.level <= entry.level)
    const pageEnd = nextEntry?.page ?? parseResult.metadata.pages
    const text = parseResult.pages
      .slice(Math.max(0, entry.page - 1), pageEnd)
      .map((p) => p.text)
      .join("\n\n")
    sections.push({
      entry,
      text,
      pageStart: entry.page,
      pageEnd,
      ancestors,
    })
  }

  return sections
}

// ---------------------------------------------------------------------------
// Split a parent section's text into child chunks.
// ---------------------------------------------------------------------------

const splitIntoChildren = (
  text: string,
  sectionId: string,
  bookId: string,
  startOrd: number,
  options: ChunkOptions,
  headingPath: string | undefined,
): ChildChunk[] => {
  const sentences = splitSentences(text)
  const out: ChildChunk[] = []
  let current = ""
  let currentTokens = 0
  let ord = startOrd

  const flush = (page?: number) => {
    if (currentTokens >= options.minChunkTokens) {
      const trimmed = current.trim()
      out.push({
        id: `${sectionId}-c${ord}`,
        bookId,
        sectionId,
        ord,
        page,
        text: trimmed,
        textNorm: trimmed, // Phase 2: caller will run normalizeForSearch
        tokenCount: currentTokens,
        headingPath: options.prependHeadingPath ? headingPath : undefined,
      })
      ord++
    }
    current = ""
    currentTokens = 0
  }

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence)
    if (currentTokens + sentenceTokens > options.childMaxTokens && currentTokens > 0) {
      flush()
    }
    current += sentence + " "
    currentTokens += sentenceTokens
    if (currentTokens >= options.childTargetTokens) {
      flush()
    }
  }
  if (currentTokens > 0) flush()
  return out
}

// ---------------------------------------------------------------------------
// Main chunker
// ---------------------------------------------------------------------------

export const chunk = (
  parseResult: ParseResult,
  bookId: string,
  options: ChunkOptions,
): Effect.Effect<ChunkResult> =>
  Effect.sync(() => {
    const sections: ParentSection[] = []
    const chunks: ChildChunk[] = []
    const sectionTexts = buildSectionsFromOutline(parseResult)

    let sectionOrd = 0
    let chunkOrd = 0
    for (const st of sectionTexts) {
      const sectionId = `${bookId}-s${sectionOrd}`
      const headingPath = options.prependHeadingPath
        ? st.entry.title
          ? buildHeadingPath(st.entry, st.ancestors)
          : undefined
        : undefined

      // Split parent if larger than parentMaxTokens.
      const parentTokens = estimateTokens(st.text)
      const parentSlices: string[] =
        parentTokens > options.parentMaxTokens
          ? sliceByTokens(st.text, options.parentMaxTokens, options.childOverlapTokens)
          : [st.text]

      for (let pIdx = 0; pIdx < parentSlices.length; pIdx++) {
        const parentText = parentSlices[pIdx]!
        const parentId = parentSlices.length > 1 ? `${sectionId}-p${pIdx}` : sectionId
        // Children belong to the parent SLICE row (a section split by parentMaxTokens has no row
        // under its base id, so pointing at it broke the foreign key for every long section).
        const childChunks = splitIntoChildren(
          parentText,
          parentId,
          bookId,
          chunkOrd,
          options,
          headingPath,
        )
        chunks.push(...childChunks)
        sections.push({
          id: parentId,
          bookId,
          parentId: st.ancestors.length > 0 ? `${bookId}-s${sectionOrd - 1}` : undefined,
          level: st.entry.level || 1,
          title: st.entry.title,
          pageStart: st.pageStart,
          pageEnd: st.pageEnd,
          ord: sectionOrd,
          text: parentText,
          headingPath,
          childIds: childChunks.map((c) => c.id),
        })
        chunkOrd += childChunks.length
      }
      sectionOrd++
    }

    return ChunkResult.make({ sections, chunks })
  })

// ---------------------------------------------------------------------------
// Slice a long text into ≤ maxTokens chunks with overlap.
// ---------------------------------------------------------------------------

const sliceByTokens = (text: string, maxTokens: number, overlapTokens: number): string[] => {
  const sentences = splitSentences(text)
  const slices: string[] = []
  let current = ""
  let currentTokens = 0
  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence)
    if (currentTokens + sentenceTokens > maxTokens && currentTokens > 0) {
      slices.push(current.trim())
      // Overlap: keep the last `overlapTokens` worth of sentences.
      const overlap: string[] = []
      let overlapAcc = 0
      for (let i = slices.length - 1; i >= 0; i--) {
        const s = slices[i]!
        const st = estimateTokens(s)
        if (overlapAcc + st > overlapTokens) break
        overlap.unshift(s)
        overlapAcc += st
      }
      current = overlap.join(" ") + " "
      currentTokens = overlapAcc
    }
    current += sentence + " "
    currentTokens += sentenceTokens
  }
  if (currentTokens > 0) slices.push(current.trim())
  return slices
}
