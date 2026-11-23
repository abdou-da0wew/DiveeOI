import { ButtonV2 } from "@diveeoi/ui/v2/button-v2"
import { Dialog } from "@diveeoi/ui/v2/dialog-v2"
import { SelectV2 } from "@diveeoi/ui/v2/select-v2"
import { TextInputV2 } from "@diveeoi/ui/v2/text-input-v2"
import { useDialog } from "@diveeoi/ui/context/dialog"
import { Show, type Component, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { createRemoteSessionApi, type RemoteProfile } from "./remote-session-api"
import "./dialog-session-remote.css"

export const DialogSessionRemote: Component<{ sessionID: string }> = (props) => {
  const language = useLanguage()
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
    setStatus(language.t("remote.status.testing", { name: profile.name }))
    try {
      const result = await api().probeProfile(profile.id)
      setStatus(
        result.ok
          ? language.t("remote.status.connected", {
              platform: result.platform ?? language.t("remote.status.platformFallback"),
              home: result.homeDirectory ?? language.t("remote.status.homeUnknown"),
            })
          : (result.reason ?? language.t("remote.status.failed")),
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
      setStatus(language.t("remote.status.selectProfile"))
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
      title={language.t("remote.title")}
      description={language.t("remote.description")}
    >
      <div class="flex w-full min-w-0 flex-1 flex-col gap-4 px-4">
        <Show
          when={profiles()?.length}
          fallback={
            <div class="dialog-session-remote-status">
              {profiles.loading
                ? language.t("remote.loadingProfiles")
                : language.t("remote.noProfiles")}
            </div>
          }
        >
          <div class="flex w-full min-w-0 flex-col gap-2">
            <span class="dialog-session-remote-label">{language.t("remote.profile.label")}</span>
            <SelectV2
              aria-label={language.t("remote.profile.label")}
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
              {language.t("remote.workingDirectory")}
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
                    ? language.t("remote.auth.agent")
                    : profile().authMethod === "privateKey"
                      ? language.t("remote.auth.privateKey")
                      : language.t("remote.auth.password")}
                </div>
                <div>
                  {profile().host}:{profile().port} · {profile().user}
                </div>
              </div>
            )}
          </Show>
          <div class="flex flex-wrap justify-end gap-2">
            <ButtonV2 variant="ghost-muted" onClick={() => void test()} disabled={busy() || !current()}>
              {language.t("remote.test")}
            </ButtonV2>
            <ButtonV2 onClick={() => void connect()} disabled={busy() || !current()}>
              {language.t("remote.connect")}
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
            {language.t("remote.disconnect")}
          </ButtonV2>
        </div>
      </div>
    </Dialog>
  )
}
