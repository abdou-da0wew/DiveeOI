import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@diveeoi/ui/v2/dialog-v2"
import { SelectV2 } from "@diveeoi/ui/v2/select-v2"
import { TextInputV2 } from "@diveeoi/ui/v2/text-input-v2"
import { useDialog } from "@diveeoi/ui/context/dialog"
import { Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { useLanguage } from "@/context/language"
import "./dialog-session-remote.css"

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

type RemoteAuth =
  | { kind: "password"; password: string }
  | { kind: "privateKey"; keyPath: string; passphrase?: string }
  | { kind: "agent" }

const AUTH_METHODS: AuthMethod[] = ["password", "privateKey", "agent"]

const AUTH_LABELS: Record<AuthMethod, [key: string, fallback: string]> = {
  password: ["session.remote.auth.password", "Password"],
  privateKey: ["session.remote.auth.privateKey", "Private key"],
  agent: ["session.remote.auth.agent", "SSH agent"],
}

export const DialogSessionRemote: Component<{ sessionID: string }> = (props) => {
  const serverSDK = useServerSDK()
  const server = useServer()
  const language = useLanguage()
  const dialog = useDialog()

  const [form, setForm] = createStore({
    host: "",
    port: "22",
    user: "",
    workingDir: "",
    authMethod: "password" as AuthMethod,
    password: "",
    keyPath: "",
    passphrase: "",
  })

  const [status, setStatus] = createStore({
    testing: false,
    connecting: false,
    testResult: undefined as string | undefined,
    error: undefined as string | undefined,
  })

  const t = (key: string, params?: Record<string, string | number | boolean>) =>
    language.t(key as Parameters<typeof language.t>[0], params)

  const authLabel = (method: AuthMethod) => {
    const [key, fallback] = AUTH_LABELS[method]
    return t(key) || fallback
  }

  const busy = () => status.testing || status.connecting
  const valid = () => !!form.host && !!form.user

  const port = () => {
    const parsed = Number.parseInt(form.port, 10)
    return Number.isFinite(parsed) ? parsed : 22
  }

  const buildAuth = (): RemoteAuth => {
    switch (form.authMethod) {
      case "password":
        return { kind: "password", password: form.password }
      case "privateKey":
        return { kind: "privateKey", keyPath: form.keyPath, passphrase: form.passphrase || undefined }
      case "agent":
        return { kind: "agent" }
    }
  }

  const remotePayload = () => ({
    host: form.host,
    port: port(),
    user: form.user,
    auth: buildAuth(),
    workingDirectory: form.workingDir || "/",
  })

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
    setStatus({ testing: true, testResult: undefined, error: undefined })
    try {
      const res = await fetch(`${serverSDK().url}/api/v1/remote/probe`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(remotePayload()),
      })
      const json = (await res.json()) as { ok: boolean; platform?: string; reason?: string }
      if (json.ok) {
        setStatus("testResult", t("session.remote.test.ok", { platform: json.platform ?? "" }))
      } else {
        setStatus("testResult", t("session.remote.test.failed", { reason: json.reason ?? "" }))
      }
    } catch (err) {
      setStatus("testResult", t("session.remote.test.error", { message: (err as Error).message }))
    } finally {
      setStatus("testing", false)
    }
  }

  const connect = async () => {
    setStatus({ connecting: true, error: undefined })
    try {
      // Set the session's metadata.remote via the session API
      const res = await fetch(`${serverSDK().url}/api/session/${props.sessionID}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { remote: remotePayload() } }),
      })
      if (!res.ok) {
        const text = await res.text()
        setStatus("error", t("session.remote.connect.failed", { message: text }))
      } else {
        dialog.close()
      }
    } catch (err) {
      setStatus("error", (err as Error).message)
    } finally {
      setStatus("connecting", false)
    }
  }

  const disconnect = async () => {
    setStatus({ connecting: true, error: undefined })
    try {
      await fetch(`${serverSDK().url}/api/session/${props.sessionID}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { remote: null } }),
      })
    } catch (err) {
      setStatus("error", (err as Error).message)
    } finally {
      setStatus("connecting", false)
    }
  }

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    if (!valid() || busy()) return
    void connect()
  }

  return (
    <Dialog
      class="dialog-session-remote-dialog"
      fit
      title={t("session.remote.title") || "Remote SSH Session"}
      description={
        t("session.remote.description") ||
        "Connect this session to a remote SSH server. All file, shell, and environment operations will run on the remote host. Use ctx_local=true on any tool call to run it locally."
      }
    >
      <div class="flex w-full min-w-0 flex-1 flex-col gap-4 px-4">
        <div class="flex w-full min-w-0 flex-col gap-2">
          <label class="dialog-session-remote-label">{t("session.remote.field.host") || "Host"}</label>
          <TextInputV2
            type="text"
            appearance="large"
            class="!w-full self-stretch"
            placeholder="example.com or 192.168.1.100"
            value={form.host}
            disabled={busy()}
            autofocus
            onInput={(event) => setForm("host", event.currentTarget.value)}
            onKeyDown={keyDown}
          />
        </div>

        <div class="grid w-full min-w-0 grid-cols-2 gap-4">
          <div class="flex min-w-0 flex-col gap-2">
            <label class="dialog-session-remote-label">{t("session.remote.field.port") || "Port"}</label>
            <TextInputV2
              type="number"
              numeric
              appearance="large"
              class="!w-full self-stretch"
              placeholder="22"
              value={form.port}
              disabled={busy()}
              onInput={(event) => setForm("port", event.currentTarget.value)}
              onKeyDown={keyDown}
            />
          </div>
          <div class="flex min-w-0 flex-col gap-2">
            <label class="dialog-session-remote-label">{t("session.remote.field.user") || "User"}</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              placeholder="username"
              value={form.user}
              disabled={busy()}
              onInput={(event) => setForm("user", event.currentTarget.value)}
              onKeyDown={keyDown}
            />
          </div>
        </div>

        <div class="flex w-full min-w-0 flex-col gap-2">
          <label class="dialog-session-remote-label">
            {t("session.remote.field.workingDir") || "Working directory"}
          </label>
          <TextInputV2
            type="text"
            appearance="large"
            class="!w-full self-stretch"
            placeholder="/home/user/project"
            value={form.workingDir}
            disabled={busy()}
            onInput={(event) => setForm("workingDir", event.currentTarget.value)}
            onKeyDown={keyDown}
          />
        </div>

        <div class="flex w-full min-w-0 flex-col gap-2">
          <label class="dialog-session-remote-label">
            {t("session.remote.field.authMethod") || "Auth method"}
          </label>
          <SelectV2
            options={AUTH_METHODS}
            current={form.authMethod}
            value={(x) => x}
            label={authLabel}
            disabled={busy()}
            class="!w-full self-stretch"
            onSelect={(next) => setForm("authMethod", next ?? "password")}
          />
        </div>

        <Show when={form.authMethod === "password"}>
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="dialog-session-remote-label">{t("session.remote.field.password") || "Password"}</label>
            <TextInputV2
              type="password"
              appearance="large"
              class="!w-full self-stretch"
              placeholder="password"
              value={form.password}
              disabled={busy()}
              onInput={(event) => setForm("password", event.currentTarget.value)}
              onKeyDown={keyDown}
            />
          </div>
        </Show>

        <Show when={form.authMethod === "privateKey"}>
          <div class="grid w-full min-w-0 grid-cols-2 gap-4">
            <div class="flex min-w-0 flex-col gap-2">
              <label class="dialog-session-remote-label">
                {t("session.remote.field.keyPath") || "Private key path"}
              </label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                placeholder="~/.ssh/id_rsa"
                value={form.keyPath}
                disabled={busy()}
                onInput={(event) => setForm("keyPath", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
            <div class="flex min-w-0 flex-col gap-2">
              <label class="dialog-session-remote-label">
                {t("session.remote.field.passphrase") || "Passphrase (optional)"}
              </label>
              <TextInputV2
                type="password"
                appearance="large"
                class="!w-full self-stretch"
                placeholder="passphrase"
                value={form.passphrase}
                disabled={busy()}
                onInput={(event) => setForm("passphrase", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
          </div>
        </Show>

        <Show when={status.testResult}>
          <div class="dialog-session-remote-test-result">{status.testResult}</div>
        </Show>

        <Show when={status.error}>
          <div class="dialog-session-remote-error">{status.error}</div>
        </Show>
      </div>

      <DialogFooter>
        <ButtonV2 variant="ghost-muted" class="mr-auto" disabled={status.connecting} onClick={disconnect}>
          {t("session.remote.disconnect") || "Disconnect (return to local)"}
        </ButtonV2>
        <ButtonV2
          variant="neutral"
          disabled={busy() || !valid()}
          onClick={() => void testConnection()}
        >
          {status.testing ? t("session.remote.testing") || "Testing..." : t("session.remote.test") || "Test connection"}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={busy() || !valid()} onClick={() => void connect()}>
          {status.connecting
            ? t("session.remote.connecting") || "Connecting..."
            : t("session.remote.connect") || "Connect"}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
