// packages/app/src/pages/session/book-tabs.ts
//
// Book tabs - first-class tab support for the Targeted Learning book viewer
// (book-pdf-panel.tsx). A book tab id is `book:<bookId>`; it lives in the
// session tab store like any other tab (context/layout.tsx keeps `book:` ids
// untouched - they are not `file://` paths) and is rendered by FileTabContent
// (file-tabs.tsx), which mounts BookPdfPanel for tabs with this prefix.
//
// Citation flow: a citation chip (packages/ui/src/components/citation-chip.tsx,
// or the inline chips in markdown.tsx) dispatches the `diveeoi:open-book-citation`
// window event; SessionSidePanel listens for it and calls openBookTab(), which
// stores the citation here as the "pending cite" so the freshly opened (or
// re-focused) book tab can pick up the exact chunk / page / highlight to show.

import { createSignal } from "solid-js"

export interface OpenBookCitationDetail {
  bookId: string
  /** Cited chunk; optional - future quotations may carry a page only. */
  chunkId?: string
  page?: number
  bookTitle?: string
  /** Text to highlight when no chunkId is given (chunk text is used otherwise). */
  highlightText?: string
}

const [pendingBookCite, setPendingBookCite] = createSignal<OpenBookCitationDetail | null>(null)

export { pendingBookCite }

/** Drop the pending citation (e.g. once consumed by a book tab panel). */
export const clearPendingBookCite = () => setPendingBookCite(null)

/** Tab id for a book viewer tab. */
export const tabForBook = (bookId: string) => `book:${bookId}`

/** Book id behind a `book:` tab id; undefined for any other tab. */
export const bookIdFromTab = (tab: string) => (tab.startsWith("book:") ? tab.slice(5) : undefined)

/**
 * Open (or focus) the tab for a book and remember the citation that triggered it.
 * Uses the raw tab-store API (open + setActive) rather than
 * createOpenSessionFileTab, which is file-path specific.
 */
export function openBookTab(
  api: { open: (tab: string) => unknown | Promise<unknown>; setActive: (tab: string) => void },
  cite: OpenBookCitationDetail,
) {
  if (!cite.bookId) return
  setPendingBookCite(cite)
  const tab = tabForBook(cite.bookId)
  api.open(tab)
  api.setActive(tab)
}
