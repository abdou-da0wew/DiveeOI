import { serializeUserMessage } from "./user-message-metadata"

// packages/ui/src/components/usr-quote.ts
//
// usr_quotations — wire format for quoted context attached to user messages.
//
// When the user quotes a passage (book PDF selection via book-pdf-panel.tsx, or
// assistant output via message-timeline.tsx), the composer (prompt-input.tsx)
// serializes the quote + instruction into the message text:
//
//   > <quoted text>
//
//   <!--usr-quote {"v":1,"action":"explain","source":"book",...}-->
//
//   <instruction>
//
// The quotation travels to the model as plain text and is rendered back as a
// quotation card by UserMessageDisplay (message-part.tsx), which parses the
// marker out for display and strips it from the visible text.
//
// Pure module: no DOM, no Solid. The canonical implementation lives here so
// both @diveeoi/ui (rendering) and @diveeoi/app (composer serialization —
// re-exported via src/utils/usr-quotations.ts) share one parser/serializer.

export interface UsrQuotation {
  v: number
  action: "explain" | "memorize" | "ask"
  source: "book" | "agent"
  text: string
  bookId?: string
  page?: number
  chunkId?: string
  bookTitle?: string
  messageID?: string
}

/** Quoted text is capped at this length (plus an ellipsis). */
const MAX_QUOTE_TEXT = 1200

/**
 * U+2010 HYPHEN. Every "--" inside the embedded JSON is neutralized to a pair
 * of these so the marker can never contain "--" (which would terminate the
 * HTML comment early); parseUsrQuotations reverses the replacement.
 */
const DASH = "\u2010"

const DASHES = `${DASH}${DASH}`

const MARKER_SOURCE = "<!--usr-quote (\\{[^\\n]*\\})-->"

/** Squash whitespace, drop a leading markdown blockquote character, cap length. */
function cleanQuoteText(text: string): string {
  const squashed = text.replace(/\s+/g, " ").trim().replace(/^>\s*/, "")
  return squashed.length > MAX_QUOTE_TEXT ? `${squashed.slice(0, MAX_QUOTE_TEXT)}…` : squashed
}

/**
 * Serialize a quotation + instruction into the user-message text. The embedded
 * JSON is a single line; "internal" double hyphens are neutralized (see DASH).
 */
export function serializeUsrQuotation(q: UsrQuotation, instruction: string): string {
  const payload: UsrQuotation = { ...q, text: cleanQuoteText(q.text) }
  const json = JSON.stringify(payload).replace(/--/g, DASHES)
  const body = `> ${payload.text}\n\n<!--usr-quote ${json}-->\n\n${instruction.trim()}`
  const summary =
    payload.source === "book"
      ? `${payload.bookTitle ?? "Book"}${payload.page ? ` · p.${payload.page}` : ""}`
      : "From a previous answer"
  return serializeUserMessage(body, {
    kind: "quotation",
    label: "Quoted context",
    summary,
    metadata: {
      source: payload.source,
      action: payload.action,
      ...(payload.page ? { page: payload.page } : {}),
      ...(payload.bookTitle ? { book: payload.bookTitle } : {}),
    },
  })
}

/** Parse every `<!--usr-quote {…}-->` marker in a message text (order preserved). */
export function parseUsrQuotations(text: string): UsrQuotation[] {
  if (!text) return []
  const out: UsrQuotation[] = []
  const re = new RegExp(MARKER_SOURCE, "g")
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    try {
      const raw = JSON.parse(match[1].replace(new RegExp(DASHES, "g"), "--")) as UsrQuotation
      if (
        raw &&
        raw.v === 1 &&
        (raw.source === "book" || raw.source === "agent") &&
        (raw.action === "explain" || raw.action === "memorize" || raw.action === "ask") &&
        typeof raw.text === "string" &&
        raw.text.length > 0
      ) {
        out.push(raw)
      }
    } catch {
      // Malformed marker — leave it as plain text.
    }
  }
  return out
}

/**
 * Remove the quotation blocks from a message text: the blockquote line
 * immediately preceding each marker plus the marker line itself (orphan
 * markers are removed too). Collapses 3+ newlines and trims; returns the
 * remaining instruction/question.
 */
export function stripUsrQuotation(text: string): string {
  const withoutBlocks = text
    .replace(/(?:^|\n)>[^\n]*\n+<!--usr-quote \{[^\n]*\}-->\s*/g, "")
    .replace(/<!--usr-quote \{[^\n]*\}-->\s*/g, "")
  return withoutBlocks.replace(/\n{3,}/g, "\n\n").trim()
}
