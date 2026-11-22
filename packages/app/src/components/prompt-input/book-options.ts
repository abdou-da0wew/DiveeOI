/**
 * Resilient loader for the composer's @book: mention options (#7).
 *
 * Regression: the @ popup listed agents/files but never books because the
 * loader was a single fragile promise chain — a failing /health call
 * (stale-cookie 401, 503 during bootstrap, non-JSON error page) aborted the
 * chain and silently cleared the option list, with no retry.
 *
 * This loader is deliberately defensive:
 * - an explicit `booksDbAvailable: false` from a *successful* health call is
 *   the ONLY case that short-circuits to []; a failing health call means
 *   "unknown" and must not block the /books fetch
 * - transient /books failures (503 bootstrap, auth hiccup) are retried with a
 *   small delay before giving up
 * - stale loads (server or directory changed mid-flight) are dropped via the
 *   `isStale` probe checked after every await
 * - it never throws: total failure resolves to []
 */

export interface BookRecord {
  id: string
  slug: string
  title: string
  author?: string
}

export interface BookOption {
  type: "book"
  bookId: string
  slug: string
  title: string
  author?: string
  display: string
}

export const BOOK_MAX_ATTEMPTS = 3
export const BOOK_RETRY_DELAY_MS = 1500

export type BookFetch = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>

export type BookStaleProbe = () => boolean

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function normalizeBookRecords(data: unknown): BookRecord[] {
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { books?: unknown }).books)
      ? (data as { books: unknown[] }).books
      : []
  const out: BookRecord[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const record = row as Record<string, unknown>
    const id = typeof record.id === "string" ? record.id : undefined
    const slug = typeof record.slug === "string" ? record.slug : undefined
    if (!id || !slug) continue
    const title = typeof record.title === "string" && record.title.trim() ? record.title : slug
    out.push({
      id,
      slug,
      title,
      ...(typeof record.author === "string" && record.author.trim() ? { author: record.author } : {}),
    })
  }
  return out
}

export function toBookOptions(records: BookRecord[]): BookOption[] {
  return records.map((book) => ({
    type: "book" as const,
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    ...(book.author ? { author: book.author } : {}),
    display: `@book:${book.slug}`,
  }))
}

type JsonResult = { ok: true; data: unknown } | { ok: false; status?: number }

async function fetchJson(input: { fetch: BookFetch; url: string; isStale?: BookStaleProbe }): Promise<JsonResult> {
  try {
    const response = await input.fetch(input.url, { headers: { "content-type": "application/json" } })
    if (input.isStale?.()) return { ok: false }
    if (!response.ok) return { ok: false, status: response.status }
    const data = await response.json()
    return { ok: true, data }
  } catch {
    return { ok: false }
  }
}

/**
 * Ask /health whether the books database is available.
 * Returns `false` only on an authoritative response; `undefined` means
 * "unknown" (health down / auth hiccup) and must not block the books fetch.
 */
export async function resolveBooksDbAvailability(input: {
  fetch: BookFetch
  url: string
  isStale?: BookStaleProbe
}): Promise<boolean | undefined> {
  const result = await fetchJson(input)
  if (input.isStale?.()) return undefined
  if (!result.ok) return undefined
  const available = (result.data as { booksDbAvailable?: unknown } | undefined)?.booksDbAvailable
  if (available === false) return false
  if (available === true) return true
  return undefined
}

export async function listBookOptions(input: {
  fetch: BookFetch
  baseUrl: string
  isStale?: BookStaleProbe
  attempts?: number
  retryDelayMs?: number
}): Promise<BookOption[]> {
  const attempts = Math.max(1, input.attempts ?? BOOK_MAX_ATTEMPTS)
  const retryDelayMs = input.retryDelayMs ?? BOOK_RETRY_DELAY_MS
  const base = input.baseUrl.replace(/\/+$/, "")

  const availability = await resolveBooksDbAvailability({
    fetch: input.fetch,
    url: `${base}/targeted-learning/health`,
    isStale: input.isStale,
  })
  if (input.isStale?.()) return []
  if (availability === false) return []

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await fetchJson({
      fetch: input.fetch,
      url: `${base}/targeted-learning/books`,
      isStale: input.isStale,
    })
    if (input.isStale?.()) return []
    if (result.ok) return toBookOptions(normalizeBookRecords(result.data))
    if (attempt < attempts) await sleep(retryDelayMs)
    if (input.isStale?.()) return []
  }
  return []
}
