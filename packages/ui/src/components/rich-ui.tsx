import { createEffect, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { ChatUIComponent, ChatUILayoutMode, ChatUIStateValue, ChatUISpec } from "@diveeoi/db/chat-ui"
import type { ChatUIState } from "./rich-ui-composition"
import { ComponentView } from "./rich-ui-component-view"
import { mergeRichUIState, parseRichUIState, richUIStateStorageKey } from "./rich-ui-state"
import { validateRichUISubmission, type RichUIUploadMap } from "./rich-ui-validation"

function initialState(spec: ChatUISpec, sessionID?: string, override?: ChatUIState): ChatUIState {
  const initial = Object.fromEntries((spec.state ?? []).map((entry) => [entry.key, entry.value])) as ChatUIState
  let restored = initial
  if (spec.persistState && sessionID && typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(richUIStateStorageKey(sessionID, spec.id))
      if (stored) restored = parseRichUIState(restored, stored)
    } catch {
      // Malformed or unavailable storage must not break the interactive UI.
    }
  }
  return mergeRichUIState(restored, override)
}

function spansAutoLayout(component: ChatUIComponent) {
  return [
    "heading",
    "text",
    "divider",
    "group",
    "tabs",
    "conditional",
    "quiz",
    "diagram",
    "platformer",
    "table",
    "map",
    "data-grid",
    "media",
  ].includes(component.type)
}

export function RichUIRenderer(props: {
  spec: ChatUISpec
  sessionID?: string
  state?: ChatUIState
  onStateChange?: (state: ChatUIState) => void
  onSubmit?: (state: ChatUIState) => void
  embedded?: boolean
}) {
  const [values, setValues] = createStore<ChatUIState>(initialState(props.spec, props.sessionID, props.state))
  const [uploads, setUploads] = createStore<RichUIUploadMap>({})
  const [validationError, setValidationError] = createSignal("")
  const layoutMode = (): ChatUILayoutMode => props.spec.layoutMode ?? "auto"
  const storageKey = () =>
    props.spec.persistState && props.sessionID ? richUIStateStorageKey(props.sessionID, props.spec.id) : undefined
  const autoColumns = () => {
    if (props.spec.layout === "stack") return "minmax(0, 1fr)"
    return "repeat(auto-fit, minmax(min(100%, 22rem), 1fr))"
  }

  createEffect(() => {
    const snapshot = Object.fromEntries(Object.entries(values)) as ChatUIState
    props.onStateChange?.(snapshot)
    const key = storageKey()
    if (!key || typeof window === "undefined") return
    try {
      window.localStorage.setItem(key, JSON.stringify(snapshot))
    } catch {
      // Storage may be disabled or full; the interactive UI remains usable in memory.
    }
  })

  const update = (key: string, value: ChatUIStateValue) => {
    setValues(key, value)
    props.onStateChange?.({ ...values, [key]: value })
  }

  const updateFiles = (key: string, files: File[]) => {
    setUploads(key, [...files])
    props.onStateChange?.({
      ...values,
      [key]: JSON.stringify(files.map((file) => ({ name: file.name.slice(0, 180), size: file.size, type: file.type }))),
    })
  }

  const submit = (state: ChatUIState, intent: "submit" | "refresh" = "submit") => {
    const issue = validateRichUISubmission(props.spec.components, state, uploads)
    if (issue) {
      setValidationError(issue)
      return
    }
    setValidationError("")
    props.onSubmit?.({ ...state })
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("diveeoi:submit-rich-ui", {
          detail: {
            sessionID: props.sessionID,
            specID: props.spec.id,
            title: props.spec.title,
            intent,
            values: { ...state },
            files: Object.entries(uploads).flatMap(([fieldKey, selected]) =>
              selected.map((file) => ({ fieldKey, file })),
            ),
          },
        }),
      )
    }
  }

  const gridStyle = () => {
    if (layoutMode() === "manual") return undefined
    return { "grid-template-columns": autoColumns() }
  }

  return (
    <section
      data-component="rich-ui"
      data-ui-id={props.spec.id}
      data-layout-mode={layoutMode()}
      class="my-3 min-w-0 overflow-hidden"
      classList={{
        "my-0": props.embedded,
        "rounded-2xl border border-border-weak-base bg-background-stronger": !props.embedded,
      }}
    >
      <Show when={!props.embedded}>
        <header class="border-b border-border-weak-base px-4 py-3">
          <div class="text-14-semibold text-text-strong">{props.spec.title}</div>
          <Show when={props.spec.description}>
            <p class="mt-1 text-12-regular leading-relaxed text-text-weak">{props.spec.description}</p>
          </Show>
          <Show when={validationError()}>
            <p role="alert" class="mt-2 text-11-medium text-icon-warning-base">
              {validationError()}
            </p>
          </Show>
        </header>
      </Show>
      <Show when={props.embedded && validationError()}>
        <p role="alert" class="mb-2 text-11-medium text-icon-warning-base">{validationError()}</p>
      </Show>
      <div
        class="grid min-w-0 gap-4"
        classList={{
          "p-0": props.embedded,
          "p-4": !props.embedded,
          "grid-cols-1": (layoutMode() === "manual" || layoutMode() === "hybrid") && props.spec.layout === "stack",
          "grid-cols-1 md:grid-cols-2": layoutMode() === "manual" && props.spec.layout === "grid",
        }}
        style={gridStyle()}
      >
        <For each={props.spec.components}>
          {(component, index) => {
            const automaticSectionBreak = () =>
              layoutMode() === "auto" &&
              index() > 0 &&
              component.type === "heading" &&
              component.level === 2 &&
              props.spec.components[index() - 1]?.type !== "divider"
            const fullRow = () => layoutMode() !== "manual" && spansAutoLayout(component)
            return (
              <div
                class="min-w-0"
                classList={{
                  "border-t border-border-weak-base pt-4": automaticSectionBreak(),
                }}
                style={{ "grid-column": fullRow() ? "1 / -1" : undefined }}
              >
                <ComponentView
                  component={component}
                  state={values}
                  setState={update}
                  layoutMode={layoutMode()}
                  depth={0}
                  onSubmit={submit}
                  onFilesChange={updateFiles}
                />
              </div>
            )
          }}
        </For>
      </div>
    </section>
  )
}
