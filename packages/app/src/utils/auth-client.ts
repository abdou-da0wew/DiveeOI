export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
  username?: string
}

export interface AuthResponse {
  accessToken: string
  /** Returned only for headerless non-browser clients; browsers use the HttpOnly cookie. */
  refreshToken?: string
  user: {
    id: string
    email: string
    username: string
    role: string
    verified: boolean
    message_count: number
  }
}

export interface UserResponse {
  id: string
  email: string
  username: string
  role: string
  verified: boolean
  message_count: number
}

export interface UpdateProfileRequest {
  username?: string
  email?: string
  password?: string
}

// Access tokens are deliberately kept in memory only. The refresh token is
// stored by the server in an HttpOnly, SameSite cookie.
let accessToken: string | null = null
const basicByOrigin = new Map<string, string>()

export const setAccessToken = (token: string | null) => {
  accessToken = token
}
export const getAccessToken = () => accessToken

const encodeBase64Utf8 = (value: string) => {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const basicAuthorizationHeader = (credentials: { username?: string; password: string }) =>
  `Basic ${encodeBase64Utf8(`${credentials.username ?? "DIVEEOI"}:${credentials.password}`)}`

/** Keep explicit Basic credentials in memory, scoped to the selected server origin. */
export const setBasicCredentials = (serverUrl: string, credentials: { username?: string; password: string } | null) => {
  try {
    const origin = new URL(serverUrl).origin
    if (!credentials?.password) {
      basicByOrigin.delete(origin)
      return
    }
    basicByOrigin.set(origin, basicAuthorizationHeader(credentials))
  } catch {
    // Ignore malformed server URLs; the server connection validator handles them.
  }
}

export function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    if (import.meta.env.DEV) {
      // Route through Vite's same-origin proxy so browser auth never depends on
      // permissive cross-origin CORS or exposes preview-specific backend hosts.
      return window.location.origin
    }
    // The production UI is served by the API host (or its reverse proxy).
    // Preserve that origin instead of bypassing TLS/reverse-proxy routing.
    return window.location.origin
  }
  return "http://localhost:4097"
}

/** Resolve a request's origin without treating remote server URLs as app-origin requests. */
export function requestOrigin(input: RequestInfo | URL, base?: string): string | undefined {
  try {
    const fallback = base ?? (typeof window !== "undefined" ? window.location.origin : undefined)
    const target = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input)
    return new URL(target, fallback).origin
  } catch {
    return undefined
  }
}

/** Restrict account Bearer tokens to requests sent to the app's own origin. */
export function isSameOriginRequest(input: RequestInfo | URL, origin?: string): boolean {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : undefined)
  if (!base) return false
  return requestOrigin(input, base) === requestOrigin(base, base)
}

export const authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (input, init = {}) => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  if (!headers.has("Authorization")) {
    const targetOrigin = requestOrigin(input)
    const basic = targetOrigin ? basicByOrigin.get(targetOrigin) : undefined
    const token = getAccessToken()
    // Prefer the explicitly selected server's Basic credential when configured;
    // otherwise attach the account token only to the app origin. Never forward
    // ambient cookies or a JWT to an unrelated remote server automatically.
    if (basic) headers.set("Authorization", basic)
    else if (token && isSameOriginRequest(input)) headers.set("Authorization", `Bearer ${token}`)
  }
  return fetch(input, { ...init, credentials: init.credentials ?? "same-origin", headers })
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { headers, ...rest } = options
  const requestHeaders = new Headers(headers)
  if (!requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json")
  const response = await authFetch(`${getBaseUrl()}${path}`, {
    ...rest,
    credentials: "include",
    headers: requestHeaders,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { message: "Request failed" } }))
    throw new Error(body.error?.message || `HTTP ${response.status}`)
  }

  if (response.status === 204) return undefined as T
  return response.json()
}

export const authApi = {
  login: (data: LoginRequest) =>
    apiFetch<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  register: (data: RegisterRequest) =>
    apiFetch<{ user: UserResponse }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  me: (token: string) =>
    apiFetch<{ user: UserResponse }>("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    }),

  // Refresh is backed by the HttpOnly cookie; JavaScript never reads it.
  refresh: () =>
    apiFetch<AuthResponse>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  logout: (token?: string | null) =>
    apiFetch<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    }),

  verifyEmail: (token: string) =>
    apiFetch<{ ok: boolean }>(`/api/auth/verify-email?token=${encodeURIComponent(token)}`),

  resendVerification: (email: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  updateProfile: (token: string, data: UpdateProfileRequest) =>
    apiFetch<{ user: UserResponse }>("/api/auth/profile", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    }),

  getMessageCount: (token: string) =>
    apiFetch<{ user: UserResponse }>("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    }).then((res) => res.user.message_count),
}
