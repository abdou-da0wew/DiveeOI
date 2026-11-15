import { describe, expect, test } from "bun:test"
import { parseUserMessage } from "./user-message-metadata"
import { parseUsrQuotations, serializeUsrQuotation, stripUsrQuotation } from "./usr-quote"

describe("user quotations", () => {
  test("wraps quoted context in a reusable disclosure envelope", () => {
    const encoded = serializeUsrQuotation(
      {
        v: 1,
        action: "explain",
        source: "book",
        text: "A quoted paragraph",
        bookId: "book-1",
        page: 12,
        bookTitle: "Science",
      },
      "Explain this passage.",
    )
    const parsed = parseUserMessage(encoded)

    expect(parsed?.presentation).toEqual({
      kind: "quotation",
      label: "Quoted context",
      summary: "Science · p.12",
      metadata: { source: "book", action: "explain", page: 12, book: "Science" },
    })
    expect(parseUsrQuotations(parsed?.body ?? "")).toHaveLength(1)
    expect(stripUsrQuotation(parsed?.body ?? "")).toBe("Explain this passage.")
  })

  test("keeps agent-sourced quotation metadata without inventing book references", () => {
    const encoded = serializeUsrQuotation(
      { v: 1, action: "ask", source: "agent", text: "An earlier answer", messageID: "message-1" },
      "Can you clarify this?",
    )
    const parsed = parseUserMessage(encoded)

    expect(parsed?.presentation.summary).toBe("From a previous answer")
    expect(parseUsrQuotations(parsed?.body ?? "")[0]?.messageID).toBe("message-1")
  })
})
