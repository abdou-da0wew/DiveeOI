import { createSignal } from "solid-js"
import { useAuth } from "../context/auth"
import { useNavigate } from "@solidjs/router"
import { authApi } from "../utils/auth-client"

export default function LoginPage() {
  const [state, { login }] = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [resending, setResending] = createSignal(false)
  const [resendMsg, setResendMsg] = createSignal("")
  const [showVerifyOverlay, setShowVerifyOverlay] = createSignal(false)
  const [overlayUsername, setOverlayUsername] = createSignal("")

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      await login(email(), password())
      if (state.user && !state.user.verified) {
        setOverlayUsername(state.user.username || "")
        setShowVerifyOverlay(true)
      } else {
        navigate("/")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setLoading(false)
    }
  }

  async function handleOverlaySkip() {
    if (overlayUsername()) {
      try {
        if (state.accessToken) {
          await authApi.updateProfile(state.accessToken, { username: overlayUsername() })
        }
      } catch {
        // Silent: username is optional
      }
    }
    setShowVerifyOverlay(false)
    navigate("/")
  }

  async function handleResend() {
    if (!email()) return
    setResending(true)
    setResendMsg("")
    try {
      await authApi.resendVerification(email())
      setResendMsg("Verification email sent! Check your inbox.")
    } catch (err) {
      setResendMsg(err instanceof Error ? err.message : "Failed to resend")
    } finally {
      setResending(false)
    }
  }

  return (
    <div style="display: flex; min-height: 100vh; align-items: center; justify-content: center; background: #f5f5f5;">
      <div style="width: 100%; max-width: 400px; padding: 32px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <h1 style="font-size: 24px; margin: 0 0 24px; text-align: center;">Sign in to DiveeOI</h1>
        
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
            <label style="display: block; margin-bottom: 4px; font-weight: 500;">Password</label>
            <input
              type="password"
              required
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
            />
          </div>

          {error() && (
            <div style="color: #e53e3e; font-size: 14px; margin-bottom: 12px;">{error()}</div>
          )}

          {resendMsg() && (
            <div style="color: #38a169; font-size: 14px; margin-bottom: 12px;">{resendMsg()}</div>
          )}

          <button
            type="submit"
            disabled={loading()}
            style="width: 100%; padding: 10px; background: #0066ff; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer;"
          >
            {loading() ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div style="margin-top: 16px; text-align: center; font-size: 14px;">
          <a href="/register" style="color: #0066ff; text-decoration: none;">Create an account</a>
          <span style="margin: 0 8px; color: #ccc;">|</span>
          <button onClick={handleResend} disabled={resending()} style="background: none; border: none; color: #0066ff; cursor: pointer; font-size: 14px; text-decoration: underline;">
            {resending() ? "Sending..." : "Resend verification"}
          </button>
        </div>
      </div>

      {showVerifyOverlay() && (
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;">
          <div style="width: 100%; max-width: 420px; padding: 32px; background: white; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.15);">
            <h2 style="font-size: 20px; margin: 0 0 8px;">Verify your email</h2>
            <p style="color: #555; margin: 0 0 20px; line-height: 1.5;">We sent a verification link to <strong>{email()}</strong>. You can also set a display name below.</p>
            <div style="margin-bottom: 16px;">
              <label style="display: block; margin-bottom: 4px; font-weight: 500;">Display name (optional)</label>
              <input type="text" value={overlayUsername()} onInput={(e) => setOverlayUsername(e.currentTarget.value)} style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" placeholder="Your display name" maxLength={30} />
            </div>
            <div style="color: #38a169; font-size: 14px; margin-bottom: 12px;">Checking for verification every 5 seconds...</div>
            <div style="margin-top: 16px;">
              <button onClick={handleOverlaySkip} style="width: 100%; padding: 10px; background: #6b7280; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer;">Skip for now (10 free messages)</button>
            </div>
            <div style="margin-top: 12px; text-align: center;">
              <button onClick={handleResend} disabled={resending()} style="background: none; border: none; color: #0066ff; cursor: pointer; font-size: 14px; text-decoration: underline;">{resending() ? "Sending..." : "Resend verification email"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
