import { createOpencodeClient } from "@diveeoi/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { basicAuthorizationHeader, getAccessToken, isSameOriginRequest, setBasicCredentials } from "@/utils/auth-client"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return basicAuthorizationHeader(input).slice("Basic ".length)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "DIVEEOI",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    setBasicCredentials(server.url, { username: server.username, password: server.password })
    return { Authorization: basicAuthorizationHeader({ username: server.username, password: server.password }) }
  })()
  const baseFetch = config.fetch ?? globalThis.fetch
  const sessionFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    // Explicit Basic credentials retain precedence for shared-password servers;
    // account JWT is injected dynamically for JWT-only deployments.
    if (!headers.has("Authorization") && isSameOriginRequest(input)) {
      const token = getAccessToken()
      if (token) headers.set("Authorization", `Bearer ${token}`)
    }
    return baseFetch(input, { ...init, headers })
  }

  return createOpencodeClient({
    ...config,
    fetch: sessionFetch as typeof fetch,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}
