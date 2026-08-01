import { type Accessor, type Setter, createContext, createEffect, createSignal, onMount, useContext } from "solid-js"
import { authApi, type UserResponse } from "../utils/auth-client"

interface AuthState {
  user: UserResponse | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  messageCount: number
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  register: (email: string, password: string, username?: string) => Promise<void>
  refreshAccessToken: () => Promise<string | null>
  updateProfile: (data: { username?: string; email?: string; password?: string }) => Promise<void>
  startVerificationPolling: (token: string) => void
  stopVerificationPolling: () => void
}

type AuthContextValue = [state: AuthState, actions: AuthActions]

const AuthContext = createContext<AuthContextValue>([
  { user: null, accessToken: null, isAuthenticated: false, isLoading: true, messageCount: 0 },
  {
    login: async () => {},
    logout: async () => {},
    register: async () => {},
    refreshAccessToken: async () => null,
    updateProfile: async () => {},
    startVerificationPolling: () => {},
    stopVerificationPolling: () => {},
  },
])

export function AuthProvider(props: { children: any }) {
  const [user, setUser] = createSignal<UserResponse | null>(null)
  const [accessToken, setAccessToken] = createSignal<string | null>(null)
  const [isLoading, setIsLoading] = createSignal(true)
  const [messageCount, setMessageCount] = createSignal(0)

  const isAuthenticated = () => !!accessToken()

  let pollingInterval: ReturnType<typeof setInterval> | null = null

  function startVerificationPolling(token: string): void {
    if (pollingInterval) return
    pollingInterval = setInterval(async () => {
      try {
        const result = await authApi.me(token)
        if (result.user.verified) {
          setUser(result.user)
          setMessageCount(result.user.message_count)
          stopVerificationPolling()
        }
      } catch {
        // Silent fail — polling continues
      }
    }, 5000)
  }

  function stopVerificationPolling(): void {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
  }

  onMount(async () => {
    try {
      const result = await authApi.refresh()
      setAccessToken(result.accessToken)
      setUser(result.user)
      setMessageCount(result.user.message_count)

      if (!result.user.verified) {
        startVerificationPolling(result.accessToken)
      }
    } catch {
      setAccessToken(null)
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  })

  async function refreshAccessToken(): Promise<string | null> {
    try {
      const result = await authApi.refresh()
      setAccessToken(result.accessToken)
      setUser(result.user)
      setMessageCount(result.user.message_count)
      return result.accessToken
    } catch {
      setAccessToken(null)
      setUser(null)
      return null
    }
  }

  async function login(email: string, password: string): Promise<void> {
    const result = await authApi.login({ email, password })
    setAccessToken(result.accessToken)
    setUser(result.user)
    setMessageCount(result.user.message_count)
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout()
    } finally {
      stopVerificationPolling()
      setAccessToken(null)
      setUser(null)
    }
  }

  async function register(email: string, password: string, username?: string): Promise<void> {
    await authApi.register({ email, password, username })
  }

  async function updateProfile(data: { username?: string; email?: string; password?: string }): Promise<void> {
    const token = accessToken()
    if (!token) throw new Error("Not authenticated")
    const result = await authApi.updateProfile(token, data)
    setUser(result.user)
    setMessageCount(result.user.message_count)
  }

  const state: AuthState = {
    get user() { return user() },
    get accessToken() { return accessToken() },
    get isAuthenticated() { return isAuthenticated() },
    get isLoading() { return isLoading() },
    get messageCount() { return messageCount() },
  }

  const actions: AuthActions = { login, logout, register, refreshAccessToken, updateProfile, startVerificationPolling, stopVerificationPolling }

  return (
    <AuthContext.Provider value={[state, actions]}>
      {props.children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
