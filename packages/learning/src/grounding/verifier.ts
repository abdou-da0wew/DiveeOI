// packages/learning/src/grounding/verifier.ts
//
// Grounding verifier (plan §9.6).
//
// `grounding.verify` is `off`, `flag` (default) or `retry`.
//   - off:   no verification.
//   - flag:  mark unverified claims in the UI; let the reply through.
//   - retry: re-ask once with the failures listed. Buffered, non-streamed only.
//
// Checks (plan §9.6):
//   1. Every cited chunk id exists and was retrieved or read this turn.
//   2. Quoted spans actually appear in the cited chunk (lexical overlap).
//   3. Numeric claims: every figure asserted by the reply for a citation (the text
//      segment the citation annotates, plus its quotedSpan) must appear in the cited
//      chunk text after Arabic-Indic ⇄ Latin digit and separator normalization
//      (`1000` ≡ `1,000` ≡ `1.000` ≡ `١٠٠٠` ≡ `۱۰۰۰`). See ./numeric.ts.
//
// Failed claims get an "unverified" marker. `retry` re-asks once with the
// failures listed, and only applies to buffered, non-streamed replies.

import { Effect, Schema } from "effect"
import { CITATION_RE } from "./turn-state"
import { extractClaimFigures, findMissingFigures } from "./numeric"

export const VerifyMode = Schema.Literals(["off", "flag", "retry"])
export type VerifyMode = Schema.Schema.Type<typeof VerifyMode>

export const Citation = Schema.Struct({
  chunkId: Schema.String,
  sourceHash: Schema.optional(Schema.String),
  page: Schema.optional(Schema.Number),
  quotedSpan: Schema.optional(Schema.String),
})
export type Citation = Schema.Schema.Type<typeof Citation>

export const VerifiedCitation = Schema.Struct({
  citation: Citation,
  chunkExists: Schema.Boolean,
  chunkWasRetrievedThisTurn: Schema.Boolean,
  quotedSpanMatches: Schema.Boolean,
  /** True when every numeric figure asserted for this citation appears in the cited
   *  chunk text (after digit/separator normalization). Vacuously true when the citation
   *  asserts no figures or the chunk text is unavailable (chunkExists already fails). */
  numericClaimsGrounded: Schema.optional(Schema.Boolean),
  /** Original figure tokens that do NOT appear in the cited chunk (failure detail). */
  ungroundedFigures: Schema.optional(Schema.Array(Schema.String)),
  verified: Schema.Boolean,
})
export type VerifiedCitation = Schema.Schema.Type<typeof VerifiedCitation>

export interface VerifyInput {
  /** Citations parsed from the model's reply. */
  citations: Citation[]
  /** Chunk IDs that were retrieved or read this turn. */
  retrievedChunkIds: Set<string>
  /** Map of chunkId → chunk text, for quoted-span verification. */
  chunksByText: Map<string, string>
  mode: VerifyMode
  /** The model's full reply text, when available. Numeric figures in it are attributed
   *  to the citation marker that follows them (standard "claim, then citation" placement)
   *  and must appear in that citation's chunk text. Optional: callers that only use
   *  quotedSpan citations can omit it, and figures after the last citation marker are
   *  not attributed (computed results may legitimately introduce new numbers). */
  answerText?: string
}

/**
 * Map chunkId → the reply text between this citation marker and the preceding one (or
 * the start of the reply): the span the citation annotates, so numeric figures inside
 * it are claims this citation is responsible for. First occurrence wins per chunkId.
 */
const claimSegments = (answerText: string): Map<string, string> => {
  const segments = new Map<string, string>()
  let last = 0
  for (const match of answerText.matchAll(CITATION_RE)) {
    const at = match.index ?? 0
    const chunkId = match[1]!
    if (!segments.has(chunkId)) segments.set(chunkId, answerText.slice(last, at))
    last = at + match[0].length
  }
  return segments
}

/**
 * Verify every citation in a reply.
 * Returns the per-citation results and a single boolean for "all verified".
 */
export const verify = (input: VerifyInput): Effect.Effect<{ results: VerifiedCitation[]; allVerified: boolean }, never> =>
  Effect.sync(() => {
    if (input.mode === "off") {
      return { results: [], allVerified: true }
    }
    const segments = input.answerText ? claimSegments(input.answerText) : new Map<string, string>()
    const results = input.citations.map((citation) => {
      const chunkText = input.chunksByText.get(citation.chunkId)
      const chunkExists = chunkText !== undefined
      const chunkWasRetrievedThisTurn = input.retrievedChunkIds.has(citation.chunkId)
      let quotedSpanMatches = true
      if (citation.quotedSpan && chunkText) {
        // Lexical overlap check (plan §9.6). Normalize whitespace AND case
        // before compare — chunk text may be capitalized differently from
        // what the LLM quoted.
        const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()
        quotedSpanMatches = norm(chunkText).includes(norm(citation.quotedSpan))
      }
      // Numeric-claim grounding (TODO #4). Figures asserted by the quotedSpan and by the
      // answer segment this citation annotates must appear in the chunk. Without chunk
      // text the check is inconclusive — chunkExists already fails the citation.
      const segment = segments.get(citation.chunkId)
      const claimedFigures = [
        ...(citation.quotedSpan ? extractClaimFigures(citation.quotedSpan) : []),
        ...(segment ? extractClaimFigures(segment) : []),
      ]
      let numericClaimsGrounded = true
      let ungroundedFigures: string[] = []
      if (chunkText && claimedFigures.length > 0) {
        ungroundedFigures = findMissingFigures(claimedFigures, chunkText)
        numericClaimsGrounded = ungroundedFigures.length === 0
      }
      return VerifiedCitation.make({
        citation,
        chunkExists,
        chunkWasRetrievedThisTurn,
        quotedSpanMatches,
        numericClaimsGrounded,
        ungroundedFigures,
        verified: chunkExists && chunkWasRetrievedThisTurn && quotedSpanMatches && numericClaimsGrounded,
      })
    })
    return { results, allVerified: results.every((r) => r.verified) }
  })

/**
 * Build the retry prompt when `mode === "retry"` and the reply had failures.
 * The model is re-asked once with the failures listed.
 */
export const buildRetryPrompt = (failures: VerifiedCitation[]): string => {
  const lines = failures.map((f) => {
    const reasons: string[] = []
    if (!f.chunkExists) reasons.push("cited chunk does not exist")
    if (!f.chunkWasRetrievedThisTurn) reasons.push("cited chunk was not retrieved or read this turn")
    if (f.numericClaimsGrounded === false) {
      const figs = (f.ungroundedFigures ?? []).join(", ")
      reasons.push(
        figs.length > 0
          ? `figure${figs.includes(",") ? "s" : ""} ${figs} do not appear in the cited chunk`
          : "numeric figure does not appear in the cited chunk",
      )
    }
    if (!f.quotedSpanMatches) reasons.push("quoted span does not appear in the cited chunk")
    return `- [${f.citation.chunkId}]: ${reasons.join("; ")}`
  })
  return [
    "The previous reply contained unverified citations:",
    ...lines,
    "",
    "Please re-answer using ONLY chunks that were retrieved or read this turn,",
    "and make sure every quoted span and every figure actually appears in the cited chunk.",
  ].join("\n")
}
