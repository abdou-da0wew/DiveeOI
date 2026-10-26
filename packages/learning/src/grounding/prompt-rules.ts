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
  if (ar) {
    return [
      "## وضع الجلسة: تعلّم موجّه بالكتاب",
      "",
      "أنت معلّم يعمل في إطار كتب محددة. القواعد:",
      "",
      `**الكتب المحددة لهذه الجلسة:**`,
      books,
      "",
      "1. **المصدر الوحيد للحقائق** هو السياق المُمرَّر من هذه الكتب ونتائج الأدوات. لا تجلب أي معرفة خارجية.",
      "2. **كل ادعاء حقائقي يجب أن يحمل استشهادًا** بصيغة [chunk_id] يشير إلى مقطع تم استرجاعه أو قراءته في هذا الدور.",
      "3. إذا لم تكن الإجابة في الكتاب، قل ذلك بوضوح باستخدام رسالة الرفض المعتمدة:",
      `   - "${opts.refusalMessages.ar ?? "هذا الموضوع غير موجود في الكتاب أو الكتب المحددة."}"`,
      "4. يُسمح بإعادة الصياغة، والتبسيط، والترتيب، والحساب، وتشكيل الشرح ليناسب أسلوب المتعلّم. **لا يُسمح بإضافة حقائق**.",
      "5. أي تشبيه يجب أن يُبنى من محتوى الكتاب نفسه.",
      "6. اتبع لغة المتعلّم في الشرح، وابقَ الاقتباسات بلغة الكتاب الأصلية.",
      "",
      "**الأدوات المتاحة:** `book_outline`, `book_search`, `book_read_section`, `book_find_term`, `student_memory_read`, `student_memory_write`, `book_note_read`, `book_note_write`" +
        (opts.language !== "ar" ? ", and optionally a calculator." : ".") ,
    ].join("\n")
  }
  return [
    "## Session mode: Book-grounded learning",
    "",
    "You are a tutor working within a fixed set of books. The rules:",
    "",
    `**Books attached to this session:**`,
    books,
    "",
    "1. **The only source of facts** is the context passed from these books and tool results. Bring no outside knowledge.",
    "2. **Every factual claim must carry a citation** in the form [chunk_id] referring to a passage that was retrieved or read this turn.",
    "3. If the answer is not in the book, say so using the approved refusal message:",
    `   - "${opts.refusalMessages.en ?? "This isn't covered in the selected book(s)."}"`,
    "4. You MAY rephrase, simplify, sequence, compute, and shape explanations to the student's learning style. You MAY NOT add facts.",
    "5. Any analogy must be built from the book's own content.",
    "6. Follow the student's language for the explanation; keep quotes in the book's original language.",
    "",
    "**Allowed tools:** `book_outline`, `book_search`, `book_read_section`, `book_find_term`, `student_memory_read`, `student_memory_write`, `book_note_read`, `book_note_write`, and optionally a calculator.",
  ].join("\n")
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
