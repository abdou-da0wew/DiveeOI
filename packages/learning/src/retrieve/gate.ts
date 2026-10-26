// packages/learning/src/retrieve/gate.ts
//
// Retrieval gate (plan §8.3).
//
// If the best dense and fused scores fall below the thresholds, the system
// returns a hardcoded refusal in the student's language and NEVER calls
// the LLM. That is the football-in-a-math-book case.
//
// Small talk ("hi", "thanks") and questions about the session itself
// bypass the gate.
//
// Phase 3 implementation. Phase 1 ships the refusal messages and the
// small-talk detector.

import { Effect, Schema } from "effect"

export const GateDecision = Schema.Literals(["pass", "refused", "small-talk", "library-unavailable"])
export type GateDecision = Schema.Schema.Type<typeof GateDecision>

export interface GateInput {
  bestDenseScore: number
  bestFusedScore: number
  query: string
  language: "ar" | "en" | "auto"
  enabled: boolean
  minDenseScore: number
  minFusedScore: number
  allowSmallTalk: boolean
  refusalMessages?: Record<string, string>
  libraryAvailable: boolean
}

// ---------------------------------------------------------------------------
// Small-talk detector — bypasses the gate
// ---------------------------------------------------------------------------

const SMALL_TALK_PATTERNS = {
  en: [/^(hi|hello|hey|salam|salaam)\b/i, /^(thanks|thank you|thx)\b/i, /^(bye|goodbye)\b/i, /^how are you/i],
  // Arabic: \b doesn't work with Arabic chars in JS regex, so we use
  // `$` (end of string) or whitespace as the boundary.
  ar: [/^(مرحبا|أهلا|السلام عليكم|سلام)(\s|$)/, /^(شكرا|شكراً)(\s|$)/, /^(مع السلامة|إلى اللقاء)(\s|$)/],
}

const isSmallTalk = (query: string): boolean => {
  const trimmed = query.trim()
  if (trimmed.length > 40) return false // small talk is short
  const lang = /[\u0600-\u06FF]/.test(trimmed) ? "ar" : "en"
  return SMALL_TALK_PATTERNS[lang].some((re) => re.test(trimmed))
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export const evaluate = (input: GateInput): Effect.Effect<{ decision: GateDecision; reason?: string; message?: string }, never> =>
  Effect.sync(() => {
    if (!input.libraryAvailable) {
      return {
        decision: "library-unavailable",
        reason: "library unavailable",
        message: input.refusalMessages?.[input.language === "ar" ? "ar" : "en"] ?? "Library unavailable.",
      }
    }
    if (!input.enabled) {
      return { decision: "pass" }
    }
    if (input.allowSmallTalk && isSmallTalk(input.query)) {
      return { decision: "small-talk" }
    }
    if (input.bestDenseScore < input.minDenseScore && input.bestFusedScore < input.minFusedScore) {
      const lang = input.language === "ar" ? "ar" : "en"
      return {
        decision: "refused",
        reason: `below threshold (dense=${input.bestDenseScore.toFixed(3)}, fused=${input.bestFusedScore.toFixed(3)})`,
        message: input.refusalMessages?.[lang] ?? "This isn't covered in the selected book(s).",
      }
    }
    return { decision: "pass" }
  })
