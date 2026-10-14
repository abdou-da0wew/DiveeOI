import { Button } from "@diveeoi/ui/button"
import { Icon } from "@diveeoi/ui/icon"
import { Spinner } from "@diveeoi/ui/spinner"
import { Match, onCleanup, Show, Switch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { step, terminalStage, describeError, type Stage } from "./console-device-login-flow"

/**
 * Sign in to the OpenCode Console with an RFC 8628 device authorization.
 *
 * The flow is deliberately thin: the server owns the attempt (and the device code with it), so
 * this component only has to show the code, open the approval page, and keep asking until the
 * server reports something terminal. Cadence comes back from the server on every poll, which is
 * what carries the RFC 8628 `slow_down` penalty - reimplementing that arithmetic here is how
 * clients end up getting rate limited.
 */
export function ConsoleDeviceLogin(props: {
  /** Called once the account is stored and its providers have been applied. */
  onSuccess: (email: string) => void | Promise<void>
}) {
  const serverSDK = useServerSDK()
  const language = useLanguage()

  const [store, setStore] = createStore({
    /** "start" is before the first request; "waiting" is while the user approves in a browser. */
    stage: "start" as Stage,
    attemptID: undefined as string | undefined,
    userCode: undefined as string | undefined,
    verificationURL: undefined as string | undefined,
    error: undefined as string | undefined,
    copied: false,
  })

  const alive = { value: true }
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }
  const clearTimer = () => {
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  }

  onCleanup(() => {
    alive.value = false
    clearTimer()
    // Best effort: tell the server to drop the attempt so a half-finished login is not left
    // sitting in its table until it expires on its own.
    const attemptID = store.attemptID
    if (attemptID === undefined) return
    void serverSDK()
      .client.experimental.console.cancel({ attemptID })
      .catch(() => {})
  })

  async function poll(attemptID: string) {
    const result = await serverSDK()
      .client.experimental.console.poll({ attemptID }, { throwOnError: true })
      .then((value) => value.data)
      .catch((error) => {
        // A failed poll is not fatal: the console may be briefly unreachable, and the attempt
        // is still valid. Stop only if this component is gone.
        if (!alive.value) return undefined
        setStore("error", describeError(error, language.t("provider.connect.console.pollFailed")))
        return undefined
      })

    if (!result || !alive.value) return

    const next = step(result)
    if (next.action === "done") {
      clearTimer()
      await props.onSuccess(next.email)
      return
    }
    if (next.action === "stop") {
      clearTimer()
      const stage = terminalStage(result)
      if (stage) setStore("stage", stage)
      return
    }
    if (next.action === "warn") {
      // Keep waiting: the console being briefly unreachable should not abandon a sign-in the
      // user is actively completing in another tab.
      setStore("error", next.message || language.t("provider.connect.console.pollFailed"))
    } else {
      setStore("error", undefined)
    }
    timer.current = setTimeout(() => void poll(attemptID), next.delayMs)
  }

  async function start() {
    setStore(
      produce((draft) => {
        draft.stage = "starting"
        draft.error = undefined
        draft.copied = false
      }),
    )

    const result = await serverSDK()
      .client.experimental.console.login({}, { throwOnError: true })
      .then((value) => value.data)
      .catch((error) => {
        if (!alive.value) return undefined
        setStore(
          produce((draft) => {
            draft.stage = "error"
            draft.error = describeError(error, language.t("provider.connect.console.startFailed"))
          }),
        )
        return undefined
      })

    if (!result || !alive.value) return

    setStore(
      produce((draft) => {
        draft.stage = "waiting"
        draft.attemptID = result.attemptID
        draft.userCode = result.userCode
        draft.verificationURL = result.verificationURL
      }),
    )
    void poll(result.attemptID)
  }

  async function copyCode() {
    const code = store.userCode
    if (!code) return
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) {
      showToast({ variant: "error", title: language.t("provider.connect.console.copyFailed") })
      return
    }
    const copied = await clipboard.writeText(code).then(
      () => true,
      () => false,
    )
    if (!alive.value) return
    setStore("copied", copied)
    if (!copied) showToast({ variant: "error", title: language.t("provider.connect.console.copyFailed") })
  }

  return (
    <div class="flex flex-col gap-5" data-testid="console-device-login">
      <div class="text-14-regular text-text-base">{language.t("provider.connect.console.line1")}</div>

      <Switch>
        <Match when={store.stage === "start" || store.stage === "starting"}>
          <Button
            class="w-auto"
            size="large"
            variant="primary"
            disabled={store.stage === "starting"}
            onClick={() => void start()}
            data-testid="console-signin-start"
          >
            <Show when={store.stage === "starting"} fallback={language.t("provider.connect.console.signIn")}>
              <Spinner />
              <span>{language.t("provider.connect.status.inProgress")}</span>
            </Show>
          </Button>
        </Match>

        <Match when={store.stage === "waiting"}>
          <div class="flex flex-col gap-4">
            <div class="text-14-regular text-text-soft">{language.t("provider.connect.console.codeLabel")}</div>
            <div class="flex items-center gap-x-3">
              <code
                class="text-20-medium text-text-strong font-mono tracking-widest select-all"
                data-testid="console-user-code"
              >
                {store.userCode}
              </code>
              <Button size="small" variant="secondary" onClick={() => void copyCode()} data-testid="console-copy-code">
                {store.copied ? language.t("provider.connect.console.copied") : language.t("common.copy")}
              </Button>
            </div>
            <div class="text-13-regular text-text-soft">
              {language.t("provider.connect.console.visit.prefix")}
              <Link href={store.verificationURL ?? ""} target="_blank" rel="noreferrer" tabIndex={-1}>
                {language.t("provider.connect.console.visit.link")}
              </Link>
              {language.t("provider.connect.console.visit.suffix")}
            </div>
            <div class="text-13-regular text-text-soft flex items-center gap-x-2">
              <Spinner />
              <span>{language.t("provider.connect.console.waiting")}</span>
            </div>
            <Show when={store.error}>
              {(message) => <div class="text-13-regular text-text-critical">{message()}</div>}
            </Show>
          </div>
        </Match>

        <Match when={store.stage === "denied" || store.stage === "expired"}>
          <div class="flex flex-col items-start gap-4">
            <div class="text-14-regular text-text-base flex items-center gap-x-2">
              <Icon name="circle-ban-sign" class="text-icon-critical-base" />
              <span>
                {store.stage === "denied"
                  ? language.t("provider.connect.console.denied")
                  : language.t("provider.connect.console.expired")}
              </span>
            </div>
            <Button class="w-auto" size="large" variant="primary" onClick={() => void start()}>
              {language.t("provider.connect.console.tryAgain")}
            </Button>
          </div>
        </Match>

        <Match when={store.stage === "error"}>
          <div class="flex flex-col items-start gap-4">
            <div class="text-14-regular text-text-base flex items-center gap-x-2">
              <Icon name="circle-ban-sign" class="text-icon-critical-base" />
              <span>{store.error ?? language.t("provider.connect.console.startFailed")}</span>
            </div>
            <Button class="w-auto" size="large" variant="primary" onClick={() => void start()}>
              {language.t("provider.connect.console.tryAgain")}
            </Button>
          </div>
        </Match>
      </Switch>

    </div>
  )
}
