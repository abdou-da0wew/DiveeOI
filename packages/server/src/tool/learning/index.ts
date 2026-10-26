// packages/server/src/tool/learning/index.ts
//
// Index of all Targeted Learning book tools. These are the ONLY tools
// allowed in targeted sessions (plan §9.3), plus the calculator (gated
// by grounding.allowCalculator).

export { BookOutlineTool } from "./book-outline"
export { BookSearchTool } from "./book-search"
export { BookReadSectionTool } from "./book-read-section"
export { BookFindTermTool } from "./book-find-term"

// The full list of book tool IDs — used by the tool registry to filter
// which tools are available in a targeted session.
export const BOOK_TOOL_IDS = [
  "book_outline",
  "book_search",
  "book_read_section",
  "book_find_term",
] as const
