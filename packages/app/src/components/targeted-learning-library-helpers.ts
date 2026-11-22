// packages/app/src/components/targeted-learning-library-helpers.ts
//
// Pure helpers for the Targeted Learning library UI. Kept free of Solid /
// context imports so they can be unit-tested without mounting components
// (same pattern as pages/session/session-model-helpers.ts).

/** Minimal shape of a library book row relevant for error display. */
export interface BookErrorLike {
  status: string
  error?: string | null
}

/**
 * Human-readable error text for a failed book row.
 *
 * Returns the backend-provided error when it is a meaningful string, or
 * `fallback` (an already-translated i18n string) when the backend sent
 * nothing usable — missing, null, empty, or a literal "null"/"undefined"
 * string — so the UI never renders a bare "null". Non-failed books get an
 * empty string so callers can render unconditionally.
 */
export const displayBookError = (book: BookErrorLike, fallback: string): string => {
  if (book.status !== "failed") return ""
  const raw = typeof book.error === "string" ? book.error.trim() : ""
  if (!raw || raw === "null" || raw === "undefined") return fallback
  return raw
}
