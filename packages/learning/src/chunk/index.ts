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
import { normalizeForSearch } from "../lang/arabic"

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

// Digits that can appear inside a numeric run (Latin + Arabic-Indic +
// Extended Arabic-Indic). A "." between two digits is a decimal point,
// never a sentence boundary.
const DIGIT_RUN = "0-9\u0660-\u0669\u06F0-\u06F9"

const splitSentences = (text: string): string[] => {
  // Match sentences ending in . ! ? ؟ 。 plus Arabic full stop variants.
  // Bug #11: a "." inside a digit run ("3.5", "v3.5.1", an Arabic-Indic
  // decimal OCR'd with a Latin dot) must NOT end the sentence — the naive
  // splitter cut the number into "3." + "5", mangling the figure in the
  // extracted chunk and feeding wrong numbers into Arabic numeric answers.
  //   1. body runs may be resumed across digit-attached dots:  body (\.(?=digit) body)*
  //   2. the closing terminator run is only consumed when NOT followed by a
  //      digit, or when it contains a real boundary char (؟ ! 。 newline);
  //      it is optional so an unterminated trailing sentence is kept
  //      (the old regex silently DROPPED trailing text without a final ".").
  const sentences = text.match(
    new RegExp(
      `[^.!?؟。\\n]+(?:\\.(?=[${DIGIT_RUN}])[^.!?؟。\\n]+)*(?:[.!?؟。\\n]+(?![${DIGIT_RUN}])|[!?؟。\\n]+(?=[${DIGIT_RUN}]))?["'”»)]*\\s*`,
      "g",
    ),
  )
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
  const pages = parseResult.pages
  if (parseResult.outline.length === 0) {
    return [
      {
        entry: { title: undefined, page: 1, level: 1 } as unknown as OutlineEntry,
        text: pages.map((p) => p.text).join("\n\n"),
        pageStart: 1,
        pageEnd: parseResult.metadata.pages,
        ancestors: [],
      },
    ]
  }

  // Absolute character offset of each page's text inside the page stream (the
  // same "\n\n" join used to build section text below). Offsets are what let
  // same-page outline entries split the page text BETWEEN headings instead of
  // each claiming the whole page (Bug #2, 2026-11-09 RSS → 15.8 GB).
  const pageStarts: number[] = []
  let streamEnd = 0
  for (const page of pages) {
    pageStarts.push(streamEnd)
    streamEnd += page.text.length
  }
  const pageStartAbs = (pageNo: number): number | null =>
    pageNo >= 1 && pageNo <= pages.length ? pageStarts[pageNo - 1]! : null
  const pageEndAbs = (pageNo: number): number | null =>
    pageNo >= 1 && pageNo <= pages.length ? pageStarts[pageNo - 1]! + pages[pageNo - 1]!.text.length : null

  // Locate a heading on its own page: exact match first, then whitespace-flexible
  // (PDF/DOCX headings wrap across lines, so a bookmark like "Chapter 3 Advanced
  // Topics" may be extracted as "Chapter 3\nAdvanced Topics"). Returns null when
  // the heading text cannot be located — the caller then keeps the legacy
  // whole-page range for that boundary (safe: real TXT/DOCX headings are exact
  // trimmed lines, so the unfindable case is bounded to odd PDF bookmarks).
  const findHeadingOnPage = (
    title: string,
    pageNo: number,
    fromAbs: number,
  ): { index: number; length: number } | null => {
    const trimmed = title.trim()
    if (!trimmed) return null
    const idx = pageNo - 1
    if (idx < 0 || idx >= pages.length) return null
    const pageText = pages[idx]!.text
    const localFrom = Math.max(0, Math.min(fromAbs - pageStarts[idx]!, pageText.length))
    const exact = pageText.indexOf(trimmed, localFrom)
    if (exact >= 0) return { index: pageStarts[idx]! + exact, length: trimmed.length }
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
    if (!escaped) return null
    const re = new RegExp(escaped, "g")
    re.lastIndex = localFrom
    const match = re.exec(pageText)
    if (match && match[0].length > 0) return { index: pageStarts[idx]! + match.index, length: match[0].length }
    return null
  }

  // Sort by page only (stable sort — same-page entries keep their document
  // order). Splitting a page between headings needs monotonic document order;
  // the previous `a.level - b.level` tiebreak regrouped same-page entries by
  // level, which made heading offsets non-monotonic for hierarchical DOCX
  // outlines (h2 sections interleaved between h1 siblings) and broke tiling.
  const sorted = [...parseResult.outline].sort((a, b) => a.page - b.page)

  // Pass 1: absolute offset of every heading. The search floor advances past
  // each located heading so duplicate titles (TOC lines, repeated headings)
  // walk forward instead of re-matching the same occurrence.
  const headingAt: (number | null)[] = []
  let searchFloor = 0
  for (const entry of sorted) {
    const ownPage = Math.max(1, entry.page)
    const pageStart = pageStartAbs(ownPage)
    if (pageStart === null) {
      headingAt.push(null)
      continue
    }
    const found = findHeadingOnPage(entry.title, ownPage, Math.max(pageStart, searchFloor))
    headingAt.push(found ? found.index : null)
    if (found) searchFloor = found.index + Math.max(1, found.length)
  }

  // Concatenate page text over an absolute [startAbs, endAbs) range, joining
  // whole and partial pages with "\n\n" exactly like the previous whole-page
  // slice(...).map(p => p.text).join("\n\n") did — ranges aligned to page
  // boundaries produce byte-identical text to the old implementation.
  const textOverRange = (startAbs: number, endAbs: number): string => {
    if (endAbs <= startAbs) return ""
    const parts: string[] = []
    for (let i = 0; i < pages.length; i++) {
      const start = pageStarts[i]!
      const end = start + pages[i]!.text.length
      if (end <= startAbs) continue
      if (start >= endAbs) break
      parts.push(pages[i]!.text.slice(Math.max(startAbs, start) - start, Math.min(endAbs, end) - start))
    }
    return parts.join("\n\n")
  }

  const sections: SectionText[] = []

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!
    // Walk backwards to find ancestors (entries with lower level on the same or earlier page).
    const ancestors: OutlineEntry[] = []
    for (let j = i - 1; j >= 0; j--) {
      const prev = sorted[j]!
      if (prev.level < entry.level) {
        ancestors.unshift(prev)
        // Only keep the nearest ancestor at each level.
        break
      }
    }
    // Text between this entry's page and the next entry at the same or lower level.
    let boundIdx = -1
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j]!.level <= entry.level) {
        boundIdx = j
        break
      }
    }
    const nextEntry = boundIdx >= 0 ? sorted[boundIdx] : undefined
    const pageEnd = nextEntry?.page ?? parseResult.metadata.pages

    // pageStart/pageEnd keep their whole-page meaning (they feed the section
    // rows). The default text range is the same page span this function always
    // produced, so genuine multi-page PDF outlines are byte-identical.
    const ownPage = Math.max(1, entry.page)
    const startAbs = pageStartAbs(ownPage)
    let textStart: number
    let textEnd: number
    if (startAbs === null) {
      // Outline page beyond the parsed pages: the old slice() yielded "".
      textStart = streamEnd
      textEnd = streamEnd
    } else {
      textStart = startAbs
      textEnd =
        pageEnd >= 1 && pageEnd <= pages.length
          ? pageEndAbs(pageEnd)!
          : pageEnd > pages.length
            ? streamEnd
            : textStart // pageEnd < 1 → empty range, like slice(x, ≤0)
      // Bug #2 fix: outlines whose entries share one page (TXT/DOCX parsers
      // stamp every heading with `page: 1` on a single whole-book page) used to
      // hand the ENTIRE page to EVERY heading — O(headings × bookSize) section
      // text, the RSS-spike profile. When a boundary heading sits on the same
      // page as this entry, split the page text BETWEEN the two headings:
      // heading i owns the text from its own position to the next bounding
      // heading's position. Unfindable headings keep the legacy page range.
      const ownHeading = headingAt[i]!
      if (i > 0 && sorted[i - 1]!.page === entry.page && ownHeading !== null && ownHeading > textStart) {
        textStart = ownHeading
      }
      if (nextEntry && nextEntry.page === entry.page) {
        const boundHeading = headingAt[boundIdx]!
        if (boundHeading !== null && boundHeading > textStart) textEnd = boundHeading
      }
      if (textEnd < textStart) textEnd = textStart
    }

    sections.push({
      entry,
      text: textOverRange(textStart, textEnd),
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

  const flush = (page?: number, force = false) => {
    if (currentTokens >= options.minChunkTokens || (force && currentTokens > 0)) {
      const trimmed = current.trim()
      out.push({
        id: `${sectionId}-c${ord}`,
        bookId,
        sectionId,
        ord,
        page,
        text: trimmed,
        // text_norm feeds chunks_fts (store/schema.ts triggers) and FTS5 BM25.
        // The search layer (retrieve/hybrid.ts) normalizes queries through
        // normalizeForSearch, so the index MUST hold the same normalized form
        // (diacritics/tatweel stripped, alef/ya/ta-marbuta unified) or Arabic
        // queries never lexically match (#11 → #4). Display text above stays
        // byte-identical to the source; the reversed-run repair, when enabled,
        // belongs to this search norm only, never to `text`.
        textNorm: normalizeForSearch(trimmed),
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
  if (currentTokens > 0) {
    // A non-empty section must yield at least one child chunk: minChunkTokens
    // guards against micro-fragments when SPLITTING long text, not against a
    // section's only content. With the Bug #2 fix a short chapter is its own
    // section — silently dropping it made small outline-driven books fail to
    // ingest ("The book produced no indexable passages"). The rescue only
    // applies when nothing was emitted yet; trailing runts of already-chunked
    // sections are still dropped as before.
    flush(undefined, out.length === 0)
  }
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
