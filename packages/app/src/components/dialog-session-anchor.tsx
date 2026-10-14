import { Dialog } from "@diveeoi/ui/dialog"
import { Icon } from "@diveeoi/ui/icon"
import { Spinner } from "@diveeoi/ui/spinner"
import { For, Match, Show, Switch, createResource } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"

/**
 * Read-only view of the session's working memory.
 *
 * The anchor is what the agent carries in place of compacted history, so showing it is the
 * honest way to answer "what does it think it's doing" - and every entry carries a ref that
 * resolves to the original message, so a claim here is always checkable rather than something
 * the user has to take on trust.
 */

/** Mirrors the server's AnchorTree. Decoded defensively: the tree is stored verbatim. */
type Entry = { ref: string; label: string }
type Tree = {
  objective?: { ref: string; label?: string }
  status?: { ref: string; label?: string }
  decisions?: Entry[]
  files?: Entry[]
  open_questions?: Entry[]
  open_todos?: { content: string }[]
}

const list = (value: unknown): Entry[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) =>
    item && typeof item === "object" && typeof (item as Entry).ref === "string" && typeof (item as Entry).label === "string"
      ? [item as Entry]
      : [],
  )
}

const text = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") return undefined
  const label = (value as { label?: unknown }).label
  return typeof label === "string" ? label : undefined
}

export function DialogSessionAnchor(props: { sessionID: string }) {
  const serverSDK = useServerSDK()
  const language = useLanguage()

  // A failed read renders as "no anchor" rather than an error toast: this panel is informational,
  // and an outage here should not interrupt the user's work.
  const [result] = createResource(
    () => props.sessionID,
    async (sessionID) => {
      const res = await serverSDK().client.session.anchor.list({ sessionID })
      return res.data?.anchors ?? []
    },
  )

  const Section = (section: {
    title: string
    entries?: Entry[]
    hint?: string
    onRef?: (ref: string) => void
  }) => (
    <Show when={(section.entries?.length ?? 0) > 0}>
      <div class="flex flex-col gap-2">
        <div class="text-13-medium text-text-weak">{section.title}</div>
        <For each={section.entries}>
          {(entry) => (
            <div class="text-14-regular text-text-base flex flex-col">
              <span>{entry.label}</span>
              <Show when={section.onRef}>
                {(onRef) => (
                  <button
                    type="button"
                    class="text-12-regular text-text-weak underline underline-offset-2 cursor-pointer self-start"
                    onClick={() => onRef()(entry.ref)}
                  >
                    {entry.ref}
                  </button>
                )}
              </Show>
            </div>
          )}
        </For>
        <Show when={section.hint}>
          <div class="text-12-regular text-text-weak">{section.hint}</div>
        </Show>
      </div>
    </Show>
  )

  return (
    <Dialog
      title={<span class="text-16-medium text-text-strong">{language.t("session.anchor.title")}</span>}
      size="large"
    >
      <div class="flex flex-col gap-5 max-w-2xl">

        <Switch>
          <Match when={result.loading}>
            <div class="text-14-regular text-text-base flex items-center gap-x-2">
              <Spinner />
              <span>{language.t("common.loading")}</span>
            </div>
          </Match>

          <Match when={(result.latest ?? []).length === 0}>
            <div class="text-14-regular text-text-soft">{language.t("session.anchor.empty")}</div>
          </Match>

          <Match when={true}>
            <For each={result.latest ?? []}>
              {(anchor, index) => {
                const tree = (): Tree => (anchor.tree ?? {}) as Tree
                return (
                  <div class="flex flex-col gap-4 border-b border-border-weak-base pb-4 last:border-none">
                    <div class="flex items-center gap-x-3">
                      <span class="text-13-medium text-text-weak">
                        {index() === 0
                          ? language.t("session.anchor.current")
                          : language.t("session.anchor.epoch", { epoch: anchor.epoch })}
                      </span>
                      <Show when={anchor.degraded}>
                        <span class="text-12-regular text-text-critical flex items-center gap-x-1">
                          <Icon name="circle-ban-sign" class="text-icon-critical-base" />
                          {language.t("session.anchor.degraded")}
                        </span>
                      </Show>
                    </div>

                    <Show when={text(tree().objective) ?? tree().objective?.ref}>
                      <div class="flex flex-col gap-1">
                        <div class="text-13-medium text-text-weak">{language.t("session.anchor.objective")}</div>
                        <div class="text-14-regular text-text-base">
                          {text(tree().objective) ?? tree().objective?.ref}
                        </div>
                      </div>
                    </Show>

                    <Show when={text(tree().status) ?? tree().status?.ref}>
                      <div class="flex flex-col gap-1">
                        <div class="text-13-medium text-text-weak">{language.t("session.anchor.status")}</div>
                        <div class="text-14-regular text-text-base">{text(tree().status) ?? tree().status?.ref}</div>
                      </div>
                    </Show>

                    <Section title={language.t("session.anchor.decisions")} entries={list(tree().decisions)} />
                    <Section title={language.t("session.anchor.files")} entries={list(tree().files)} />
                    <Section title={language.t("session.anchor.openQuestions")} entries={list(tree().open_questions)} />
                    <Section
                      title={language.t("session.anchor.openTodos")}
                      entries={(tree().open_todos ?? []).map((todo) => ({ ref: "", label: todo.content }))}
                    />
                  </div>
                )
              }}
            </For>

            <div class="text-12-regular text-text-weak">{language.t("session.anchor.footer")}</div>
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}

export * as SessionAnchorDialog from "./dialog-session-anchor"
