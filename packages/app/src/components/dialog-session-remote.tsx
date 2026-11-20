import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { Dialog } from "@diveeoi/ui/v2/dialog-v2"
import { SelectV2 } from "@diveeoi/ui/v2/select-v2"
import { TextInputV2 } from "@diveeoi/ui/v2/text-input-v2"
import { useDialog } from "@diveeoi/ui/context/dialog"
import { Show, type Component, createResource, createSignal } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { createRemoteSessionApi, type RemoteProfile } from "./remote-session-api"
import "./dialog-session-remote.css"

export const DialogSessionRemote: Component<{ sessionID: string }> = (props) => {
  const serverSDK = useServerSDK()
  const server = useServer()
  const dialog = useDialog()
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
  const [profiles] = createResource<RemoteProfile[]>(() => api().profiles())
  const [selected, setSelected] = createSignal("")
  const [workingDirectory, setWorkingDirectory] = createSignal("~")
  const [busy, setBusy] = createSignal(false)
  const [status, setStatus] = createSignal("")

  const current = () => profiles()?.find((profile) => profile.id === selected())
  const test = async () => {
    const profile = current()
    if (!profile) return
    setBusy(true)
    setStatus(`Testing ${profile.name}…`)
    try {
      const result = await api().probeProfile(profile.id)
      setStatus(
        result.ok
          ? `Connected · ${result.platform ?? "Remote"} · ${result.homeDirectory ?? "home directory unknown"}`
          : (result.reason ?? "Connection failed"),
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const connect = async () => {
    const profile = current()
    if (!profile) {
      setStatus("Select a saved SSH profile first.")
      return
    }
    setBusy(true)
    setStatus("")
    try {
      await api().updateSession(props.sessionID, {
        profileId: profile.id,
        workingDirectory: workingDirectory().trim() || profile.workingDirectory || "~",
      })
      dialog.close()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await api().updateSession(props.sessionID, null)
      dialog.close()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      class="dialog-session-remote-dialog"
      fit
      title="Remote SSH session"
      description="Attach this session to a saved SSH host. Files, shell commands, and project operations will run remotely. Manage hosts and credentials in Settings → Remote Sessions."
    >
      <div class="flex w-full min-w-0 flex-1 flex-col gap-4 px-4">
        <Show
          when={profiles()?.length}
          fallback={
            <div class="dialog-session-remote-status">
              {profiles.loading
                ? "Loading saved SSH profiles…"
                : "No saved SSH profiles. Add one in Settings → Remote Sessions first."}
            </div>
          }
        >
          <div class="flex w-full min-w-0 flex-col gap-2">
            <span class="dialog-session-remote-label">SSH profile</span>
            <SelectV2
              aria-label="SSH profile"
              options={profiles() ?? []}
              current={current()}
              value={(profile) => profile.id}
              label={(profile) => `${profile.name} · ${profile.user}@${profile.host}:${profile.port}`}
              onSelect={(profile) => {
                setSelected(profile?.id ?? "")
                if (profile) setWorkingDirectory(profile.workingDirectory || "~")
              }}
              class="!w-full self-stretch"
            />
          </div>
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="dialog-session-remote-label" for="dialog-remote-working-directory">
              Remote working directory
            </label>
            <TextInputV2
              id="dialog-remote-working-directory"
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={workingDirectory()}
              placeholder="~ or /home/user/project"
              disabled={busy()}
              onInput={(event) => setWorkingDirectory(event.currentTarget.value)}
            />
          </div>
          <Show when={current()}>
            {(profile) => (
              <div class="dialog-session-remote-status">
                <div>
                  {profile().authMethod === "agent"
                    ? "Authentication: SSH agent"
                    : profile().authMethod === "privateKey"
                      ? "Authentication: private key"
                      : "Authentication: saved password"}
                </div>
                <div>
                  {profile().host}:{profile().port} · {profile().user}
                </div>
              </div>
            )}
          </Show>
          <div class="flex flex-wrap justify-end gap-2">
            <ButtonV2 variant="ghost-muted" onClick={() => void test()} disabled={busy() || !current()}>
              Test connection
            </ButtonV2>
            <ButtonV2 onClick={() => void connect()} disabled={busy() || !current()}>
              Connect
            </ButtonV2>
          </div>
        </Show>
        <Show when={status()}>
          <div class="dialog-session-remote-status" role="status">
            {status()}
          </div>
        </Show>
        <div class="flex justify-end">
          <ButtonV2 variant="ghost-muted" onClick={() => void disconnect()} disabled={busy()}>
            Disconnect this session
          </ButtonV2>
        </div>
      </div>
    </Dialog>
  )
}
