// packages/ui/src/components/citation-chip.tsx
//
// Citation chip — renders a [chunk_id] reference inside an assistant message
// as a micro-interactive badge that opens the cited book passage.
//
// Used by the Targeted Learning feature (plan §9.5, §9.6). The verifier
// (grounding/verifier.ts) checks that every cited chunk_id was retrieved
// or read this turn; this component renders the visual indicator.
//
// Citation format in text: [chunk_id] (e.g. "Photosynthesis [bio-s0-p2-c15] is
// the process by which plants convert sunlight [bio-s0-p3-c7] into glucose.")
//
// The chip shows:
//   - A small book icon + the page number when known ("p.3"), otherwise the
//     chunk ordinal ("c15")
//   - A "verified" / "unverified" / "source-changed" status color
//
// Clicking the chip dispatches the `diveeoi:open-book-citation` window event.
// The session side panel (packages/app) listens for it, opens (or focuses) a
// `book:<bookId>` tab in the session tab strip and shows the book's PDF at the
// cited page with the passage highlighted.

import { Component, For, Show, createMemo, createSignal, onMount, splitProps } from "solid-js"

export interface CitationMeta {
  chunkId: string
  page?: number
  sectionTitle?: string
  bookTitle?: string
  verified?: boolean
  sourceChanged?: boolean
}

/**
 * Resolved chunk metadata used by the citation pills: the small headline (section /
 * heading / book title), the page, and a snippet of the cited passage for the hover
 * preview. Served by POST /targeted-learning/chunks/meta.
 */
export interface CitationChunkInfo {
  chunkId: string
  bookId: string
  bookTitle?: string
  lang?: string
  page?: number
  sectionId?: string
  sectionTitle?: string
  headingPath?: string
  snippet: string
}

// ---------------------------------------------------------------------------
// Chunk metadata bridge.
//
// The ui package has no auth plumbing of its own, so the app registers an
// authenticated fetcher once (see session-side-panel.tsx). Chips enqueue their
// chunk ids; the queue is flushed as one batched request and results are cached
// module-wide so repeated messages never refetch the same chunk. Without a
// registered fetcher the pills simply stay in their compact form.
// ---------------------------------------------------------------------------

export type CitationMetaFetcher = (chunkIds: string[]) => Promise<unknown>

let metaFetcher: CitationMetaFetcher | null = null

/** Register (or clear, with null) the authenticated chunk-meta fetcher. */
export const setCitationMetaFetcher = (fetcher: CitationMetaFetcher | null): void => {
  metaFetcher = fetcher
}

const metaCache = new Map<string, Promise<CitationChunkInfo | null>>()
const pendingResolvers = new Map<string, (info: CitationChunkInfo | null) => void>()
const pendingIds = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | undefined

const flushPending = () => {
  flushTimer = undefined
  const fetcher = metaFetcher
  const ids = [...pendingIds]
  pendingIds.clear()
  if (!fetcher || ids.length === 0) return
  fetcher(ids)
    .then((raw) => {
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { chunks?: unknown })?.chunks)
          ? ((raw as { chunks: unknown[] }).chunks as unknown[])
          : []
      const byId = new Map<string, CitationChunkInfo>()
      for (const item of list) {
        const info = item as CitationChunkInfo
        if (info && typeof info.chunkId === "string" && typeof info.snippet === "string") {
          byId.set(info.chunkId, info)
        }
      }
      for (const id of ids) {
        const resolve = pendingResolvers.get(id)
        pendingResolvers.delete(id)
        resolve?.(byId.get(id) ?? null)
      }
    })
    .catch(() => {
      // Drop the cached promise so a later hover can retry; resolve nothing this round.
      for (const id of ids) {
        const resolve = pendingResolvers.get(id)
        pendingResolvers.delete(id)
        metaCache.delete(id)
        resolve?.(null)
      }
    })
}

/** Fetch (batched, cached) the metadata for one chunk id; null when unavailable. */
const loadChunkInfo = (chunkId: string): Promise<CitationChunkInfo | null> => {
  const cached = metaCache.get(chunkId)
  if (cached) return cached
  const promise = new Promise<CitationChunkInfo | null>((resolve) => {
    pendingResolvers.set(chunkId, resolve)
    pendingIds.add(chunkId)
    if (flushTimer === undefined) flushTimer = setTimeout(flushPending, 30)
  })
  metaCache.set(chunkId, promise)
  return promise
}

/**
 * The pill's small auto-generated headline: what the citation will lead to. Prefers the
 * section's own title, then the last segment of the heading path ("Chapter > Section"),
 * then the book title — all in the book's original language.
 */
export const citationHeadline = (info: {
  sectionTitle?: string
  headingPath?: string
  bookTitle?: string
}): string =>
  info.sectionTitle?.trim() ||
  (info.headingPath
    ? info.headingPath
        .split(">")
        .map((s) => s.trim())
        .filter(Boolean)
        .at(-1) ?? ""
    : "") ||
  info.bookTitle?.trim() ||
  ""

// ---------------------------------------------------------------------------
// Hover preview — the cited passage with its important part highlighted.
// Built imperatively (one implementation shared by the Solid chip and the
// markdown DOM decoration path), positioned with `position: fixed` so message
// overflow containers cannot clip it.
// ---------------------------------------------------------------------------

const contentWords = (value: string): Set<string> =>
  new Set((value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2))

/** Snippet with the sentence most related to the section heading marked up. */
const buildSnippetEl = (snippet: string, heading: string): HTMLElement => {
  const el = document.createElement("div")
  el.className = "citation-preview-snippet"
  const key = contentWords(heading)
  const sentences = snippet.split(/(?<=[.!؟?])\s+/).filter((s) => s.trim().length > 0)
  let bestIdx = -1
  let bestScore = 0
  sentences.forEach((sentence, index) => {
    let score = 0
    for (const word of contentWords(sentence)) if (key.has(word)) score += 1
    if (score > bestScore) {
      bestScore = score
      bestIdx = index
    }
  })
  const markIdx = bestIdx >= 0 ? bestIdx : 0
  sentences.forEach((sentence, index) => {
    if (index === markIdx && sentences.length > 0) {
      const mark = document.createElement("mark")
      mark.className = "citation-preview-mark"
      mark.textContent = sentence
      el.appendChild(mark)
    } else {
      el.appendChild(document.createTextNode(sentence))
    }
    if (index < sentences.length - 1) el.appendChild(document.createTextNode(" "))
  })
  if (el.childNodes.length === 0) el.textContent = snippet
  return el
}

const buildPreviewEl = (info: CitationChunkInfo): HTMLElement => {
  const el = document.createElement("div")
  el.className = "citation-preview"
  el.setAttribute("dir", "auto")
  const heading = info.sectionTitle?.trim() || info.headingPath?.trim() || ""
  const head = document.createElement("div")
  head.className = "citation-preview-head"
  if (info.bookTitle) {
    const book = document.createElement("span")
    book.className = "citation-preview-book"
    book.textContent = info.bookTitle
    head.appendChild(book)
  }
  if (info.page && info.page > 0) {
    const page = document.createElement("span")
    page.className = "citation-preview-page"
    page.textContent = `p. ${info.page}`
    head.appendChild(page)
  }
  if (head.childNodes.length > 0) el.appendChild(head)
  if (heading) {
    const section = document.createElement("div")
    section.className = "citation-preview-section"
    section.textContent = heading
    el.appendChild(section)
  }
  el.appendChild(buildSnippetEl(info.snippet, heading))
  return el
}

/**
 * Attach the hover/focus preview to a chip element (Solid ref or imperative DOM).
 * Returns a cleanup function. Shows after a short delay, hides on leave; removes the
 * native title once the rich preview is available so the two never double up.
 */
export const attachCitationPreview = (chip: HTMLElement, getInfo: () => Promise<CitationChunkInfo | null>): (() => void) => {
  if (typeof document === "undefined") return () => {}
  let preview: HTMLElement | null = null
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let showTimer: ReturnType<typeof setTimeout> | undefined
  const hide = () => {
    if (preview) {
      preview.remove()
      preview = null
    }
  }
  const show = () => {
    void getInfo().then((info) => {
      if (!info || !chip.isConnected) return
      hide()
      preview = buildPreviewEl(info)
      document.body.appendChild(preview)
      const rect = chip.getBoundingClientRect()
      const width = preview.offsetWidth
      const height = preview.offsetHeight
      let left = rect.left + rect.width / 2 - width / 2
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
      let top = rect.bottom + 6
      if (top + height > window.innerHeight - 8) top = rect.top - height - 6
      if (top < 8) top = 8
      preview.style.left = `${Math.round(left)}px`
      preview.style.top = `${Math.round(top)}px`
      chip.removeAttribute("title")
    })
  }
  const onEnter = () => {
    if (hideTimer) clearTimeout(hideTimer)
    if (showTimer) clearTimeout(showTimer)
    showTimer = setTimeout(show, 120)
  }
  const onLeave = () => {
    if (showTimer) clearTimeout(showTimer)
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(hide, 80)
  }
  chip.addEventListener("mouseenter", onEnter)
  chip.addEventListener("focus", onEnter)
  chip.addEventListener("mouseleave", onLeave)
  chip.addEventListener("blur", onLeave)
  return () => {
    if (showTimer) clearTimeout(showTimer)
    if (hideTimer) clearTimeout(hideTimer)
    chip.removeEventListener("mouseenter", onEnter)
    chip.removeEventListener("focus", onEnter)
    chip.removeEventListener("mouseleave", onLeave)
    chip.removeEventListener("blur", onLeave)
    hide()
  }
}

/**
 * Enrich an imperatively-created chip (markdown decoration path) with the small
 * headline and the hover preview once its metadata arrives.
 */
export const enrichCitationChip = (chip: HTMLElement, chunkId: string): void => {
  if (typeof document === "undefined") return
  void loadChunkInfo(chunkId).then((info) => {
    if (!info || !chip.isConnected) return
    const headline = citationHeadline(info)
    if (headline && !chip.querySelector(".citation-chip-title")) {
      const span = document.createElement("span")
      span.className = "citation-chip-title"
      span.textContent = headline
      chip.appendChild(span)
    }
    if (info.page && info.page > 0 && !chip.dataset.pageApplied) {
      chip.dataset.pageApplied = "1"
      const label = chip.querySelector(".citation-chip-label")
      if (label) label.textContent = chunkLabel(chunkId, info.page)
    }
  })
  attachCitationPreview(chip, () => loadChunkInfo(chunkId))
}

export interface CitationChipProps {
  citation: CitationMeta
  onClick?: (chunkId: string) => void
}

/** Event fired on `window` when the user activates a citation chip. */
export const OPEN_BOOK_CITATION_EVENT = "diveeoi:open-book-citation"

/**
 * The book id is the first segment of a chunk id:
 * "bk_1054259ed5844b74-s0-p2-c15" → "bk_1054259ed5844b74".
 */
export const bookIdFromChunkId = (chunkId: string): string => chunkId.split("-s")[0] ?? chunkId

/** Short human label for a chunk id: the page when known, else the chunk ordinal. */
export const chunkLabel = (chunkId: string, page?: number): string => {
  if (page && page > 0) return `p.${page}`
  const m = /-c(\d+)$/.exec(chunkId)
  return m ? `c${m[1]}` : chunkId
}

/**
 * Open the cited passage: dispatches the book-tab event. Safe to call from
 * anywhere in the app. `extra` merges already-resolved chunk metadata (page /
 * book title) into the event detail so the book tab can jump straight to the
 * right page without waiting for the chunk request.
 */
export const openBookCitation = (
  chunkId: string,
  extra?: { page?: number; bookTitle?: string; highlightText?: string },
): void => {
  if (typeof window === "undefined") return
  const detail: { chunkId: string; bookId: string; page?: number; bookTitle?: string; highlightText?: string } = {
    chunkId,
    bookId: bookIdFromChunkId(chunkId),
  }
  if (extra?.page) detail.page = extra.page
  if (extra?.bookTitle) detail.bookTitle = extra.bookTitle
  if (extra?.highlightText) detail.highlightText = extra.highlightText
  window.dispatchEvent(new CustomEvent(OPEN_BOOK_CITATION_EVENT, { detail }))
}

export const CitationChip: Component<CitationChipProps> = (props) => {
  const status = createMemo<"verified" | "unverified" | "sourceChanged" | "unknown">(() => {
    if (props.citation.sourceChanged) return "sourceChanged"
    if (props.citation.verified === false) return "unverified"
    if (props.citation.verified === true) return "verified"
    return "unknown"
  })

  const [info, setInfo] = createSignal<CitationChunkInfo | null>(null)
  let chipRef: HTMLButtonElement | undefined

  onMount(() => {
    if (typeof document === "undefined") return
    void loadChunkInfo(props.citation.chunkId).then((value) => {
      if (value) setInfo(value)
    })
    if (!chipRef) return
    return attachCitationPreview(chipRef, () => loadChunkInfo(props.citation.chunkId))
  })

  const label = createMemo(() => chunkLabel(props.citation.chunkId, props.citation.page ?? info()?.page))

  const headline = createMemo(() => {
    const resolved = info()
    if (!resolved) return props.citation.sectionTitle?.trim() ?? ""
    return citationHeadline({
      sectionTitle: props.citation.sectionTitle ?? resolved.sectionTitle,
      headingPath: resolved.headingPath,
      bookTitle: props.citation.bookTitle ?? resolved.bookTitle,
    })
  })

  const handleClick = () => {
    if (props.onClick) props.onClick(props.citation.chunkId)
    else
      openBookCitation(props.citation.chunkId, {
        page: props.citation.page ?? info()?.page,
        bookTitle: props.citation.bookTitle ?? info()?.bookTitle,
      })
  }

  return (
    <button
      type="button"
      class="citation-chip"
      data-status={status()}
      data-chunk-id={props.citation.chunkId}
      data-book-id={bookIdFromChunkId(props.citation.chunkId)}
      title={props.citation.sectionTitle ?? `Open in book · ${props.citation.chunkId}`}
      aria-label={`Open book citation ${props.citation.chunkId}`}
      ref={chipRef}
      onClick={handleClick}
    >
      <svg
        class="citation-chip-icon"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3.5 4.75A1.75 1.75 0 0 1 5.25 3H9.25v14H5.25a1.75 1.75 0 0 1-1.75-1.75v-10.5ZM10.75 3h4a1.75 1.75 0 0 1 1.75 1.75v10.5A1.75 1.75 0 0 1 14.75 17h-4V3Z"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
      </svg>
      <span class="citation-chip-label">{label()}</span>
      <Show when={headline()}>
        <span class="citation-chip-title" dir="auto">
          {headline()}
        </span>
      </Show>
      <Show when={status() === "unverified"}>
        <span class="citation-chip-flag" title="This citation could not be verified against the retrieved chunks">
          ⚠
        </span>
      </Show>
      <Show when={status() === "sourceChanged"}>
        <span class="citation-chip-flag" title="The source book has been re-indexed since this citation was made">
          ↻
        </span>
      </Show>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Text-with-citations renderer — splits a text string on [chunk_id] patterns
// and interleaves plain text with CitationChip components.
// ---------------------------------------------------------------------------

const CITATION_RE = /\[([a-zA-Z0-9][a-zA-Z0-9_-]*-s\d+(?:-p\d+)?-c\d+)\](?!\()/g

export interface TextWithCitationsProps {
  text: string
  citations?: Map<string, CitationMeta>
  onCitationClick?: (chunkId: string) => void
}

export const TextWithCitations: Component<TextWithCitationsProps> = (props) => {
  const segments = createMemo(() => {
    const parts: Array<{ type: "text"; content: string } | { type: "citation"; chunkId: string }> = []
    let lastEnd = 0
    const re = new RegExp(CITATION_RE.source, "g")
    let match: RegExpExecArray | null
    while ((match = re.exec(props.text)) !== null) {
      if (match.index > lastEnd) {
        parts.push({ type: "text", content: props.text.slice(lastEnd, match.index) })
      }
      parts.push({ type: "citation", chunkId: match[1]! })
      lastEnd = match.index + match[0].length
    }
    if (lastEnd < props.text.length) {
      parts.push({ type: "text", content: props.text.slice(lastEnd) })
    }
    return parts
  })

  return (
    <>
      <For each={segments()}>
        {(seg) => {
          if (seg.type === "citation") {
            return (
              <CitationChip
                citation={props.citations?.get(seg.chunkId) ?? { chunkId: seg.chunkId }}
                onClick={props.onCitationClick}
              />
            )
          }
          return <span>{seg.content}</span>
        }}
      </For>
    </>
  )
}

// Re-export for splitProps consumers (prevents unused-import lint).
export { splitProps }
