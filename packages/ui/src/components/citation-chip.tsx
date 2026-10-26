// packages/ui/src/components/citation-chip.tsx
//
// Citation chip — renders a [chunk_id] reference inside an assistant message
// as a clickable badge that links back to the source chunk.
//
// Used by the Targeted Learning feature (plan §9.5, §9.6). The verifier
// (grounding/verifier.ts) checks that every cited chunk_id was retrieved
// or read this turn; this component renders the visual indicator.
//
// Citation format in text: [chunk_id] (e.g. "Photosynthesis [bio-c1] is the
// process by which plants convert sunlight [bio-c2] into glucose.")
//
// The chip shows:
//   - The chunk ID (truncated)
//   - A page number if available (passed via props.citations map)
//   - A "verified" / "unverified" / "source-changed" status color
//
// Clicking the chip opens the source chunk in the retrieval inspector
// (Phase 5 task — for now, the chip is display-only).

import { Component, For, Show, createMemo, splitProps } from "solid-js"

export interface CitationMeta {
  chunkId: string
  page?: number
  sectionTitle?: string
  bookTitle?: string
  verified?: boolean
  sourceChanged?: boolean
}

export interface CitationChipProps {
  citation: CitationMeta
  onClick?: (chunkId: string) => void
}

const STATUS_COLORS = {
  verified: "var(--success-fg, #16a34a)",
  unverified: "var(--warning-fg, #d97706)",
  sourceChanged: "var(--danger-fg, #dc2626)",
  unknown: "var(--text-weak, #71717a)",
} as const

export const CitationChip: Component<CitationChipProps> = (props) => {
  const status = createMemo<"verified" | "unverified" | "sourceChanged" | "unknown">(() => {
    if (props.citation.sourceChanged) return "sourceChanged"
    if (props.citation.verified === false) return "unverified"
    if (props.citation.verified === true) return "verified"
    return "unknown"
  })

  const color = createMemo(() => STATUS_COLORS[status()])
  const label = createMemo(() => {
    const id = props.citation.chunkId
    // Truncate long chunk IDs: "bio-s1-c12" → "bio…c12"
    if (id.length > 12) {
      return `${id.slice(0, 4)}…${id.slice(-4)}`
    }
    return id
  })

  return (
    <button
      type="button"
      class="citation-chip"
      style={{
        "display": "inline-flex",
        "align-items": "center",
        "gap": "4px",
        "padding": "1px 6px",
        "margin": "0 2px",
        "border-radius": "4px",
        "font-size": "11px",
        "font-family": "var(--font-mono, monospace)",
        "color": color(),
        "background": "var(--surface-raised-base, #f4f4f5)",
        "border": `1px solid ${color()}`,
        "cursor": props.onClick ? "pointer" : "default",
        "vertical-align": "baseline",
        "line-height": "1.4",
      }}
      title={props.citation.sectionTitle ?? props.citation.chunkId}
      onClick={() => props.onClick?.(props.citation.chunkId)}
    >
      <span class="citation-chip-id">{label()}</span>
      <Show when={props.citation.page}>
        <span class="citation-chip-page" style={{ "opacity": "0.7" }}>
          p.{props.citation.page}
        </span>
      </Show>
      <Show when={status() === "unverified"}>
        <span class="citation-chip-warning" title="This citation could not be verified against the retrieved chunks">
          ⚠
        </span>
      </Show>
      <Show when={status() === "sourceChanged"}>
        <span class="citation-chip-changed" title="The source book has been re-indexed since this citation was made">
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

const CITATION_RE = /\[([a-zA-Z0-9_-]+(?:-c\d+)?)\]/g

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
        {(seg) => (
          <Show
            when={seg.type === "citation"}
            fallback={<span>{seg.content}</span>}
          >
            <CitationChip
              citation={props.citations?.get(seg.chunkId) ?? { chunkId: seg.chunkId }}
              onClick={props.onCitationClick}
            />
          </Show>
        )}
      </For>
    </>
  )
}

// Re-export for splitProps consumers (prevents unused-import lint).
export { splitProps }
