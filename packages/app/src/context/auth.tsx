import { createContext, useContext } from "solid-js"
import { type UserResponse } from "../utils/auth-client"

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
  // Auth disabled — always authenticated, no loading, no API calls
  const state: AuthState = {
    user: null,
    accessToken: null,
    isAuthenticated: true,
    isLoading: false,
    messageCount: 0,
  }

  const actions: AuthActions = {
    login: async () => {},
    logout: async () => {},
    register: async () => {},
    refreshAccessToken: async () => null,
    updateProfile: async () => {},
    startVerificationPolling: () => {},
    stopVerificationPolling: () => {},
  }

  return (
    <AuthContext.Provider value={[state, actions]}>
      {props.children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
