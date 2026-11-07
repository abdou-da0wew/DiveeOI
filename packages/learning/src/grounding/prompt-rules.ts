// packages/learning/src/grounding/prompt-rules.ts
//
// Prompt rules for targeted sessions (plan §9.4).
//
// Facts come only from the supplied book context and tool results.
// Every factual claim carries a citation. If the books do not contain
// the answer, say so. The agent may rephrase, simplify, sequence, compute,
// and shape explanations to the student's learning style. It may not add
// facts, and any analogy must be built from the book's own content.
//
// The literal rule "no word may come from outside the book" cannot hold,
// because the model needs its own connective language. The enforceable
// form is "every factual claim is traceable to a retrieved passage", and
// that is what the gate (§8.3), the tool allowlist (§9.3) and the
// verifier (verifier.ts §9.6) enforce together.
//
// The prompt text itself lives in `../prompts/grounding-system-{en,ar}.txt`
// (editable without touching code; this file fills in the session variables).

import { prompt } from "../prompts"

/**
 * The system-prompt block injected into targeted sessions.
 * Parameterized by the student's language and the attached books.
 */
export const buildGroundingPrompt = (opts: {
  bookTitles: string[]
  language: "ar" | "en" | "auto"
  refusalMessages: Record<string, string>
}): string => {
  const ar = opts.language === "ar"
  const books = opts.bookTitles.map((t) => `- ${t}`).join("\n")
  const refusal = ar
    ? (opts.refusalMessages.ar ?? "هذا الموضوع غير موجود في الكتاب أو الكتب المحددة.")
    : (opts.refusalMessages.en ?? "This isn't covered in the selected book(s).")
  return prompt(ar ? "grounding-system-ar" : "grounding-system-en", {
    BOOKS: books,
    REFUSAL: refusal,
  })
}

/**
 * The tool allowlist for targeted sessions (plan §9.3).
 * Any tool added to DiveeOI later is denied by default.
 */
export const TARGETED_SESSION_TOOL_ALLOWLIST = new Set<string>([
  "book_outline",
  "book_search",
  "book_read_section",
  "book_find_term",
  "student_memory_read",
  "student_memory_write",
  "book_note_read",
  "book_note_write",
  "calculator", // gated by grounding.allowCalculator
])

/**
 * Check whether a tool is allowed in a targeted session.
 * The calculator is conditional on the `allowCalculator` setting.
 */
export const isToolAllowed = (toolName: string, allowCalculator: boolean): boolean => {
  if (toolName === "calculator") return allowCalculator
  return TARGETED_SESSION_TOOL_ALLOWLIST.has(toolName)
}
