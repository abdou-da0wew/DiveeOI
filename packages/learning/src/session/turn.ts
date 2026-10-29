// packages/learning/src/session/turn.ts
//
// Everything the session prompt loop needs from Targeted Learning, as plain async
// functions (no Effect requirements), so session/prompt.ts only adds three small hooks:
//
//   attachBookMentions()  – resolve @book: mentions → session metadata (sticky targeted mode)
//   prepareTargetedTurn() – pre-retrieval + gate + grounding prompt for one user turn
//
// A refused gate returns a hardcoded message and the caller never calls the LLM (plan §8.3).

import { Effect } from "effect"
import { getRuntime } from "../runtime"
import { ensureEmbedder } from "../embed/ensure"
import { embed } from "../embed/pipeline"
import { retrieve, type Candidate } from "../retrieve/hybrid"
import { withDefaults } from "../settings/defaults"
import { buildGroundingPrompt } from "../grounding/prompt-rules"
import { recordRetrieved, resetRetrieved } from "../grounding/turn-state"
import { relevantBookNotes, studentProfileBlock } from "../memory/service"

type Tree = Record<string, unknown>

export interface BookRef {
  id: string
  slug: string
  title: string
  lang: string | null
}

export interface TargetedMeta {
  mode: "targeted"
  bookIds: string[]
  books: BookRef[]
  missing?: string[]
}

const BOOK_MENTION_RE = /@book:(?:"([^"]+)"|'([^']+)'|id:([a-zA-Z0-9_-]+)|([a-zA-Z0-9_-]+))/g

export const extractMentionTokens = (text: string): { kind: "title" | "id" | "slug"; value: string }[] => {
  const out: { kind: "title" | "id" | "slug"; value: string }[] = []
  for (const m of text.matchAll(BOOK_MENTION_RE)) {
    if (m[1] ?? m[2]) out.push({ kind: "title", value: (m[1] ?? m[2])! })
    else if (m[3]) out.push({ kind: "id", value: m[3] })
    else if (m[4]) out.push({ kind: "slug", value: m[4] })
  }
  return out
}

const isArabic = (text: string) => {
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  return letters > 0 && (text.match(/[\u0600-\u06FF]/g)?.length ?? 0) / letters > 0.4
}

/**
 * Resolve the @book: mentions in a user message and merge them into the session's
 * targeted-learning metadata. Returns null when the message mentions no book.
 */
export const attachBookMentions = async (
  text: string,
  existing: Partial<TargetedMeta> | undefined,
): Promise<TargetedMeta | null> => {
  const tokens = extractMentionTokens(text)
  if (tokens.length === 0) return null
  const runtime = getRuntime()
  if (!runtime) return null // feature disabled: @book: stays plain text
  const db = runtime?.booksStore.available ? runtime.booksStore.db : null
  const found = new Map<string, BookRef>((existing?.books ?? []).map((b) => [b.id, b]))
  const missing: string[] = []
  if (!db) {
    return {
      mode: "targeted",
      bookIds: [...found.keys()],
      books: [...found.values()],
      missing: tokens.map((t) => t.value),
    }
  }
  for (const t of tokens) {
    const row =
      t.kind === "title"
        ? await db.get<any>(
            "SELECT id, slug, title, lang, status FROM books WHERE lower(title) = lower(?) OR slug = ?",
            t.value,
            t.value,
          )
        : t.kind === "id"
          ? await db.get<any>("SELECT id, slug, title, lang, status FROM books WHERE id = ?", t.value)
          : await db.get<any>("SELECT id, slug, title, lang, status FROM books WHERE slug = ? OR id = ?", t.value, t.value)
    if (!row || row.status !== "ready") {
      missing.push(row ? `${row.title} (not indexed yet)` : t.value)
      continue
    }
    found.set(row.id, { id: row.id, slug: row.slug, title: row.title, lang: row.lang ?? null })
  }
  if (found.size === 0 && !existing?.bookIds?.length) {
    // Nothing resolvable and no earlier books: stay a normal session but report the miss.
    return { mode: "targeted", bookIds: [], books: [], missing }
  }
  return { mode: "targeted", bookIds: [...found.keys()], books: [...found.values()], missing }
}

export interface TurnPrep {
  /** Extra system prompt blocks (grounding rules + retrieved context). */
  system: string[]
  /** When set, answer with exactly this text and do not call the LLM. */
  refusal?: string
  decision: "pass" | "small-talk" | "refused" | "library-unavailable" | "not-ready"
}

const MAX_CHARS_PER_TOKEN = 4

const formatContext = (candidates: readonly Candidate[], titles: Map<string, string>, maxTokens: number) => {
  const lines: string[] = []
  const seenParents = new Set<string>()
  let used = 0
  const cap = maxTokens * MAX_CHARS_PER_TOKEN
  for (const c of candidates) {
    let block = `[${c.chunkId}] ${titles.get(c.bookId) ?? ""}${c.page ? `, p. ${c.page}` : ""}\n${c.text}`
    if (c.parent && !seenParents.has(c.parent.id)) {
      seenParents.add(c.parent.id)
      block += `\n(Section${c.parent.headingPath ? `: ${c.parent.headingPath}` : ""})\n${c.parent.text}`
    }
    if (used + block.length > cap && lines.length > 0) break
    lines.push(block)
    used += block.length
  }
  return lines.join("\n\n---\n\n")
}

export const prepareTargetedTurn = async (input: {
  meta: TargetedMeta
  query: string
  recentUserTurns: string[]
  settings?: Tree
  sessionId?: string
  /** Test seams; default to the real embedder. */
  ensureFn?: () => Promise<boolean>
  embedFn?: (query: string) => Promise<Float32Array | null>
}): Promise<TurnPrep> => {
  const settings = withDefaults(input.settings)
  const gate = (settings.gate ?? {}) as Tree
  const ret = (settings.retrieval ?? {}) as Tree
  const grounding = (settings.grounding ?? {}) as Tree
  const refusalMessages = (gate.refusalMessages ?? {}) as Record<string, string>
  const lang: "ar" | "en" = isArabic(input.query) ? "ar" : "en"
  if (input.sessionId) resetRetrieved(input.sessionId)
  const refuse = (decision: TurnPrep["decision"], message: string): TurnPrep => ({ system: [], refusal: message, decision })

  const runtime = getRuntime()
  if (!runtime?.booksStore.available || !runtime.booksStore.db) {
    return refuse(
      "library-unavailable",
      lang === "ar"
        ? "مكتبة الكتب غير متاحة حاليًا. تحقق من الإعدادات > التعلّم الموجّه."
        : "The book library is unavailable right now. Check Settings > Targeted Learning.",
    )
  }
  if (input.meta.bookIds.length === 0) {
    return refuse(
      "not-ready",
      lang === "ar"
        ? "لا يوجد كتاب جاهز في هذه الجلسة. أضف كتابًا مفهرسًا بـ @book:."
        : "No indexed book is attached to this session. Attach one with @book:.",
    )
  }

  const ready = input.ensureFn
    ? await input.ensureFn()
    : await Effect.runPromise(
        ensureEmbedder(input.settings).pipe(
          Effect.map(() => true),
          Effect.orElseSucceed(() => false),
        ),
      )
  if (!ready) {
    return refuse(
      "not-ready",
      lang === "ar"
        ? "نموذج التعلّم الموجّه غير جاهز. افتح الإعدادات > التعلّم الموجّه وشغّل «Start Setup»."
        : "The Targeted Learning model isn't ready. Open Settings > Targeted Learning and run Start Setup.",
    )
  }

  if (input.query.trim().length === 0) {
    return {
      system: [
        buildGroundingPrompt({ bookTitles: input.meta.books.map((b) => b.title), language: lang, refusalMessages }),
        "The student only attached the book(s). Greet them briefly and ask what they want to study. State no facts.",
        ...(studentProfileBlock(input.settings) ? [studentProfileBlock(input.settings)!] : []),
      ],
      decision: "small-talk",
    }
  }

  const queryVec = input.embedFn
    ? await input.embedFn(input.query)
    : await Effect.runPromise(embed(input.query).pipe(Effect.orElseSucceed(() => null)))
  const result = await Effect.runPromise(
    retrieve(
      runtime.booksStore.db,
      {
        bookIds: input.meta.bookIds,
        query: input.query,
        bm25TopK: Number(ret.bm25TopK ?? 30),
        denseTopK: Number(ret.denseTopK ?? 30),
        rrfK: Number(ret.rrfK ?? 60),
        weightBm25: Number(ret.weightBm25 ?? 1),
        weightDense: Number(ret.weightDense ?? 1),
        autoWeightByLanguage: ret.autoWeightByLanguage !== false,
        finalTopK: Number(ret.finalTopK ?? 8),
        parentExpansion: ret.parentExpansion !== false,
        parentContextMaxTokens: Number(ret.parentContextMaxTokens ?? 2500),
        queryRewrite: (ret.queryRewrite as "heuristic" | "llm" | "off") ?? "heuristic",
        rewriteTurns: Number(ret.rewriteTurns ?? 2),
        recentUserTurns: input.recentUserTurns,
        gate: {
          enabled: gate.enabled !== false,
          minDenseScore: Number(gate.minDenseScore ?? 0.35),
          minFusedScore: Number(gate.minFusedScore ?? 0.1),
          allowSmallTalk: gate.allowSmallTalk !== false,
          language: lang,
          libraryAvailable: true,
          refusalMessages,
        },
      },
      queryVec,
    ),
  )

  if (result.gateDecision === "refused" || result.gateDecision === "library-unavailable") {
    return refuse(
      result.gateDecision,
      refusalMessages[lang] ?? "This isn't covered in the selected book(s).",
    )
  }

  const titles = new Map(input.meta.books.map((b) => [b.id, b.title]))
  const system = [
    buildGroundingPrompt({
      bookTitles: input.meta.books.map((b) => b.title),
      language: lang,
      refusalMessages,
    }),
  ]
  if (input.meta.missing?.length) {
    system.push(`The student mentioned books that are not available: ${input.meta.missing.join(", ")}. Tell them briefly.`)
  }
  const profile = studentProfileBlock(input.settings)
  if (profile) system.push(profile)
  if (input.sessionId) recordRetrieved(input.sessionId, result.candidates.map((c) => c.chunkId))
  if (result.gateDecision === "small-talk") {
    system.push("This message is small talk. Reply briefly and warmly and offer to help with the attached book(s). State no facts.")
  } else {
    const notes = await relevantBookNotes({
      db: runtime.booksStore.db,
      bookIds: input.meta.bookIds,
      query: input.query,
      queryVec,
      settings: input.settings,
    })
    if (notes) system.push(notes)
    const context = formatContext(result.candidates, titles, Number(grounding.maxContextTokens ?? 6000))
    system.push(
      `<book_context>\nPassages retrieved for this question. Cite them as [chunk_id]. Use ONLY these passages and tool results for facts.\n\n${context}\n</book_context>`,
    )
  }
  return { system, decision: result.gateDecision === "small-talk" ? "small-talk" : "pass" }
}

// ---------------------------------------------------------------------------
// Retrieval inspector (plan §8.6): what would the gate do with this question?
// ---------------------------------------------------------------------------

export interface InspectResult {
  decision: string
  lang: "ar" | "en"
  bestDenseScore: number
  bestFusedScore: number
  thresholds: { minDenseScore: number; minFusedScore: number }
  candidates: { chunkId: string; bookId: string; page?: number; denseScore?: number; fusedScore: number; snippet: string }[]
  note?: string
}

export const inspectRetrieval = async (input: {
  query: string
  bookIds?: string[]
  recentUserTurns?: string[]
  settings?: Tree
  /** Test seams. */
  ensureFn?: () => Promise<boolean>
  embedFn?: (query: string) => Promise<Float32Array | null>
}): Promise<InspectResult> => {
  const settings = withDefaults(input.settings)
  const gate = (settings.gate ?? {}) as Tree
  const ret = (settings.retrieval ?? {}) as Tree
  const lang: "ar" | "en" = isArabic(input.query) ? "ar" : "en"
  const thresholds = { minDenseScore: Number(gate.minDenseScore ?? 0.35), minFusedScore: Number(gate.minFusedScore ?? 0.1) }
  const empty = (decision: string, note: string): InspectResult => ({
    decision,
    lang,
    bestDenseScore: 0,
    bestFusedScore: 0,
    thresholds,
    candidates: [],
    note,
  })
  const runtime = getRuntime()
  if (!runtime?.booksStore.available || !runtime.booksStore.db) return empty("library-unavailable", "books.db is not available")
  const db = runtime.booksStore.db
  let bookIds = input.bookIds ?? []
  if (bookIds.length === 0) bookIds = (await db.all<{ id: string }>("SELECT id FROM books WHERE status = 'ready'")).map((r) => r.id)
  if (bookIds.length === 0) return empty("not-ready", "no indexed books")
  const ready = input.ensureFn
    ? await input.ensureFn()
    : await Effect.runPromise(ensureEmbedder(input.settings).pipe(Effect.map(() => true), Effect.orElseSucceed(() => false)))
  if (!ready) return empty("not-ready", "the embedding model is not ready (run Start Setup)")
  const queryVec = input.embedFn
    ? await input.embedFn(input.query)
    : await Effect.runPromise(embed(input.query).pipe(Effect.orElseSucceed(() => null)))
  const result = await Effect.runPromise(
    retrieve(
      db,
      {
        bookIds,
        query: input.query,
        bm25TopK: Number(ret.bm25TopK ?? 30),
        denseTopK: Number(ret.denseTopK ?? 30),
        rrfK: Number(ret.rrfK ?? 60),
        weightBm25: Number(ret.weightBm25 ?? 1),
        weightDense: Number(ret.weightDense ?? 1),
        autoWeightByLanguage: ret.autoWeightByLanguage !== false,
        finalTopK: Number(ret.finalTopK ?? 8),
        parentExpansion: false,
        parentContextMaxTokens: Number(ret.parentContextMaxTokens ?? 2500),
        queryRewrite: (ret.queryRewrite as "heuristic" | "llm" | "off") ?? "heuristic",
        rewriteTurns: Number(ret.rewriteTurns ?? 2),
        recentUserTurns: input.recentUserTurns ?? [],
        debug: true,
        gate: {
          enabled: gate.enabled !== false,
          minDenseScore: thresholds.minDenseScore,
          minFusedScore: thresholds.minFusedScore,
          allowSmallTalk: gate.allowSmallTalk !== false,
          language: lang,
          libraryAvailable: true,
          refusalMessages: (gate.refusalMessages ?? {}) as Record<string, string>,
        },
      },
      queryVec,
    ),
  )
  return {
    decision: result.gateDecision,
    lang,
    bestDenseScore: result.bestDenseScore ?? 0,
    bestFusedScore: result.bestFusedScore ?? 0,
    thresholds,
    candidates: (result.ungatedCandidates ?? result.candidates).slice(0, 5).map((c) => ({
      chunkId: c.chunkId,
      bookId: c.bookId,
      page: c.page ?? undefined,
      denseScore: c.denseScore,
      fusedScore: c.fusedScore,
      snippet: c.text.slice(0, 160),
    })),
    note: result.gateReason,
  }
}
