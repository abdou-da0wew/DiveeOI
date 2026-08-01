import { createSignal } from "solid-js"
import { useAuth } from "../context/auth"
import { useNavigate } from "@solidjs/router"

export default function RegisterPage() {
  const [{ isAuthenticated }, { register }] = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = createSignal("")
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [confirm, setConfirm] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [registered, setRegistered] = createSignal(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError("")

    const uname = username().trim()
    if (uname && uname.length > 30) {
      setError("Username must be 30 characters or fewer")
      return
    }
    if (uname && !/^[a-zA-Z0-9_-]+$/.test(uname)) {
      setError("Username can only contain letters, numbers, underscores, and hyphens")
      return
    }

    if (!email().includes("@")) {
      setError("Please enter a valid email address")
      return
    }
    if (password().length < 8) {
      setError("Password must be at least 8 characters")
      return
    }
    if (password() !== confirm()) {
      setError("Passwords do not match")
      return
    }

    setLoading(true)
    try {
      await register(email(), password(), uname || undefined)
      setRegistered(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed")
    } finally {
      setLoading(false)
    }
  }

  if (registered()) {
    return (
      <div style="display: flex; min-height: 100vh; align-items: center; justify-content: center; background: #f5f5f5;">
        <div style="width: 100%; max-width: 400px; padding: 32px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center;">
          <h1 style="font-size: 24px; margin: 0 0 16px;">Check your email</h1>
          <p style="color: #555; line-height: 1.5; margin: 0 0 24px;">
            We sent a verification link to <strong>{email()}</strong>.
            Click the link in the email to activate your account, then sign in.
          </p>
          <a href="/login" style="color: #0066ff; text-decoration: none;">Go to sign in</a>
        </div>
      </div>
    )
  }

  return (
    <div style="display: flex; min-height: 100vh; align-items: center; justify-content: center; background: #f5f5f5;">
      <div style="width: 100%; max-width: 400px; padding: 32px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <h1 style="font-size: 24px; margin: 0 0 24px; text-align: center;">Create your account</h1>
        
        <form onSubmit={handleSubmit}>
          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Email</label>
            <input
              type="email"
              required
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
              placeholder="you@example.com"
            />
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Username (optional)</label>
            <input
              type="text"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
              placeholder="Your display name"
              maxLength={30}
            />
          </div>
          
          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
              placeholder="At least 8 characters"
            />
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Confirm password</label>
            <input
              type="password"
              required
              value={confirm()}
              onInput={(e) => setConfirm(e.currentTarget.value)}
              style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
            />
          </div>

          {error() && (
            <div style="color: #e53e3e; font-size: 14px; margin-bottom: 12px;">{error()}</div>
          )}

          <button
            type="submit"
            disabled={loading()}
            style="width: 100%; padding: 10px; background: #0066ff; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer;"
          >
            {loading() ? "Creating account..." : "Create account"}
          </button>
        </form>

        <div style="margin-top: 16px; text-align: center; font-size: 14px;">
          Already have an account?{" "}
          <a href="/login" style="color: #0066ff; text-decoration: none;">Sign in</a>
        </div>
      </div>
    </div>
  )
}
