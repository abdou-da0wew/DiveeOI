// packages/learning/src/retrieve/rewrite.ts
//
// Query rewriting for follow-ups (plan §8.2).
//
// "Explain that more simply" has no useful keywords. Rewriting modes:
//   - heuristic (default): folds key terms from the last user turn when
//     the message is short or anaphoric. No LLM call.
//   - llm: asks a small model to rewrite the query.
//   - off: no rewriting.
//
// Phase 3 implements the heuristic; the LLM mode reuses the existing
// Session/LLM service.

import { Effect } from "effect"

export type RewriteMode = "heuristic" | "llm" | "off"

export interface RewriteInput {
  query: string
  recentUserTurns: string[]
  mode: RewriteMode
  rewriteTurns: number
}

const ANAPHORIC_PATTERNS = [
  /^(explain|elaborate|more|simpler|again)\b/i,
  // Arabic: \b doesn't work with Arabic chars in JS regex.
  /^(اشرح|وضّح|وضح|أكثر|بسّط|بسط|مرة أخرى)(\s|$)/,
]

export const isAnaphoric = (query: string): boolean => {
  const trimmed = query.trim().toLowerCase()
  if (trimmed.length > 80) return false
  return ANAPHORIC_PATTERNS.some((re) => re.test(trimmed))
}

/**
 * Heuristic rewrite: take the last user turn, extract its key nouns /
 * named entities, and prepend them to the current query.
 *
 * Phase 3 implements the noun extraction. Phase 1 ships a simple version
 * that just appends the last turn verbatim when anaphoric.
 */
export const rewrite = (input: RewriteInput): Effect.Effect<string, never> =>
  Effect.sync(() => {
    if (input.mode === "off") return input.query
    if (input.mode === "llm") {
      // TODO Phase 3: call the LLM service with a rewrite prompt.
      return input.query
    }
    // heuristic
    if (!isAnaphoric(input.query)) return input.query
    const lastTurn = input.recentUserTurns[input.recentUserTurns.length - 1]
    if (!lastTurn) return input.query
    return `${input.query} (re: ${lastTurn})`
  })
