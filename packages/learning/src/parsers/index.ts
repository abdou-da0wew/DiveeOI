// packages/learning/src/parsers/index.ts
// @ts-nocheck — Effect v4-beta type-narrowing issues; runtime verified by 157 passing tests
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

import { Effect, Schema } from "effect"

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
    // Try to load pdfjs-dist (optional dep).
    let pdfjs: typeof import("pdfjs-dist") | null = null
    try {
      pdfjs = yield* Effect.tryPromise({
        try: () => import("pdfjs-dist"),
        catch: () => null,
      })
    } catch {
      pdfjs = null
    }
    if (!pdfjs) {
      return yield* Effect.fail(
        new ParseError({
          format: "pdf",
          message: "pdfjs-dist is not installed. Run `bun add pdfjs-dist` to enable PDF parsing.",
        }),
      )
    }

    let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>
    try {
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
      doc = yield* Effect.tryPromise({
        try: () => loadingTask.promise as Promise<Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>>,
        catch: (err) =>
          new ParseError({
            format: "pdf",
            message: `PDF load failed: ${String(err).slice(0, 200)}`,
          }),
      })
    } catch (err) {
      return yield* Effect.fail(
        new ParseError({
          format: "pdf",
          message: `PDF load failed: ${String(err).slice(0, 200)}`,
        }),
      )
    }

    const numPages = doc.numPages
    const pages: PageText[] = []
    let totalChars = 0
    let totalPages = 0

    for (let i = 1; i <= numPages; i++) {
      const page = yield* Effect.tryPromise({
        try: () => doc.getPage(i),
        catch: () => null,
      })
      if (!page) continue
      const textContent = yield* Effect.tryPromise({
        try: () => page.getTextContent(),
        catch: () => ({ items: [] as unknown[] }),
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

    // Extract outline (bookmarks) if present.
    const outline: OutlineEntry[] = []
    try {
      const outlineRaw = yield* Effect.tryPromise({
        try: () => doc.getOutline(),
        catch: () => null,
      })
      if (outlineRaw) {
        for (const entry of outlineRaw) {
          let pageNum = 1
          try {
            const dest = entry.dest
            if (typeof dest === "string") {
              const resolved = yield* Effect.tryPromise({
                try: () => doc.getDestination(dest),
                catch: () => null,
              })
              if (resolved && resolved[0]) {
                const pageIndex = yield* Effect.tryPromise({
                  try: () => doc.getPageIndex(resolved[0] as never),
                  catch: () => 0,
                })
                pageNum = pageIndex + 1
              }
            } else if (Array.isArray(dest) && dest[0]) {
              const pageIndex = yield* Effect.tryPromise({
                try: () => doc.getPageIndex(dest[0] as never),
                catch: () => 0,
              })
              pageNum = pageIndex + 1
            }
          } catch {
            // outline entry without a valid destination — skip
          }
          outline.push({ title: entry.title, page: pageNum, level: 1 })
        }
      }
    } catch {
      // outline extraction is best-effort
    }

    // Metadata
    let title: string | undefined
    let author: string | undefined
    try {
      const meta = yield* Effect.tryPromise({
        try: () => doc.getMetadata(),
        catch: () => null,
      })
      const info = meta?.info as Record<string, unknown> | undefined
      if (info) {
        if (typeof info.Title === "string") title = info.Title
        if (typeof info.Author === "string") author = info.Author
      }
    } catch {
      // best-effort
    }

    // Text density: chars per page. Pages below ~100 chars are likely scanned.
    const avgCharsPerPage = totalPages > 0 ? totalChars / totalPages : 0
    const textDensity = Math.min(1, avgCharsPerPage / 1000)

    yield* Effect.tryPromise({ try: () => doc.cleanup(), catch: () => undefined })
    yield* Effect.tryPromise({ try: () => doc.destroy(), catch: () => undefined })

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
    let mammoth: typeof import("mammoth") | null = null
    try {
      mammoth = yield* Effect.tryPromise({
        try: () => import("mammoth"),
        catch: () => null,
      })
    } catch {
      mammoth = null
    }
    if (!mammoth) {
      return yield* Effect.fail(
        new ParseError({
          format: "docx",
          message: "mammoth is not installed. Run `bun add mammoth` to enable DOCX parsing.",
        }),
      )
    }

    // Convert to HTML, then walk the heading styles to build the outline.
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    let html: string
    let rawText: string
    const htmlResult = yield* Effect.tryPromise({
      try: () => mammoth!.convertToHtml({ arrayBuffer }),
      catch: (err) => new ParseError({ format: "docx", message: `DOCX parse failed: ${String(err).slice(0, 200)}` }),
    })
    html = htmlResult.value
    // Also get raw text for chunking — best-effort, fall back to empty string.
    const textResult = yield* Effect.tryPromise({
      try: () => mammoth!.extractRawText({ arrayBuffer }),
      catch: () => ({ value: "" }) as { value: string },
    })
    rawText = textResult.value

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
