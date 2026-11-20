import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { type Component, Show, createResource, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { authTokenFromCredentials } from "@/utils/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServer } from "@/context/server"
import {
  createRemoteSessionApi,
  type RemoteAuthMethod,
  type RemoteHost,
  type RemoteProfile,
  type RemoteProfileInput,
} from "../remote-session-api"
import { RemoteSessionsContent, type ActiveRemoteSession } from "./remote-sessions-content"
import { RemoteSessionsProfileForm, type RemoteProfileFormState } from "./remote-sessions-form"
import { emptyRemoteProfileForm, type RemoteSettingsData } from "./remote-sessions-model"
import "./settings-v2.css"
import "./remote-sessions.css"

export const SettingsRemoteSessionsV2: Component = () => {
  const serverSDK = useServerSDK()
  const server = useServer()
  const [busy, setBusy] = createSignal(false)
  const [notice, setNotice] = createSignal("")
  const [formOpen, setFormOpen] = createSignal(false)
  const [form, setForm] = createStore(emptyRemoteProfileForm())
  const [keyName, setKeyName] = createSignal("diveeoi")
  const [api] = createSignal(
    createRemoteSessionApi({
      base: () => serverSDK().url,
      headers: (): Record<string, string> => {
        const current = server.current
        if (current?.type !== "http" || !current.http.password) return {}
        return {
          Authorization: `Basic ${authTokenFromCredentials({
            username: current.http.username,
            password: current.http.password,
          })}`,
        }
      },
    }),
  )

  const load = async (): Promise<RemoteSettingsData> => {
    const [discovery, profiles, keys, sessionResponse] = await Promise.all([
      api().discovery(),
      api().profiles(),
      api().keys(),
      serverSDK()
        .client.session.list({ limit: 100 })
        .catch(() => ({ data: [] })),
    ])
    const sessions = (sessionResponse.data ?? []).filter((session) => {
      const reference = session.metadata?.remote
      return (
        typeof reference === "object" &&
        reference !== null &&
        typeof (reference as { profileId?: unknown }).profileId === "string"
      )
    }) as ActiveRemoteSession[]
    return { discovery, profiles, keys, sessions }
  }

  const [data, { refetch }] = createResource(load)
  const profiles = () => data()?.profiles ?? []
  const keys = () => data()?.keys ?? []
  const sessions = () => data()?.sessions ?? []
  const refresh = async () => {
    await refetch()
  }

  const startNew = () => {
    setForm(emptyRemoteProfileForm())
    setNotice("")
    setFormOpen(true)
  }

  const editProfile = (profile: RemoteProfile) => {
    setForm({
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: String(profile.port),
      user: profile.user,
      workingDirectory: profile.workingDirectory,
      authMethod: profile.authMethod,
      keyPath: profile.keyPath ?? "",
      password: "",
      passphrase: "",
    })
    setNotice("")
    setFormOpen(true)
  }

  const useHost = (host: RemoteHost) => {
    const agentAvailable = data()?.discovery.sources.agentAvailable
    const authMethod: RemoteAuthMethod = host.identityFile ? "privateKey" : agentAvailable ? "agent" : "password"
    setForm({
      ...emptyRemoteProfileForm(),
      name: host.name,
      host: host.host,
      port: String(host.port),
      user: host.user,
      authMethod,
      keyPath: host.identityFile ?? "",
    })
    setNotice(`Loaded ${host.name} from SSH discovery. Review authentication, then save the profile.`)
    setFormOpen(true)
  }

  const saveProfile = async () => {
    const port = Number(form.port)
    if (!form.name.trim() || !form.host.trim() || !form.user.trim()) {
      setNotice("Profile name, host, and username are required.")
      return
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setNotice("SSH port must be between 1 and 65535.")
      return
    }
    if (form.authMethod === "privateKey" && !form.keyPath.trim()) {
      setNotice("Choose a private key file.")
      return
    }
    if (form.authMethod === "password" && !form.password && !form.id) {
      setNotice("Enter the SSH password for this new profile.")
      return
    }

    setBusy(true)
    setNotice("")
    try {
      const input: RemoteProfileInput = {
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(),
        host: form.host.trim(),
        port,
        user: form.user.trim(),
        workingDirectory: form.workingDirectory.trim() || "~",
        authMethod: form.authMethod,
        ...(form.authMethod === "privateKey" ? { keyPath: form.keyPath.trim() } : {}),
        ...(form.password ? { password: form.password } : {}),
        ...(form.passphrase ? { passphrase: form.passphrase } : {}),
      }
      await api().saveProfile(input)
      setFormOpen(false)
      setNotice("SSH profile saved.")
      await refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const testProfile = async (profile: RemoteProfile) => {
    setBusy(true)
    setNotice(`Testing ${profile.name}…`)
    try {
      const result = await api().probeProfile(profile.id)
      setNotice(
        result.ok
          ? `${profile.name} connected. ${result.platform ?? "Remote"} · home: ${result.homeDirectory ?? "unknown"}`
          : `${profile.name}: ${result.reason ?? "Connection failed"}`,
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const deleteProfile = async (profile: RemoteProfile) => {
    const inUse = sessions().some(
      (session) => (session.metadata?.remote as { profileId?: string } | undefined)?.profileId === profile.id,
    )
    if (inUse) {
      setNotice("Disconnect active sessions using this profile before deleting it.")
      return
    }
    setBusy(true)
    try {
      await api().deleteProfile(profile.id)
      setNotice(`Deleted ${profile.name}.`)
      await refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const disconnectSession = async (session: ActiveRemoteSession) => {
    setBusy(true)
    try {
      await api().updateSession(session.id, null)
      setNotice(`Disconnected ${session.title || session.id}.`)
      await refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const generateKey = async () => {
    setBusy(true)
    try {
      const result = await api().generateKey(keyName().trim())
      setNotice(`Created Ed25519 key: ${result.key.path}`)
      setForm("keyPath", result.key.path)
      setForm("authMethod", "privateKey")
      await refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const updateField = (key: keyof RemoteProfileFormState, value: string | RemoteAuthMethod) => {
    setForm(key, value as never)
  }

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-remote-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">Remote Sessions</h2>
          <div class="settings-v2-remote-header-actions">
            <ButtonV2 variant="ghost-muted" onClick={() => void refresh()} disabled={busy()}>
              Refresh
            </ButtonV2>
            <ButtonV2 icon="plus" onClick={startNew} disabled={busy()}>
              Add host
            </ButtonV2>
          </div>
        </div>
        <p class="text-12-regular text-text-weak leading-5">
          Manage SSH hosts, authentication keys, saved connections, and sessions currently working on remote machines.
          Credentials are encrypted on the server and are never stored in session metadata.
        </p>
      </div>

      <div class="settings-v2-tab-body settings-v2-remote">
        <Show when={notice()}>
          <div class="settings-v2-remote-notice" role="status">
            {notice()}
          </div>
        </Show>
        <Show
          when={!data.loading}
          fallback={<div class="settings-v2-remote-empty">Loading SSH discovery and saved profiles…</div>}
        >
          <Show
            when={!data.error}
            fallback={<div class="settings-v2-remote-notice">Unable to load remote settings: {String(data.error)}</div>}
          >
            <Show when={formOpen()}>
              <RemoteSessionsProfileForm
                form={form}
                keys={keys()}
                busy={busy()}
                onChange={updateField}
                onSave={() => void saveProfile()}
                onCancel={() => setFormOpen(false)}
              />
            </Show>
            <RemoteSessionsContent
              discovery={data()?.discovery}
              profiles={profiles()}
              keys={keys()}
              sessions={sessions()}
              keyName={keyName()}
              busy={busy()}
              onKeyName={setKeyName}
              onDisconnect={(session) => void disconnectSession(session)}
              onTest={(profile) => void testProfile(profile)}
              onEdit={editProfile}
              onDelete={(profile) => void deleteProfile(profile)}
              onUseHost={useHost}
              onGenerateKey={() => void generateKey()}
            />
          </Show>
        </Show>
      </div>
    </>
  )
}
