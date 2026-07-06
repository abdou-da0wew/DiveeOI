import { useSession } from "../../stores/session-store"

export function Header() {
  const [session] = useSession()

  return (
    <header data-component="header" class="flex h-12 items-center justify-between border-b px-4">
      <span data-slot="header-title">Mini App</span>
      <div data-slot="header-actions">
        {session.isAuthenticated ? (
          <span>{session.user?.name || "User"}</span>
        ) : (
          <button>Login</button>
        )}
      </div>
    </header>
  )
}
