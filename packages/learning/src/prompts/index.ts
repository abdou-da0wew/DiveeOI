// packages/learning/src/prompts/index.ts
//
// Prompt store: every system prompt / prompt fragment the learning package sends to the
// LLM lives in a plain .txt file next to this module, so they can be reviewed, edited and
// versioned without touching code. Files support {{PLACEHOLDER}} substitution.
//
// Each name has a built-in fallback (the last wording that shipped) so packaging or a
// partial checkout can never break the chat path: a missing .txt degrades to the fallback.

import { readFileSync } from "node:fs"
import { join } from "node:path"

const cache = new Map<string, string>()

/** Fallback wording, used only when the .txt file cannot be read. */
const FALLBACKS: Record<string, string> = {
  "grounding-system-en": [
    "## Session mode: Book-grounded learning",
    "",
    "You are a tutor working within a fixed set of books. The rules:",
    "",
    "**Books attached to this session:**",
    "{{BOOKS}}",
    "",
    "1. **The only source of facts** is the context passed from these books and tool results. Bring no outside knowledge.",
    "2. **Every factual claim must carry a citation** in the form [chunk_id] referring to a passage that was retrieved or read this turn.",
    "3. If the answer is not in the book, say so using the approved refusal message:",
    `   - "{{REFUSAL}}"`,
    "4. You MAY rephrase, simplify, sequence, compute, and shape explanations to the student's learning style. You MAY NOT add facts.",
    "5. Any analogy must be built from the book's own content.",
    "6. Follow the student's language for the explanation; keep quotes in the book's original language.",
    "",
    "**Allowed tools:** `book_outline`, `book_search`, `book_read_section`, `book_find_term`, `student_memory_read`, `student_memory_write` (how this student learns), `book_note_read`, `book_note_write` (findings; must cite [chunk_id]).",
  ].join("\n"),
  "grounding-system-ar": [
    "## وضع الجلسة: تعلّم موجّه بالكتاب",
    "",
    "أنت معلّم يعمل في إطار كتب محددة. القواعد:",
    "",
    "**الكتب المحددة لهذه الجلسة:**",
    "{{BOOKS}}",
    "",
    "1. **المصدر الوحيد للحقائق** هو السياق المُمرَّر من هذه الكتب ونتائج الأدوات. لا تجلب أي معرفة خارجية.",
    "2. **كل ادعاء حقائقي يجب أن يحمل استشهادًا** بصيغة [chunk_id] يشير إلى مقطع تم استرجاعه أو قراءته في هذا الدور.",
    "3. إذا لم تكن الإجابة في الكتاب، قل ذلك بوضوح باستخدام رسالة الرفض المعتمدة:",
    `   - "{{REFUSAL}}"`,
    "4. يُسمح بإعادة الصياغة، والتبسيط، والترتيب، والحساب، وتشكيل الشرح ليناسب أسلوب المتعلّم. **لا يُسمح بإضافة حقائق**.",
    "5. أي تشبيه يجب أن يُبنى من محتوى الكتاب نفسه.",
    "6. اتبع لغة المتعلّم في الشرح، وابقَ الاقتباسات بلغة الكتاب الأصلية.",
    "",
    "**الأدوات المتاحة:** `book_outline`, `book_search`, `book_read_section`, `book_find_term`, `student_memory_read`, `student_memory_write`, `book_note_read`, `book_note_write`.",
  ].join("\n"),
  "attach-greeting-en":
    "The student just attached the book(s) above. Greet them briefly and ask what they want to study. State no facts.",
  "attach-greeting-ar":
    "أضاف الطالب الكتاب أو الكتب أعلاه للتوّ. رحّب به بإيجاز واسأله ماذا يريد أن يدرس. لا تذكر أي حقائق.",
  "small-talk-en":
    "This message is small talk. Reply briefly and warmly and offer to help with the attached book(s). State no facts.",
  "small-talk-ar":
    "هذه الرسالة مجاملة عابرة. رُدّ بإيجاز ودفء واعرض المساعدة في الكتب المرفقة. لا تذكر أي حقائق.",
  "missing-books-en":
    "The student mentioned books that are not available: {{BOOKS}}. Tell them briefly.",
  "missing-books-ar": "ذكر الطالب كتبًا غير متاحة: {{BOOKS}}. أخبره بذلك بإيجاز.",
  "book-context-en": [
    "<book_context>",
    "Passages retrieved for this question. Cite them as [chunk_id]. Use ONLY these passages and tool results for facts.",
    "",
    "{{CONTEXT}}",
    "</book_context>",
  ].join("\n"),
  "book-context-ar": [
    "<book_context>",
    "مقاطع تم استرجاعها لهذا السؤال. استشهد بها بصيغة [chunk_id]. اعتمد فقط على هذه المقاطع ونتائج الأدوات في الحقائق.",
    "",
    "{{CONTEXT}}",
    "</book_context>",
  ].join("\n"),
  "student-profile-en": [
    "<student_profile>",
    "What you know about THIS student (how they learn). Adapt your teaching to it. It is not a source of facts about the subject.",
    "{{LINES}}",
    "</student_profile>",
  ].join("\n"),
  "book-notes-en": [
    "<book_notes>",
    "Findings saved from earlier sessions. They point to passages; re-read the passage with book_read_section before relying on one.",
    "{{LINES}}",
    "</book_notes>",
  ].join("\n"),
  "rewrite-query-en": [
    "You rewrite a student's follow-up question so it can be searched in a book index.",
    "Rules:",
    "- Resolve pronouns and elliptical phrasing using ONLY the recent turns provided.",
    "- Keep every topical keyword; do not paraphrase into different vocabulary.",
    "- Do NOT answer the question. Output ONLY the rewritten search query, one line, no quotes, no explanations.",
    "- If the question is already standalone and precise, return it unchanged.",
    "",
    "Recent user turns:",
    "{{TURNS}}",
    "",
    "Current question:",
    "{{QUERY}}",
    "",
    "Rewritten query:",
  ].join("\n"),
}

/**
 * Read a prompt file synchronously (cached). Missing files fall back to the built-in
 * wording so the chat path never breaks.
 */
export const loadPrompt = (name: string): string => {
  const hit = cache.get(name)
  if (hit !== undefined) return hit
  let text = ""
  try {
    text = readFileSync(join(import.meta.dir, `${name}.txt`), "utf8").trim()
  } catch {
    // fall through to the fallback
  }
  if (!text) text = FALLBACKS[name] ?? ""
  cache.set(name, text)
  return text
}

/** Substitute `{{VAR}}` placeholders in a loaded prompt template. */
export const fillTemplate = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? "")

/** Convenience: load + fill in one call. */
export const prompt = (name: string, vars: Record<string, string> = {}): string =>
  fillTemplate(loadPrompt(name), vars)
