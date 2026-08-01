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

export function getBaseUrl(): string {
  const port = typeof import.meta !== "undefined"
    ? import.meta.env.VITE_DIVEEOI_SERVER_PORT ?? "4097"
    : "4097"
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:${port}`
  }
  return `http://localhost:${port}`
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getBaseUrl()
  const url = `${baseUrl}${path}`
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { message: "Request failed" } }))
    throw new Error(body.error?.message || `HTTP ${response.status}`)
  }

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

  me: (accessToken: string) =>
    apiFetch<{ user: UserResponse }>("/api/auth/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),

  refresh: () =>
    apiFetch<AuthResponse>("/api/auth/refresh", {
      method: "POST",
    }),

  logout: () =>
    apiFetch<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
    }),

  verifyEmail: (token: string) =>
    apiFetch<{ ok: boolean }>(`/api/auth/verify-email?token=${encodeURIComponent(token)}`),

  resendVerification: (email: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  updateProfile: (accessToken: string, data: UpdateProfileRequest) =>
    apiFetch<{ user: UserResponse }>("/api/auth/profile", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(data),
    }),

  getMessageCount: (accessToken: string) =>
    apiFetch<{ user: UserResponse }>("/api/auth/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((res) => res.user.message_count),
}
