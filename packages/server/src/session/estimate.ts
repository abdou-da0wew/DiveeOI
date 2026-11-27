// Shared message-token estimator.
//
// The server has no real tokenizer; every budget decision uses these
// character-based estimates. Two properties matter:
// 1. Estimate ABOVE reality rather than below: under-estimating lets the
//    prompt hit the provider context window (hard 413 + compaction churn),
//    over-estimating only trims slightly earlier.
// 2. Count EVERYTHING the provider will actually receive. Media parts used
//    to contribute 0 tokens although a single image costs 1k+ tokens, which
//    made the pre-compaction window cut fire far too late for image-heavy
//    sessions.
//
// Text mass is estimated at 4 chars/token (English-leaning; Arabic runs
// ~2-2.5 chars/token, so the estimator is conservative there — it
// over-counts, which is the safe direction per point 1).

import type { SessionV1 } from "@diveeoi/db/v1/session"

/** Conservative per-part costs for content the estimator cannot see inside (provider-side cost). */
export const MEDIA_TOKEN_ESTIMATES = {
  /** One rasterized image at common chat resolutions (Anthropic tiles ~1590 tokens for 1024x1024-ish). */
  image: 1_600,
  /** PDFs cost roughly a page each even before text extraction; no page count is available here. */
  pdf: 2_000,
  /** Non-media files (text/code attachments get inlined by the provider). */
  file: 1_000,
} as const

function filePartTokens(mime: string): number {
  if (mime.startsWith("image/")) return MEDIA_TOKEN_ESTIMATES.image
  if (mime === "application/pdf") return MEDIA_TOKEN_ESTIMATES.pdf
  return MEDIA_TOKEN_ESTIMATES.file
}

export function estimateMessageTokens(msg: SessionV1.WithParts): number {
  let chars = 0
  let fileTokens = 0
  for (const part of msg.parts) {
    if (part.type === "text" || part.type === "reasoning") chars += part.text.length
    else if (part.type === "tool") {
      chars += part.tool.length
      const st = part.state
      if (st.status === "completed") chars += st.output.length
      else if (st.status === "error") chars += st.error.length
      else if (st.status === "pending") chars += st.raw.length
    } else if (part.type === "file") {
      fileTokens += filePartTokens(part.mime)
    }
  }
  return Math.max(1, Math.round(chars / 4) + fileTokens)
}

export function estimateHistoryTokens(msgs: ReadonlyArray<SessionV1.WithParts>): number {
  let total = 0
  for (const msg of msgs) total += estimateMessageTokens(msg)
  return total
}
