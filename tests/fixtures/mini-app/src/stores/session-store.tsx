import { createContext, createStore, useContext } from "solid-js"
import type { ParentProps } from "solid-js"

interface SessionState {
  user: { id: string; name: string } | null
  token: string | null
  isAuthenticated: boolean
}

const SessionContext = createContext<[SessionState, { login: (token: string) => void; logout: () => void }]>()

export function SessionProvider(props: ParentProps) {
  const [state, setState] = createStore<SessionState>({
    user: null,
    token: null,
    isAuthenticated: false,
  })

  const login = (token: string) => {
    setState({ token, isAuthenticated: true })
  }

  const logout = () => {
    setState({ user: null, token: null, isAuthenticated: false })
  }

  return (
    <SessionContext.Provider value={[state, { login, logout }]}>
      {props.children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used within SessionProvider")
  return ctx
}
