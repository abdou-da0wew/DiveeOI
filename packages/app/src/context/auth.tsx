import { createContext, onCleanup, onMount, useContext } from "solid-js"
import { createStore } from "solid-js/store"
import { authApi, setAccessToken, type UserResponse } from "../utils/auth-client"

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

const REFRESH_BEFORE_EXPIRY_MS = 12 * 60 * 1000

export function AuthProvider(props: { children: any }) {
  const [state, setState] = createStore({
    user: null as UserResponse | null,
    accessToken: null as string | null,
    isLoading: true,
  })
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let refreshInFlight: Promise<string | null> | undefined
  let disposed = false

  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    if (!state.accessToken || disposed) return
    refreshTimer = setTimeout(() => void refreshAccessToken(), REFRESH_BEFORE_EXPIRY_MS)
  }

  const apply = (response: { accessToken: string; user: UserResponse }) => {
    setAccessToken(response.accessToken)
    setState({ accessToken: response.accessToken, user: response.user, isLoading: false })
    scheduleRefresh()
  }

  const clear = () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = undefined
    setAccessToken(null)
    setState({ accessToken: null, user: null, isLoading: false })
  }

  const refreshAccessToken = (): Promise<string | null> => {
    if (refreshInFlight) return refreshInFlight
    refreshInFlight = authApi
      .refresh()
      .then((response) => {
        if (disposed) return null
        apply(response)
        return response.accessToken
      })
      .catch(() => {
        if (!disposed) clear()
        return null
      })
      .finally(() => {
        refreshInFlight = undefined
      })
    return refreshInFlight
  }

  const login = async (email: string, password: string) => {
    const response = await authApi.login({ email, password })
    apply(response)
  }

  const logout = async () => {
    const token = state.accessToken
    try {
      await authApi.logout(token)
    } finally {
      clear()
    }
  }

  const register = async (email: string, password: string, username?: string) => {
    await authApi.register({ email, password, username })
  }

  const updateProfile = async (data: { username?: string; email?: string; password?: string }) => {
    const token = state.accessToken
    if (!token) throw new Error("You must be signed in to update your profile")
    const response = await authApi.updateProfile(token, data)
    setState("user", response.user)
    if (data.password !== undefined || data.email !== undefined) {
      // The server revokes refresh sessions after sensitive profile changes.
      // Require a fresh login instead of keeping stale credentials in memory.
      clear()
    }
  }

  const actions: AuthActions = {
    login,
    logout,
    register,
    refreshAccessToken,
    updateProfile,
    // Email delivery is not configured in the server yet; these methods remain
    // for the legacy account page API but do not start a misleading poll loop.
    startVerificationPolling: () => {},
    stopVerificationPolling: () => {},
  }

  onMount(() => {
    void refreshAccessToken().finally(() => {
      if (!disposed) setState("isLoading", false)
    })
  })
  onCleanup(() => {
    disposed = true
    if (refreshTimer) clearTimeout(refreshTimer)
  })

  const stateView: AuthState = {
    get user() {
      return state.user
    },
    get accessToken() {
      return state.accessToken
    },
    get isAuthenticated() {
      return !!state.user && !!state.accessToken
    },
    get isLoading() {
      return state.isLoading
    },
    get messageCount() {
      return state.user?.message_count ?? 0
    },
  }

  return <AuthContext.Provider value={[stateView, actions]}>{props.children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
