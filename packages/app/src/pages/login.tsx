import { createSignal, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { TextField } from "@diveeoi/ui/text-field"
import { useAuth } from "@/context/auth"
import { useServer } from "@/context/server"
import { AuthPanel, AuthSubmitButton } from "@/components/auth-panel"
import { authFetch, getBaseUrl } from "@/utils/auth-client"
import { authTokenFromCredentials } from "@/utils/server"

export default function LoginPage() {
  const [, { login }] = useAuth()
  const server = useServer()
  const navigate = useNavigate()
  const initialUsername = server.current?.type === "http" ? server.current.http.username : undefined
  const [username, setUsername] = createSignal(initialUsername || "DIVEEOI")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    setError("")
    setLoading(true)
    try {
      const connection = server.current
      const url = connection?.type === "http" ? connection.http.url : getBaseUrl()
      const credential = { username: username().trim(), password: password() }
      const basic = await authFetch(`${url}/global/health`, {
        headers: {
          Authorization: `Basic ${authTokenFromCredentials(credential)}`,
        },
        cache: "no-store",
      }).catch(() => undefined)

      if (basic?.ok) {
        server.setCredentials({ url, ...credential })
      } else {
        // Do not let an old or rejected Basic secret take precedence over a
        // successful JWT login in the session's origin-scoped fetch helper.
        server.clearCredentials({ url })
        // JWT account auth remains available for instances configured without
        // Basic credentials. The same project-styled form supports either mode.
        await login(credential.username, credential.password)
      }
      navigate("/", { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in. Check your details and try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthPanel
      title="Welcome back"
      description="Sign in to continue to your DiveeOI workspace."
      footer={
        <>
          New to this instance?{" "}
          <a href="/register" class="font-medium text-text-strong underline decoration-border-weak-base underline-offset-4 hover:text-text-base">
            Create an account
          </a>
        </>
      }
    >
      <form class="flex flex-col gap-4" onSubmit={handleSubmit}>
        <TextField
          label="Username or email"
          type="text"
          name="username"
          value={username()}
          onChange={setUsername}
          placeholder="DIVEEOI or you@example.com"
          autocomplete="username"
          required
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          value={password()}
          onChange={setPassword}
          placeholder={import.meta.env.DEV ? "Default for local development: divee" : "Enter your password"}
          autocomplete="current-password"
          required
        />
        <Show when={error()}>
          <div role="alert" class="rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2 text-12-regular text-text-critical">
            {error()}
          </div>
        </Show>
        <AuthSubmitButton disabled={loading()}>
          {loading() ? "Signing in…" : "Sign in"}
        </AuthSubmitButton>
      </form>
    </AuthPanel>
  )
}
