import { createOpencodeClient } from "@diveeoi/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"
import {
  basicAuthorizationForRequest,
  basicAuthorizationHeader,
  getAccessToken,
  isSameOriginRequest,
  setBasicCredentials,
} from "@/utils/auth-client"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return basicAuthorizationHeader(input).slice("Basic ".length)
}

/**
 * Build a server-scoped fetcher whose Basic credentials are read for every request.
 * SDK instances can outlive login/logout, so auth must not be snapshotted at construction.
 */
export function createServerFetch(serverUrl: string, baseFetch: typeof fetch = globalThis.fetch) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))

    const basic = basicAuthorizationForRequest(input, serverUrl)
    if (basic) {
      // The selected server's current Basic credentials take precedence over any
      // credentials captured by a previously-created SDK client.
      headers.set("Authorization", basic)
    } else if (!headers.has("Authorization") && isSameOriginRequest(input)) {
      const token = getAccessToken()
      if (token) headers.set("Authorization", `Bearer ${token}`)
    }

    return baseFetch(input, { ...init, headers })
  }
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
  if (server.password) {
    setBasicCredentials(server.url, { username: server.username, password: server.password })
  }

  return createOpencodeClient({
    ...config,
    fetch: createServerFetch(server.url, config.fetch ?? globalThis.fetch) as typeof fetch,
    headers: config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers,
    baseUrl: server.url,
  })
}
