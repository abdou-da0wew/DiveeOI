import { Dialog } from "@diveeoi/ui/dialog"
import { Icon } from "@diveeoi/ui/icon"
import { Spinner } from "@diveeoi/ui/spinner"
import { Button } from "@diveeoi/ui/button"
import { createSignal, Show, type Component } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { useLanguage } from "@/context/language"

/**
 * Remote session setup dialog (draft-10 remote sessions).
 *
 * Lets the user configure an SSH connection for the current session. When
 * active, all file/shell/env operations are redirected to the remote host.
 * The local context is still accessible via ctx_local=true on tool calls.
 *
 * Fields: host, port, user, auth method (password/key/agent), working
 * directory, and a Test Connection button that probes the SSH server.
 */

type AuthMethod = "password" | "privateKey" | "agent"

export function DialogSessionRemote(props: { sessionID: string }) {
  const serverSDK = useServerSDK()
  const server = useServer()
  const language = useLanguage()

  const [host, setHost] = createSignal("")
  const [port, setPort] = createSignal("22")
  const [user, setUser] = createSignal("")
  const [authMethod, setAuthMethod] = createSignal<AuthMethod>("password")
  const [password, setPassword] = createSignal("")
  const [keyPath, setKeyPath] = createSignal("")
  const [passphrase, setPassphrase] = createSignal("")
  const [workingDir, setWorkingDir] = createSignal("")
  const [testing, setTesting] = createSignal(false)
  const [testResult, setTestResult] = createSignal<string | undefined>(undefined)
  const [connecting, setConnecting] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const authHeaders = (): Record<string, string> => {
    const current = server.current
    if (!current || current.type !== "http") return {}
    const http = current.http
    if (!http.password) return {}
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`,
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(undefined)
    setError(undefined)
    try {
      const res = await fetch(`${serverSDK().url}/api/v1/remote/probe`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          host: host(),
          port: parseInt(port(), 10),
          user: user(),
          auth: buildAuth(),
          workingDirectory: workingDir() || "/",
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setTestResult(`Connected — platform: ${json.platform}`)
      } else {
        setTestResult(`Failed: ${json.reason}`)
      }
    } catch (err) {
      setTestResult(`Error: ${(err as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  const buildAuth = () => {
    switch (authMethod()) {
      case "password":
        return { kind: "password" as const, password: password() }
      case "privateKey":
        return { kind: "privateKey" as const, keyPath: keyPath(), passphrase: passphrase() || undefined }
      case "agent":
        return { kind: "agent" as const }
    }
  }

  const connect = async () => {
    setConnecting(true)
    setError(undefined)
    try {
      // Set the session's metadata.remote via the session API
      const res = await fetch(`${serverSDK().url}/api/session/${props.sessionID}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: {
            remote: {
              host: host(),
              port: parseInt(port(), 10),
              user: user(),
              auth: buildAuth(),
              workingDirectory: workingDir() || "/",
            },
          },
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        setError(`Failed to set remote: ${text}`)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    setConnecting(true)
    try {
      await fetch(`${serverSDK().url}/api/session/${props.sessionID}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { remote: null } }),
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Dialog size="large">
      <div class="dialog-session-remote">
        <div class="dialog-session-remote-header">
          <Icon name="server" />
          <h2>{language.t("session.remote.title") || "Remote SSH Session"}</h2>
        </div>

        <p class="dialog-session-remote-description">
          {language.t("session.remote.description") ||
            "Connect this session to a remote SSH server. All file, shell, and environment operations will run on the remote host. Use ctx_local=true on any tool call to run it locally."}
        </p>

        <div class="dialog-session-remote-form">
          <div class="dialog-session-remote-row">
            <label>Host</label>
            <input
              type="text"
              placeholder="example.com or 192.168.1.100"
              value={host()}
              onInput={(e) => setHost(e.currentTarget.value)}
            />
          </div>
          <div class="dialog-session-remote-row">
            <label>Port</label>
            <input
              type="number"
              placeholder="22"
              value={port()}
              onInput={(e) => setPort(e.currentTarget.value)}
            />
          </div>
          <div class="dialog-session-remote-row">
            <label>User</label>
            <input
              type="text"
              placeholder="username"
              value={user()}
              onInput={(e) => setUser(e.currentTarget.value)}
            />
          </div>
          <div class="dialog-session-remote-row">
            <label>Working directory</label>
            <input
              type="text"
              placeholder="/home/user/project"
              value={workingDir()}
              onInput={(e) => setWorkingDir(e.currentTarget.value)}
            />
          </div>
          <div class="dialog-session-remote-row">
            <label>Auth method</label>
            <select
              value={authMethod()}
              onChange={(e) => setAuthMethod(e.currentTarget.value as AuthMethod)}
            >
              <option value="password">Password</option>
              <option value="privateKey">Private key</option>
              <option value="agent">SSH agent</option>
            </select>
          </div>

          <Show when={authMethod() === "password"}>
            <div class="dialog-session-remote-row">
              <label>Password</label>
              <input
                type="password"
                placeholder="password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
            </div>
          </Show>

          <Show when={authMethod() === "privateKey"}>
            <div class="dialog-session-remote-row">
              <label>Key path</label>
              <input
                type="text"
                placeholder="~/.ssh/id_rsa"
                value={keyPath()}
                onInput={(e) => setKeyPath(e.currentTarget.value)}
              />
            </div>
            <div class="dialog-session-remote-row">
              <label>Passphrase (optional)</label>
              <input
                type="password"
                placeholder="passphrase"
                value={passphrase()}
                onInput={(e) => setPassphrase(e.currentTarget.value)}
              />
            </div>
          </Show>
        </div>

        <div class="dialog-session-remote-actions">
          <Button
            variant="secondary"
            onClick={testConnection}
            disabled={testing() || !host() || !user()}
          >
            <Show when={testing()}>
              <Spinner />
            </Show>
            {language.t("session.remote.test") || "Test connection"}
          </Button>
          <Button
            variant="primary"
            onClick={connect}
            disabled={connecting() || !host() || !user()}
          >
            {language.t("session.remote.connect") || "Connect"}
          </Button>
        </div>

        <Show when={testResult()}>
          <div class="dialog-session-remote-test-result">{testResult()}</div>
        </Show>

        <Show when={error()}>
          <div class="dialog-session-remote-error">{error()}</div>
        </Show>

        <div class="dialog-session-remote-disconnect">
          <Button variant="ghost" onClick={disconnect} disabled={connecting()}>
            {language.t("session.remote.disconnect") || "Disconnect (return to local)"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
