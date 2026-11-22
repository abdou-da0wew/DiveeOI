// packages/learning/src/parsers/index.ts
//
// Book parsers (plan §7.2).
//
// Phase 2 implementation (post-Spike-2):
//   - TXT: heading heuristics including Arabic markers (الفصل, الباب, ...)
//   - PDF: pdfjs-dist with positions, fonts, and outline
//   - DOCX: mammoth with heading-style preservation
//
// Arabic text hygiene (plan §7.3) is applied at the chunker level, not here.
// Parsers return the original text; the chunker calls normalizeForSearch
// to produce text_norm for FTS5.
//
// Error-hardening (2026-11-22 sprint): no `catch: () => null` mappers. Failures either
// surface as typed ParseErrors (core content: dependency loads, page loads, text
// extraction) or are recorded as `parsers` diagnostics before a genuinely optional
// fallback applies (outline, metadata, cleanup). This matters because a failed
// `Effect.tryPromise` with a null-catching mapper used to short-circuit the whole
// Effect.gen with a NULL error — the "error":"null" ingest incident (2026-11-09).

import { Effect, Schema } from "effect"
import { logDiagnostic } from "../diagnostics"

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

export const PageText = Schema.Struct({
  page: Schema.Number,
  text: Schema.String,
  boxes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        x: Schema.Number,
        y: Schema.Number,
        w: Schema.Number,
        h: Schema.Number,
        text: Schema.String,
      }),
    ),
  ),
})
export type PageText = Schema.Schema.Type<typeof PageText>

export const OutlineEntry = Schema.Struct({
  title: Schema.String,
  page: Schema.Number,
  level: Schema.Number,
})
export type OutlineEntry = Schema.Schema.Type<typeof OutlineEntry>

export const ParseResult = Schema.Struct({
  pages: Schema.Array(PageText),
  outline: Schema.Array(OutlineEntry),
  language: Schema.optional(Schema.String),
  textDensity: Schema.Number,
  metadata: Schema.Struct({
    title: Schema.optional(Schema.String),
    author: Schema.optional(Schema.String),
    pages: Schema.Number,
  }),
})
export type ParseResult = Schema.Schema.Type<typeof ParseResult>

export class ParseError extends Schema.TaggedErrorClass<ParseError>()("TargetedLearning.ParseError", {
  format: Schema.String,
  message: Schema.String,
}) {}

const describeCause = (cause: unknown): string =>
  (cause instanceof Error ? cause.message : String(cause)).replace(/\s+/g, " ").trim().slice(0, 200)

/**
 * Best-effort promise step for genuinely optional data (PDF outline, metadata, cleanup, …).
 * On failure it records a `parsers` diagnostic carrying the real cause, then succeeds with
 * `fallback` — never a silent null, and never a poisoned error channel (a naive
 * `catch: () => null` mapper fails the surrounding Effect.gen with a null error).
 */
const bestEffort = <A>(
  event: string,
  format: "pdf" | "docx",
  run: () => Promise<A>,
  fallback: A,
  fields: Record<string, unknown> = {},
): Effect.Effect<A, never> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new ParseError({ format, message: describeCause(cause) }),
  }).pipe(
    Effect.tapError((error) => Effect.sync(() => logDiagnostic("parsers", event, { format, ...fields, error }, "warn"))),
    Effect.orElseSucceed(() => fallback),
  )

/**
 * Test seam: the optional parser dependencies are loaded lazily so the parsers degrade
 * gracefully when they are not installed. Tests override these to simulate dependency
 * load failures and runtime failures without real fixtures.
 */
export const parserLoaders = {
  loadPdfjs: (): Promise<typeof import("pdfjs-dist")> => import("pdfjs-dist"),
  loadMammoth: (): Promise<typeof import("mammoth")> => import("mammoth"),
}

// ---------------------------------------------------------------------------
// TXT parser (no deps) — heading heuristics including Arabic markers
// ---------------------------------------------------------------------------

const ARABIC_HEADING_MARKERS = [
  /^الفصل\s+/,
  /^الباب\s+/,
  /^الوحدة\s+/,
  /^الدرس\s+/,
  /^المبحث\s+/,
  /^المطالع\s+/,
  /^القسم\s+/,
]
const ENGLISH_HEADING_MARKERS = [/^chapter\s+\d+/i, /^unit\s+\d+/i, /^lesson\s+\d+/i, /^section\s+\d+/i, /^part\s+\d+/i]

export const parseTxt = (text: string): Effect.Effect<ParseResult, ParseError> =>
  Effect.sync(() => {
    const lines = text.split(/\r?\n/)
    const pages: PageText[] = [{ page: 1, text }]
    const outline: OutlineEntry[] = []
    let currentLevel = 0

    lines.forEach((line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      for (const re of [...ARABIC_HEADING_MARKERS, ...ENGLISH_HEADING_MARKERS]) {
        if (re.test(trimmed)) {
          currentLevel = 1
          outline.push({ title: trimmed, page: 1, level: currentLevel })
          break
        }
      }
      if (currentLevel === 0 && trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
        outline.push({ title: trimmed, page: 1, level: 1 })
      }
    })

    return ParseResult.make({
      pages,
      outline,
      language: undefined,
      textDensity: 1.0,
      metadata: { pages: 1 },
    })
  })

// ---------------------------------------------------------------------------
// PDF parser — uses pdfjs-dist
// ---------------------------------------------------------------------------

export const parsePdf = (data: Uint8Array): Effect.Effect<ParseResult, ParseError> =>
  Effect.gen(function* () {
    // pdfjs-dist is an optional dependency. Its load failure must surface as a typed
    // ParseError carrying the real cause — mapping it to null used to fail this whole
    // effect with a null error and the "not installed" branch below was unreachable.
    const pdfjs = yield* Effect.tryPromise({
      try: () => parserLoaders.loadPdfjs(),
      catch: (cause) =>
        new ParseError({
          format: "pdf",
          message: `pdfjs-dist is not installed or failed to load. Run \`bun add pdfjs-dist\` to enable PDF parsing. Cause: ${describeCause(cause)}`,
        }),
    })

    // Disable workers for Bun compatibility (workers can be flaky in Bun).
    // pdfjs-dist v4.10 renamed `disableWorker` — we cast the params to pass it through.
    const params = {
      data: new Uint8Array(data) as never, // pdfjs detaches the buffer it is given; copy so callers keep theirs
      isEvalSupported: false,
      useSystemFonts: true,
    } as never
    // Add disableWorker via a separate cast to avoid the spread-types error.
    ;(params as { disableWorker: boolean }).disableWorker = true
    const loadingTask = pdfjs.getDocument(params)
    const doc = yield* Effect.tryPromise({
      try: () => loadingTask.promise as Promise<Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>>,
      catch: (err) =>
        new ParseError({
          format: "pdf",
          message: `PDF load failed: ${describeCause(err)}`,
        }),
    })

    const numPages = doc.numPages
    const pages: PageText[] = []
    let totalChars = 0
    let totalPages = 0

    for (let i = 1; i <= numPages; i++) {
      // Page content is core to the parse result. A page load / text extraction failure
      // must surface as a typed ParseError with the page number — it used to either fail
      // the whole parse with a null error (load) or silently drop the page's text
      // (extraction), leaving the book ingested with invisible missing content.
      const page = yield* Effect.tryPromise({
        try: () => doc.getPage(i),
        catch: (err) => new ParseError({ format: "pdf", message: `PDF page ${i} failed to load: ${describeCause(err)}` }),
      })
      const textContent = yield* Effect.tryPromise({
        try: () => page.getTextContent(),
        catch: (err) => new ParseError({ format: "pdf", message: `PDF page ${i} text extraction failed: ${describeCause(err)}` }),
      })

      // Reconstruct text from items, preserving reading order.
      const items = (textContent.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>)
        .filter((item): item is { str: string; transform: number[]; width: number; height: number } =>
          "str" in item && typeof item.str === "string",
        )
        .map((item) => ({
          text: item.str,
          x: item.transform?.[4] ?? 0,
          y: item.transform?.[5] ?? 0,
          w: item.width ?? 0,
          h: item.height ?? 0,
        }))

      // Group items into lines by y-coordinate (within 3px tolerance).
      items.sort((a, b) => b.y - a.y || a.x - b.x)
      const lines: { y: number; items: typeof items }[] = []
      for (const item of items) {
        const lastLine = lines[lines.length - 1]
        if (lastLine && Math.abs(lastLine.y - item.y) < 3) {
          lastLine.items.push(item)
        } else {
          lines.push({ y: item.y, items: [item] })
        }
      }
      for (const line of lines) {
        line.items.sort((a, b) => a.x - b.x)
      }
      const pageText = lines.map((line) => line.items.map((item) => item.text).join(" ")).join("\n")

      pages.push({
        page: i,
        text: pageText,
        boxes: items.map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h, text: item.text })),
      })
      totalChars += pageText.length
      totalPages++
    }

    // Extract outline (bookmarks) if present. Genuinely best-effort: outline failures must
    // not fail the parse, but they are recorded as diagnostics instead of vanishing.
    const outline: OutlineEntry[] = []
    const outlineRaw = yield* bestEffort("parse.outlineFailed", "pdf", () => doc.getOutline(), null)
    if (outlineRaw) {
      for (const entry of outlineRaw) {
        let pageNum = 1
        const dest = entry.dest
        if (typeof dest === "string") {
          const resolved = yield* bestEffort("parse.outlineDestinationFailed", "pdf", () => doc.getDestination(dest), null, {
            title: entry.title,
          })
          if (resolved && resolved[0]) {
            const pageIndex = yield* bestEffort("parse.outlinePageIndexFailed", "pdf", () => doc.getPageIndex(resolved[0] as never), 0, {
              title: entry.title,
            })
            pageNum = pageIndex + 1
          }
        } else if (Array.isArray(dest) && dest[0]) {
          const pageIndex = yield* bestEffort("parse.outlinePageIndexFailed", "pdf", () => doc.getPageIndex(dest[0] as never), 0, {
            title: entry.title,
          })
          pageNum = pageIndex + 1
        }
        outline.push({ title: entry.title, page: pageNum, level: 1 })
      }
    }

    // Metadata is best-effort (recorded as a diagnostic when extraction fails).
    let title: string | undefined
    let author: string | undefined
    const meta = yield* bestEffort("parse.metadataFailed", "pdf", () => doc.getMetadata(), null)
    const info = meta?.info as Record<string, unknown> | undefined
    if (info) {
      if (typeof info.Title === "string") title = info.Title
      if (typeof info.Author === "string") author = info.Author
    }

    // Text density: chars per page. Pages below ~100 chars are likely scanned.
    const avgCharsPerPage = totalPages > 0 ? totalChars / totalPages : 0
    const textDensity = Math.min(1, avgCharsPerPage / 1000)

    // Resource cleanup is best-effort: a dispose failure must never destroy a finished
    // parse (it used to fail the whole effect with an `undefined` error value).
    yield* bestEffort<void>("parse.cleanupFailed", "pdf", () => doc.cleanup(), undefined)
    yield* bestEffort<void>("parse.destroyFailed", "pdf", () => doc.destroy(), undefined)

    return ParseResult.make({
      pages,
      outline,
      language: undefined,
      textDensity,
      metadata: { title, author, pages: numPages },
    })
  })

// ---------------------------------------------------------------------------
// DOCX parser — uses mammoth
// ---------------------------------------------------------------------------

export const parseDocx = (data: Uint8Array): Effect.Effect<ParseResult, ParseError> =>
  Effect.gen(function* () {
    // mammoth is an optional dependency; its load failure surfaces as a typed ParseError
    // carrying the real cause (see the pdfjs note above for the null-channel history).
    const mammoth = yield* Effect.tryPromise({
      try: () => parserLoaders.loadMammoth(),
      catch: (cause) =>
        new ParseError({
          format: "docx",
          message: `mammoth is not installed or failed to load. Run \`bun add mammoth\` to enable DOCX parsing. Cause: ${describeCause(cause)}`,
        }),
    })

    // Convert to HTML, then walk the heading styles to build the outline.
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    const htmlResult = yield* Effect.tryPromise({
      try: () => mammoth.convertToHtml({ arrayBuffer }),
      catch: (err) => new ParseError({ format: "docx", message: `DOCX parse failed: ${describeCause(err)}` }),
    })
    const html = htmlResult.value
    // Raw text is what gets chunked — it is core content, so its failure surfaces as a
    // typed ParseError instead of silently producing an empty-text book.
    const textResult = yield* Effect.tryPromise({
      try: () => mammoth.extractRawText({ arrayBuffer }),
      catch: (err) => new ParseError({ format: "docx", message: `DOCX text extraction failed: ${describeCause(err)}` }),
    })
    const rawText = textResult.value

    // Walk HTML to extract headings (h1-h6).
    const outline: OutlineEntry[] = []
    const headingRe = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi
    let match: RegExpExecArray | null
    while ((match = headingRe.exec(html)) !== null) {
      const level = parseInt(match[1]!, 10)
      const titleText = match[2]!.replace(/<[^>]+>/g, "").trim()
      if (titleText) {
        outline.push({ title: titleText, page: 1, level })
      }
    }

    const pages: PageText[] = [{ page: 1, text: rawText }]
    const textDensity = Math.min(1, rawText.length / 1000)

    return ParseResult.make({
      pages,
      outline,
      language: undefined,
      textDensity,
      metadata: { pages: 1 },
    })
  })

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export const parse = (
  data: Uint8Array,
  format: "pdf" | "docx" | "txt",
): Effect.Effect<ParseResult, ParseError> => {
  switch (format) {
    case "txt":
      return parseTxt(new TextDecoder().decode(data))
    case "pdf":
      return parsePdf(data)
    case "docx":
      return parseDocx(data)
  }
}
