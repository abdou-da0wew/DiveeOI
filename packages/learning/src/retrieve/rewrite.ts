// packages/learning/src/retrieve/rewrite.ts
//
// Query rewriting for follow-ups (plan §8.2).
//
// "Explain that more simply" has no useful keywords. Rewriting modes:
//   - heuristic (default): folds key terms from the last user turn when
//     the message is short or anaphoric. No LLM call.
//   - llm: sends a rewrite prompt (recent turns + current query, with an
//     only-the-query / same-language / no-quotes contract) to an injected
//     `RewriteLLMClient` and uses its answer, validated for emptiness and
//     runaway length.
//   - off: no rewriting.
//
// Resilience contract: rewriting never fails. In llm mode, ANY failure —
// no `llm` client supplied, the client throwing synchronously, the client
// effect failing (or dying), a client returning a non-Effect value, or an
// empty / oversized result — falls back to the heuristic rewrite for the
// same input, so `rewrite` keeps its `Effect.Effect<string, never>`
// signature.
//
// Wiring a real LLM service later: the host application adapts its LLM
// client to the `RewriteLLMClient` port (one method, `rewrite({ prompt })`,
// returning `Effect.Effect<string, unknown>`) and passes it as
// `RewriteInput.llm`. The prompt is built by `buildRewritePrompt`. No LLM
// service is wired inside packages/learning.

import { Effect } from "effect"

export type RewriteMode = "heuristic" | "llm" | "off"

/**
 * Minimal port for an LLM query rewriter. The host application adapts its
 * real LLM service to this shape and supplies it via `RewriteInput.llm`.
 * Errors may be surfaced either as a failed effect or as a synchronous
 * throw — both are caught by the resilience contract below.
 */
export interface RewriteLLMClient {
  rewrite: (args: { prompt: string }) => Effect.Effect<string, unknown>
}

export interface RewriteInput {
  query: string
  recentUserTurns: string[]
  mode: RewriteMode
  rewriteTurns: number
  /** Optional LLM port; required for `mode: "llm"` to do anything. */
  llm?: RewriteLLMClient
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

// Guardrails for LLM output: a "rewrite" that is empty or runs away
// (longer than MAX_RESULT_CHARS, or more than MAX_RESULT_RATIO × the
// trimmed query length) is rejected and the heuristic fallback is used.
const MAX_RESULT_CHARS = 300
const MAX_RESULT_RATIO = 4

const isValidRewrite = (query: string, rewritten: string): boolean => {
  if (rewritten.length === 0) return false
  if (rewritten.length > MAX_RESULT_CHARS) return false
  if (rewritten.length > MAX_RESULT_RATIO * query.trim().length) return false
  return true
}

/**
 * Build the prompt sent to the LLM rewriter: an instruction to turn the
 * student's latest message into a standalone retrieval query, the last
 * `rewriteTurns` recent user turns (most recent last), and the current
 * query. The rules require ONLY the rewritten query — no explanations, no
 * quotes — and the SAME language as the query (Arabic stays Arabic).
 */
export const buildRewritePrompt = (
  input: Pick<RewriteInput, "query" | "recentUserTurns" | "rewriteTurns">,
): string => {
  const turnCount = Math.max(0, Math.floor(input.rewriteTurns))
  const turns = turnCount === 0 ? [] : input.recentUserTurns.slice(-turnCount)
  const turnsBlock = turns.length === 0 ? "(none)" : turns.map((turn, i) => `${i + 1}. ${turn}`).join("\n")
  return [
    "You rewrite a student's follow-up question so it can be searched in a book index.",
    "",
    "Rewrite the student's latest message into a single standalone retrieval query,",
    "resolving pronouns and elliptical phrasing using ONLY the recent turns provided.",
    "Rules:",
    "- Output ONLY the rewritten query: one line, no quotes, no explanations, no extra text.",
    "- Do NOT answer the question.",
    "- Keep the SAME language as the current question (Arabic stays Arabic; do not translate).",
    "- If the question is already standalone and precise, return it unchanged.",
    "",
    "Recent user turns:",
    turnsBlock,
    "",
    "Current question:",
    input.query,
    "",
    "Rewritten query:",
  ].join("\n")
}

/**
 * Heuristic rewrite: when the query is anaphoric ("explain more"), append
 * the last user turn so the retrieval query carries its key terms.
 */
const heuristicRewrite = (input: RewriteInput): string => {
  if (!isAnaphoric(input.query)) return input.query
  const lastTurn = input.recentUserTurns[input.recentUserTurns.length - 1]
  if (!lastTurn) return input.query
  return `${input.query} (re: ${lastTurn})`
}

const rewriteWithLLM = (input: RewriteInput, client: RewriteLLMClient): Effect.Effect<string, never> => {
  const prompt = buildRewritePrompt(input)
  const fallback = Effect.sync(() => heuristicRewrite(input))
  // `Effect.try` guards a sync-throwing client; the guarded flatMap unwraps
  // the returned value so client failures surface in the error channel.
  // A non-Effect return value (an interface violation that would otherwise
  // crash the fiber with "Not a valid effect" — not contained by
  // `Effect.catchCause`) is converted to a typed failure that the fallback
  // below catches.
  const attempt = Effect.try({
    try: () => client.rewrite({ prompt }),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap((returned: unknown) =>
      Effect.isEffect(returned)
        ? (returned as Effect.Effect<string, unknown>)
        : Effect.fail(new Error("RewriteLLMClient.rewrite returned a non-Effect value")),
    ),
    Effect.map((raw) => raw.trim()),
    Effect.filterOrFail(
      (rewritten) => isValidRewrite(input.query, rewritten),
      () => new Error("llm rewrite rejected: empty or runaway output"),
    ),
  )
  // Resilience contract: any failure (typed error or defect) falls back to
  // the heuristic rewrite, keeping the error channel `never`.
  return attempt.pipe(Effect.catchCause(() => fallback))
}

/**
 * Rewrite a follow-up query into something a retrieval index can match.
 *
 * Modes: "heuristic" (default) appends the last user turn when the query
 * is anaphoric; "llm" asks the injected `RewriteLLMClient` for a
 * standalone retrieval query and falls back to the heuristic on ANY
 * failure (missing client, thrown or failed LLM call, non-Effect client
 * return value, empty or runaway output); "off" returns the query
 * unchanged. Never fails.
 */
export const rewrite = (input: RewriteInput): Effect.Effect<string, never> => {
  if (input.mode === "llm" && input.llm) return rewriteWithLLM(input, input.llm)
  return Effect.sync(() => (input.mode === "off" ? input.query : heuristicRewrite(input)))
}
