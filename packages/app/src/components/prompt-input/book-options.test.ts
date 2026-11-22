import { describe, expect, test } from "bun:test"
import { listBookOptions, normalizeBookRecords, resolveBooksDbAvailability, toBookOptions } from "./book-options"

type Response = { ok: boolean; status?: number; json: () => Promise<unknown> }

const jsonResponse = (data: unknown, ok = true, status = 200): Response => ({
  ok,
  status,
  json: () => Promise.resolve(data),
})

const okFetch = (data: unknown) => async () => jsonResponse(data)

const BOOKS = {
  books: [
    { id: "b1", slug: "sahih-bukhari", title: "Sahih al-Bukhari", author: "al-Bukhari", chunkCount: 12 },
    { id: "b2", slug: "tafsir-jalalayn", title: "Tafsir al-Jalalayn", chunkCount: 4 },
  ],
}

describe("normalizeBookRecords", () => {
  test("reads the { books: [...] } envelope and filters rows without id/slug", () => {
    expect(
      normalizeBookRecords({
        books: [
          BOOKS.books[0],
          { id: "", slug: "nope" },
          { slug: "no-id" },
          null,
          "junk",
          BOOKS.books[1],
        ],
      }),
    ).toEqual([
      { id: "b1", slug: "sahih-bukhari", title: "Sahih al-Bukhari", author: "al-Bukhari" },
      { id: "b2", slug: "tafsir-jalalayn", title: "Tafsir al-Jalalayn" },
    ])
  })

  test("tolerates non-array payloads and a bare array, falling back to slug as title", () => {
    expect(normalizeBookRecords(undefined)).toEqual([])
    expect(normalizeBookRecords({ error: "boom" })).toEqual([])
    expect(normalizeBookRecords([{ id: "x1", slug: "medina" }])).toEqual([
      { id: "x1", slug: "medina", title: "medina" },
    ])
  })
})

describe("toBookOptions", () => {
  test("maps records to @book: options carrying id, slug, title and author", () => {
    expect(toBookOptions([{ id: "b1", slug: "sahih-bukhari", title: "Sahih al-Bukhari", author: "al-Bukhari" }])).toEqual([
      {
        type: "book",
        bookId: "b1",
        slug: "sahih-bukhari",
        title: "Sahih al-Bukhari",
        author: "al-Bukhari",
        display: "@book:sahih-bukhari",
      },
    ])
  })
})

describe("resolveBooksDbAvailability", () => {
  test("returns false only on an explicit booksDbAvailable:false", async () => {
    expect(await resolveBooksDbAvailability({ fetch: okFetch({ booksDbAvailable: false }), url: "/health" })).toBe(false)
    expect(await resolveBooksDbAvailability({ fetch: okFetch({ booksDbAvailable: true }), url: "/health" })).toBe(true)
    expect(await resolveBooksDbAvailability({ fetch: okFetch({}), url: "/health" })).toBeUndefined()
  })

  test("treats failing health calls (401 stale cookie, 503 bootstrap, non-JSON) as unknown", async () => {
    const fail = async () => jsonResponse({ message: "unauthorized" }, false, 401)
    expect(await resolveBooksDbAvailability({ fetch: fail, url: "/health" })).toBeUndefined()
    const boom = async () => jsonResponse({ message: "unavailable" }, false, 503)
    expect(await resolveBooksDbAvailability({ fetch: boom, url: "/health" })).toBeUndefined()
    const junk = async () => {
      throw new Error("Unexpected token < in JSON")
    }
    expect(await resolveBooksDbAvailability({ fetch: junk, url: "/health" })).toBeUndefined()
  })
})

describe("listBookOptions", () => {
  test("still fetches books when health is down — a failing gate must not block (#7)", async () => {
    const calls: string[] = []
    const fetch = async (input: string) => {
      calls.push(input)
      if (input.endsWith("/health")) return jsonResponse({ message: "unavailable" }, false, 503)
      return jsonResponse(BOOKS)
    }
    const options = await listBookOptions({ fetch, baseUrl: "http://x", retryDelayMs: 0 })
    expect(calls).toEqual(["http://x/targeted-learning/health", "http://x/targeted-learning/books"])
    expect(options.map((option) => option.display)).toEqual(["@book:sahih-bukhari", "@book:tafsir-jalalayn"])
    expect(options[0]).toMatchObject({ type: "book", bookId: "b1", slug: "sahih-bukhari", title: "Sahih al-Bukhari" })
  })

  test("retries transient /books failures before giving up", async () => {
    let bookCalls = 0
    const fetch = async (input: string) => {
      if (input.endsWith("/health")) return jsonResponse({ booksDbAvailable: true })
      bookCalls++
      if (bookCalls < 3) return jsonResponse({ message: "unavailable" }, false, 503)
      return jsonResponse(BOOKS)
    }
    const options = await listBookOptions({ fetch, baseUrl: "http://x", retryDelayMs: 0 })
    expect(bookCalls).toBe(3)
    expect(options).toHaveLength(2)
  })

  test("short-circuits on an authoritative booksDbAvailable:false and never throws to []", async () => {
    const calls: string[] = []
    const fetch = async (input: string) => {
      calls.push(input)
      if (input.endsWith("/health")) return jsonResponse({ booksDbAvailable: false })
      return jsonResponse(BOOKS)
    }
    expect(await listBookOptions({ fetch, baseUrl: "http://x" })).toEqual([])
    expect(calls).toEqual(["http://x/targeted-learning/health"])

    const alwaysFails = async () => {
      throw new Error("network down")
    }
    expect(await listBookOptions({ fetch: alwaysFails, baseUrl: "http://x", retryDelayMs: 0 })).toEqual([])
  })

  test("drops stale loads so a server/directory switch cannot apply an old response", async () => {
    let stale = false
    const calls: string[] = []
    const fetch = async (input: string) => {
      calls.push(input)
      if (input.endsWith("/health")) stale = true // server switched mid-flight
      return jsonResponse(BOOKS)
    }
    const options = await listBookOptions({ fetch, baseUrl: "http://x", isStale: () => stale, retryDelayMs: 0 })
    expect(options).toEqual([])
    expect(calls).toEqual(["http://x/targeted-learning/health"]) // /books never attempted once stale
  })
})
