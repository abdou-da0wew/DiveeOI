import { createMemo, For, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { Icon } from "@diveeoi/ui/icon"
import { IconButton } from "@diveeoi/ui/icon-button"
import { Tabs } from "@diveeoi/ui/tabs"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { examTabs, setExamPresentation } from "./exam-tabs"
import { ExamWorkspace } from "./exam-workspace"

export function ExamTabTriggers() {
  const params = useParams()
  const language = useLanguage()
  const { tabs } = useSessionLayout()
  const entries = createMemo(() =>
    Object.values(examTabs()).filter(
      (entry) => entry.sessionID === params.id && tabs().all().includes(`exam:${entry.exam.id}`),
    ),
  )

  return (
    <For each={entries()}>
      {(entry) => {
        const value = `exam:${entry.exam.id}`
        return (
          <Tabs.Trigger
            value={value}
            closeButton={
              <IconButton
                icon="close-small"
                variant="ghost"
                class="h-5 w-5"
                onClick={() => {
                  setExamPresentation(entry.exam.id, "normal")
                  tabs().close(value)
                }}
                aria-label={language.t("exam.close")}
              />
            }
            hideCloseButton
            onMiddleClick={() => {
              setExamPresentation(entry.exam.id, "normal")
              tabs().close(value)
            }}
          >
            <span class="flex min-w-0 items-center gap-2">
              <Icon name="book" size="small" />
              <span class="max-w-40 truncate">{entry.exam.title}</span>
            </span>
          </Tabs.Trigger>
        )
      }}
    </For>
  )
}

export function ExamTabContents() {
  const params = useParams()
  const { tabs } = useSessionLayout()
  const entries = createMemo(() =>
    Object.values(examTabs()).filter(
      (entry) => entry.sessionID === params.id && tabs().all().includes(`exam:${entry.exam.id}`),
    ),
  )

  return (
    <For each={entries()}>
      {(entry) => (
        <Tabs.Content
          value={`exam:${entry.exam.id}`}
          class="relative flex h-full flex-col overflow-hidden contain-strict"
        >
          <ExamWorkspace examID={entry.exam.id} />
        </Tabs.Content>
      )}
    </For>
  )
}

export function ExamTabOverlay() {
  const params = useParams()
  const active = createMemo(() => {
    return Object.values(examTabs()).find((item) => item.sessionID === params.id && item.presentation !== "normal")
  })

  return <Show when={active()}>{(entry) => <ExamWorkspace examID={entry().exam.id} overlay />}</Show>
}
