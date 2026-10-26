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
//
// Failed claims get an "unverified" marker. `retry` re-asks once with the
// failures listed, and only applies to buffered, non-streamed replies.

import { Effect, Schema } from "effect"

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
      return VerifiedCitation.make({
        citation,
        chunkExists,
        chunkWasRetrievedThisTurn,
        quotedSpanMatches,
        verified: chunkExists && chunkWasRetrievedThisTurn && quotedSpanMatches,
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
    if (!f.quotedSpanMatches) reasons.push("quoted span does not appear in the cited chunk")
    return `- [${f.citation.chunkId}]: ${reasons.join("; ")}`
  })
  return [
    "The previous reply contained unverified citations:",
    ...lines,
    "",
    "Please re-answer using ONLY chunks that were retrieved or read this turn,",
    "and make sure every quoted span actually appears in the cited chunk.",
  ].join("\n")
}
