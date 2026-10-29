import { describe, expect, test } from "bun:test"
import { authFetch, basicAuthorizationHeader, isSameOriginRequest, setAccessToken, setBasicCredentials } from "./auth-client"

describe("isSameOriginRequest", () => {
  const origin = "https://app.example.test"

  test("accepts relative and absolute requests on the app origin", () => {
    expect(isSameOriginRequest("/api/auth/refresh", origin)).toBe(true)
    expect(isSameOriginRequest("https://app.example.test/api/session", origin)).toBe(true)
    expect(isSameOriginRequest(new URL("https://app.example.test/api/global"), origin)).toBe(true)
  })

  test("rejects remote hosts, scheme changes, and port changes", () => {
    expect(isSameOriginRequest("https://other.example.test/api/session", origin)).toBe(false)
    expect(isSameOriginRequest("http://app.example.test/api/session", origin)).toBe(false)
    expect(isSameOriginRequest("https://app.example.test:8443/api/session", origin)).toBe(false)
  })

  test("checks Request objects by their final URL", () => {
    expect(isSameOriginRequest(new Request("https://app.example.test/api/auth/me"), origin)).toBe(true)
    expect(isSameOriginRequest(new Request("https://other.example.test/api/auth/me"), origin)).toBe(false)
  })
})

describe("authFetch server credentials", () => {
  test("sends Basic only to the explicitly registered server origin and keeps JWT app-local", async () => {
    const originalFetch = globalThis.fetch
    const requests: Request[] = []
    const credentialModes: Array<RequestCredentials | undefined> = []
    const remoteOrigin = "https://remote.example.test"
    const expectedBasic = basicAuthorizationHeader({ username: "DIVEEOI", password: "divee" })
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      credentialModes.push(init?.credentials)
      return new Response(null, { status: 200 })
    }) as typeof fetch

    setBasicCredentials(remoteOrigin, { username: "DIVEEOI", password: "divee" })
    setAccessToken("account-token")
    try {
      await authFetch(`${remoteOrigin}/targeted-learning/books`)
      await authFetch("https://other.example.test/api/session")

      expect(requests[0]?.headers.get("Authorization")).toBe(expectedBasic)
      expect(credentialModes[0]).toBe("same-origin")
      expect(requests[1]?.headers.has("Authorization")).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      setBasicCredentials(remoteOrigin, null)
      setAccessToken(null)
    }
  })

  test("encodes non-ASCII Basic credentials as UTF-8", () => {
    const header = basicAuthorizationHeader({ username: "مستخدم", password: "كلمة" })
    const encoded = header.slice("Basic ".length)
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    expect(new TextDecoder().decode(bytes)).toBe("مستخدم:كلمة")
  })
})
