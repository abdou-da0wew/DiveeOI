// packages/server/src/session/book-mentions.ts
//
// @book: mention resolver (plan §9.1).
//
// The composer gets an @book: autocomplete modeled on the existing skills
// autocomplete. On the backend the mention is resolved in the prompt
// pipeline next to the @skill handling in session/prompt.ts.
//
// Mention syntax:
//   @book:slug          — resolve by slug
//   @book:"Title"       — resolve by exact title (quoted)
//   @book:id:<uuid>     — resolve by ID directly
//
// On resolution, the first resolved mention sets the session to targeted
// mode and records the book in the session metadata. The mark is sticky
// (plan §9.2). Later mentions add books.

import { Context, Effect, Layer, Schema } from "effect"
import { TargetedLearning, BooksUnavailableError } from "@diveeoi/learning"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BookMention {
  bookId: string
  slug: string
  title: string
  author: string | null
  sourceHash: string
}

export interface BookMentionResult {
  mentions: BookMention[]
  unknown: string[] // raw mention strings that didn't resolve
  sessionMode: "targeted" | "normal"
  bookIds: string[]
}

export interface Interface {
  readonly parse: (text: string) => Effect.Effect<BookMentionResult>
  readonly resolveSlug: (slug: string) => Effect.Effect<BookMention | null>
  readonly resolveTitle: (title: string) => Effect.Effect<BookMention | null>
  readonly resolveId: (id: string) => Effect.Effect<BookMention | null>
  readonly listAvailable: () => Effect.Effect<BookMention[]>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/BookMentions") {}

// ---------------------------------------------------------------------------
// Mention regex
// ---------------------------------------------------------------------------

// Matches @book:slug, @book:"Title", @book:'Title', @book:id:<uuid>
const BOOK_MENTION_RE = /@book:(?:"([^"]+)"|'([^']+)'|id:([a-zA-Z0-9_-]+)|([a-zA-Z0-9_-]+))/g

export const extractBookMentions = (text: string): string[] => {
  const out: string[] = []
  let match: RegExpExecArray | null
  while ((match = BOOK_MENTION_RE.exec(text)) !== null) {
    const title = match[1] ?? match[2]
    const id = match[3]
    const slug = match[4]
    if (title) out.push(`@book:"${title}"`)
    else if (id) out.push(`@book:id:${id}`)
    else if (slug) out.push(`@book:${slug}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const tl = yield* TargetedLearning

    const resolveSlug = (slug: string): Effect.Effect<BookMention | null> =>
      Effect.gen(function* () {
        const store = tl.booksStore
        if (!store.available || !store.db) return null
        const row = yield* Effect.promise(() => (store.db!.get<{
              id: string
              slug: string
              title: string
              author: string | null
              source_hash: string
            }>("SELECT id, slug, title, author, source_hash FROM books WHERE slug = ? AND status = 'ready' LIMIT 1", slug)).catch(() => null))
        return row
          ? { bookId: row.id, slug: row.slug, title: row.title, author: row.author, sourceHash: row.source_hash }
          : null
      })

    const resolveTitle = (title: string): Effect.Effect<BookMention | null> =>
      Effect.gen(function* () {
        const store = tl.booksStore
        if (!store.available || !store.db) return null
        const row = yield* Effect.promise(() => (store.db!.get<{
              id: string
              slug: string
              title: string
              author: string | null
              source_hash: string
            }>(
              "SELECT id, slug, title, author, source_hash FROM books WHERE title = ? AND status = 'ready' LIMIT 1",
              title,
            )).catch(() => null))
        return row
          ? { bookId: row.id, slug: row.slug, title: row.title, author: row.author, sourceHash: row.source_hash }
          : null
      })

    const resolveId = (id: string): Effect.Effect<BookMention | null> =>
      Effect.gen(function* () {
        const store = tl.booksStore
        if (!store.available || !store.db) return null
        const row = yield* Effect.promise(() => (store.db!.get<{
              id: string
              slug: string
              title: string
              author: string | null
              source_hash: string
            }>(
              "SELECT id, slug, title, author, source_hash FROM books WHERE id = ? AND status = 'ready' LIMIT 1",
              id,
            )).catch(() => null))
        return row
          ? { bookId: row.id, slug: row.slug, title: row.title, author: row.author, sourceHash: row.source_hash }
          : null
      })

    const listAvailable = (): Effect.Effect<BookMention[]> =>
      Effect.gen(function* () {
        const store = tl.booksStore
        if (!store.available || !store.db) return []
        const rows = yield* Effect.promise(() => (store.db!.all<{
              id: string
              slug: string
              title: string
              author: string | null
              source_hash: string
            }>("SELECT id, slug, title, author, source_hash FROM books WHERE status = 'ready' ORDER BY title")).catch(() => [] as never[]))
        return rows.map((r) => ({
          bookId: r.id,
          slug: r.slug,
          title: r.title,
          author: r.author,
          sourceHash: r.source_hash,
        }))
      })

    const parse = (text: string): Effect.Effect<BookMentionResult> =>
      Effect.gen(function* () {
        const mentions: BookMention[] = []
        const unknown: string[] = []

        let match: RegExpExecArray | null
        const re = new RegExp(BOOK_MENTION_RE.source, "g")
        while ((match = re.exec(text)) !== null) {
          const titleQuoted = match[1] ?? match[2]
          const idExplicit = match[3]
          const slug = match[4]

          let resolved: BookMention | null = null
          if (titleQuoted) {
            resolved = yield* resolveTitle(titleQuoted)
          } else if (idExplicit) {
            resolved = yield* resolveId(idExplicit)
          } else if (slug) {
            resolved = yield* resolveSlug(slug)
          }

          if (resolved) {
            mentions.push(resolved)
          } else {
            unknown.push(match[0])
          }
        }

        const bookIds = [...new Set(mentions.map((m) => m.bookId))]
        return {
          mentions,
          unknown,
          sessionMode: mentions.length > 0 ? "targeted" : "normal",
          bookIds,
        }
      })

    return Service.of({ parse, resolveSlug, resolveTitle, resolveId, listAvailable })
  }),
)

export { BooksUnavailableError, Schema }
