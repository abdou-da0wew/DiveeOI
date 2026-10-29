import { describe, expect, test } from "bun:test"
import { isBrowserRequest } from "../src/auth/refresh-transport"

describe("refresh token transport", () => {
  test("treats browser Origin and Fetch Metadata requests as cookie-only", () => {
    expect(isBrowserRequest({ origin: "https://app.example.test" })).toBe(true)
    expect(isBrowserRequest({ "sec-fetch-site": "same-origin" })).toBe(true)
    expect(isBrowserRequest({ "sec-fetch-mode": "cors" })).toBe(true)
  })

  test("preserves body-token compatibility for headerless clients", () => {
    expect(isBrowserRequest({})).toBe(false)
  })
})
