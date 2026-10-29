import { createSignal, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Button } from "@diveeoi/ui/button"
import { TextField } from "@diveeoi/ui/text-field"
import { useAuth } from "@/context/auth"
import { AuthPanel, AuthSubmitButton } from "@/components/auth-panel"

export default function RegisterPage() {
  const [, { register }] = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = createSignal("")
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [confirm, setConfirm] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [registered, setRegistered] = createSignal(false)

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    setError("")

    const displayName = username().trim()
    if (displayName.length > 30) {
      setError("Display name must be 30 characters or fewer.")
      return
    }
    if (displayName && !/^[a-zA-Z0-9_-]+$/.test(displayName)) {
      setError("Use only letters, numbers, underscores, or hyphens in your display name.")
      return
    }
    if (password().length < 12 || new TextEncoder().encode(password()).byteLength > 72) {
      setError("Password must be 12–72 bytes long.")
      return
    }
    if (password() !== confirm()) {
      setError("The passwords do not match.")
      return
    }

    setLoading(true)
    try {
      await register(email(), password(), displayName || undefined)
      setRegistered(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create your account. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (registered()) {
    return (
      <AuthPanel title="Account created" description="Your account is ready to use.">
        <div class="flex flex-col gap-5">
          <p class="text-13-regular leading-5 text-text-base">
            You can now sign in as <strong class="font-medium text-text-strong">{email()}</strong>.
          </p>
          <Button type="button" variant="primary" size="large" class="w-full" onClick={() => navigate("/login", { replace: true })}>
            Continue to sign in
          </Button>
        </div>
      </AuthPanel>
    )
  }

  return (
    <AuthPanel
      title="Create your account"
      description="Set up an account for this DiveeOI instance."
      footer={
        <>
          Already have an account?{" "}
          <a href="/login" class="font-medium text-text-strong underline decoration-border-weak-base underline-offset-4 hover:text-text-base">
            Sign in
          </a>
        </>
      }
    >
      <form class="flex flex-col gap-4" onSubmit={handleSubmit}>
        <TextField
          label="Email address"
          type="email"
          name="email"
          value={email()}
          onChange={setEmail}
          placeholder="you@example.com"
          autocomplete="email"
          required
        />
        <TextField
          label="Display name (optional)"
          type="text"
          name="username"
          value={username()}
          onChange={setUsername}
          placeholder="How should we address you?"
          autocomplete="nickname"
          maxLength={30}
        />
        <TextField
          label="Password"
          type="password"
          name="new-password"
          value={password()}
          onChange={setPassword}
          placeholder="12–72 bytes"
          autocomplete="new-password"
          minLength={12}
          required
        />
        <TextField
          label="Confirm password"
          type="password"
          name="confirm-password"
          value={confirm()}
          onChange={setConfirm}
          placeholder="Re-enter your password"
          autocomplete="new-password"
          required
        />
        <Show when={error()}>
          <div role="alert" class="rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2 text-12-regular text-text-critical">
            {error()}
          </div>
        </Show>
        <AuthSubmitButton disabled={loading()}>
          {loading() ? "Creating account…" : "Create account"}
        </AuthSubmitButton>
      </form>
    </AuthPanel>
  )
}
