import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createSdkForServer, createServerFetch } from "./server"
import { basicAuthorizationHeader, setBasicCredentials } from "./auth-client"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to DIVEEOI", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "DIVEEOI", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("DIVEEOI:secret"))
  })
})

describe("createServerFetch", () => {
  test("the generated SDK picks up credentials entered after client creation", async () => {
    const origin = "https://sdk.example.test"
    const requests: Request[] = []
    const fakeFetch = (async (input, init) => {
      requests.push(new Request(input, init))
      return new Response(JSON.stringify({ healthy: true, version: "test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch
    const sdk = createSdkForServer({ server: { url: origin }, fetch: fakeFetch })

    try {
      setBasicCredentials(origin, { username: "DIVEEOI", password: "login-password" })
      await sdk.global.health()

      expect(requests).toHaveLength(1)
      expect(new URL(requests[0]!.url).pathname).toBe("/global/health")
      expect(requests[0]?.headers.get("Authorization")).toBe(
        basicAuthorizationHeader({ username: "DIVEEOI", password: "login-password" }),
      )
    } finally {
      setBasicCredentials(origin, null)
    }
  })

  test("uses current Basic credentials even when the SDK fetcher predates login", async () => {
    const origin = "https://remote.example.test"
    const requests: Request[] = []
    const fakeFetch = (async (input, init) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input)
      requests.push(new Request(new URL(url, origin), init))
      return new Response(null, { status: 200 })
    }) as typeof fetch
    const sessionFetch = createServerFetch(origin, fakeFetch)

    try {
      setBasicCredentials(origin, { username: "DIVEEOI", password: "first-password" })
      await sessionFetch(`${origin}/global/health`)

      setBasicCredentials(origin, { username: "DIVEEOI", password: "updated-password" })
      await sessionFetch(`${origin}/session`, {
        headers: { Authorization: "Basic stale-sdk-credential" },
      })

      expect(requests[0]?.headers.get("Authorization")).toBe(
        basicAuthorizationHeader({ username: "DIVEEOI", password: "first-password" }),
      )
      expect(requests[1]?.headers.get("Authorization")).toBe(
        basicAuthorizationHeader({ username: "DIVEEOI", password: "updated-password" }),
      )

      setBasicCredentials(origin, null)
      await sessionFetch(`${origin}/provider`)
      expect(requests[2]?.headers.has("Authorization")).toBe(false)
    } finally {
      setBasicCredentials(origin, null)
    }
  })

  test("resolves relative SDK paths against the selected server URL", async () => {
    const origin = "https://relative.example.test/base"
    const requests: Request[] = []
    const fakeFetch = (async (input, init) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input)
      requests.push(new Request(new URL(url, origin), init))
      return new Response(null, { status: 200 })
    }) as typeof fetch
    setBasicCredentials(origin, { username: "kit", password: "secret" })

    try {
      await createServerFetch(origin, fakeFetch)("/global/config")
      expect(requests[0]?.url).toBe("https://relative.example.test/global/config")
      expect(requests[0]?.headers.get("Authorization")).toBe(
        basicAuthorizationHeader({ username: "kit", password: "secret" }),
      )
    } finally {
      setBasicCredentials(origin, null)
    }
  })
})
