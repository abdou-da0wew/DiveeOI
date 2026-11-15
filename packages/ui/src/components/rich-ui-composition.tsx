import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import type { ChatUIComponent, ChatUIStateValue } from "@diveeoi/db/chat-ui"
import { evaluateNumericExpression, formatRichUINumber } from "./rich-ui-expression"
import { RichUIFileUpload } from "./rich-ui-file-upload"

export type ChatUIState = Record<string, ChatUIStateValue>
export type StateSetter = (key: string, value: ChatUIStateValue) => void
export type ChatUICompositionComponent = Extract<
  ChatUIComponent,
  { type: "group" | "tabs" | "conditional" | "field" | "button" | "file-upload" | "state-value" | "computed" }
>

export function RichUIComposition(props: {
  component: ChatUICompositionComponent
  state: ChatUIState
  setState: StateSetter
  renderComponent: (component: ChatUIComponent) => JSX.Element
  onSubmit?: (state: ChatUIState, intent?: "submit" | "refresh") => void
  onFilesChange?: (key: string, files: File[]) => void
}) {
  return (
    <Switch>
      <Match when={props.component.type === "group"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "group" }>
          return (
            <section class="min-w-0 rounded-xl border border-border-weak-base bg-background-base p-3">
              <Show when={value.title}>
                <h3 class="mb-3 text-12-semibold text-text-strong">{value.title}</h3>
              </Show>
              <div
                class="grid min-w-0 gap-3"
                classList={{
                  "grid-cols-1": value.layout === "stack",
                  "grid-cols-1 sm:grid-cols-2": value.layout === "grid",
                  "grid-cols-1 sm:flex sm:flex-wrap sm:items-start": value.layout === "row",
                }}
              >
                <For each={value.components}>{(component) => props.renderComponent(component)}</For>
              </div>
            </section>
          )
        })()}
      </Match>
      <Match when={props.component.type === "tabs"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "tabs" }>
          const [localActive, setLocalActive] = createSignal(value.tabs[0]?.id ?? "")
          const active = () => (value.key ? String(props.state[value.key] ?? value.tabs[0]?.id ?? "") : localActive())
          const choose = (id: string) => (value.key ? props.setState(value.key, id) : setLocalActive(id))
          const selected = createMemo(() => value.tabs.find((tab) => tab.id === active()) ?? value.tabs[0])
          return (
            <section class="min-w-0 rounded-xl border border-border-weak-base bg-background-base p-3">
              <Show when={value.title}>
                <h3 class="mb-3 text-12-semibold text-text-strong">{value.title}</h3>
              </Show>
              <div class="mb-3 flex min-w-0 gap-1 overflow-x-auto border-b border-border-weak-base">
                <For each={value.tabs}>
                  {(tab) => (
                    <button
                      type="button"
                      class="shrink-0 border-b-2 px-3 py-2 text-11-medium"
                      classList={{
                        "border-text-strong text-text-strong": active() === tab.id,
                        "border-transparent text-text-weak": active() !== tab.id,
                      }}
                      onClick={() => choose(tab.id)}
                    >
                      {tab.label}
                    </button>
                  )}
                </For>
              </div>
              <Show when={selected()}>
                {(tab) => (
                  <div class="grid min-w-0 gap-3">
                    <For each={tab().components}>{(component) => props.renderComponent(component)}</For>
                  </div>
                )}
              </Show>
            </section>
          )
        })()}
      </Match>
      <Match when={props.component.type === "conditional"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "conditional" }>
          return (
            <Show when={props.state[value.key] === value.equals}>
              <div class="grid min-w-0 gap-3">
                <For each={value.components}>{(component) => props.renderComponent(component)}</For>
              </div>
            </Show>
          )
        })()}
      </Match>
      <Match when={props.component.type === "field"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "field" }>
          const current = () => props.state[value.key]
          const update = (next: string | number | boolean) =>
            props.setState(
              value.key,
              typeof next === "number"
                ? Math.max(-1e9, Math.min(1e9, next))
                : typeof next === "string"
                  ? next.slice(0, value.maxLength ?? 240)
                  : next,
            )
          return (
            <label class="flex min-w-0 flex-col gap-2 rounded-lg border border-border-weak-base bg-background-base p-3 text-12-medium text-text-strong">
              <span>{value.label}</span>
              <Show
                when={value.control === "toggle"}
                fallback={
                  <Show
                    when={value.control === "select"}
                    fallback={
                      <input
                        type={value.control === "number" ? "number" : "text"}
                        min={value.control === "number" ? (value.min ?? -1e9) : undefined}
                        max={value.control === "number" ? (value.max ?? 1e9) : undefined}
                        minLength={value.control === "text" ? value.minLength : undefined}
                        maxLength={value.control === "text" ? (value.maxLength ?? 240) : undefined}
                        pattern={value.control === "text" ? value.pattern : undefined}
                        required={value.required}
                        class="h-9 w-full rounded-md border border-border-weak-base bg-background-stronger px-3 text-12-regular text-text-base"
                        placeholder={value.placeholder}
                        value={String(current() ?? "")}
                        onInput={(event) => {
                          const next =
                            value.control === "number" ? Number(event.currentTarget.value) : event.currentTarget.value
                          if (typeof next !== "number" || Number.isFinite(next)) {
                            update(
                              typeof next === "number"
                                ? Math.max(value.min ?? -1e9, Math.min(value.max ?? 1e9, next))
                                : next,
                            )
                          }
                        }}
                      />
                    }
                  >
                    <select
                      aria-label={value.label}
                      required={value.required}
                      class="h-9 w-full rounded-md border border-border-weak-base bg-background-stronger px-3 text-12-regular text-text-base"
                      value={String(current() ?? "")}
                      onChange={(event) => update(event.currentTarget.value)}
                    >
                      <For each={value.options ?? []}>
                        {(option) => <option value={option.value}>{option.label}</option>}
                      </For>
                    </select>
                  </Show>
                }
              >
                <span class="flex items-center justify-between gap-2 text-11-regular text-text-weak">
                  <span>{current() ? "Enabled" : "Disabled"}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(current())}
                    onChange={(event) => update(event.currentTarget.checked)}
                  />
                </span>
              </Show>
              <Show when={value.helpText}>
                <span class="text-10-regular text-text-weak">{value.helpText}</span>
              </Show>
            </label>
          )
        })()}
      </Match>
      <Match when={props.component.type === "file-upload"}>
        <RichUIFileUpload
          component={props.component as Extract<ChatUIComponent, { type: "file-upload" }>}
          state={props.state}
          setState={props.setState}
          onFilesChange={props.onFilesChange}
        />
      </Match>
      <Match when={props.component.type === "button"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "button" }>
          const run = () => {
            const next = { ...props.state }
            let submit: "submit" | "refresh" | undefined
            for (const action of value.actions) {
              if (action.type === "submit") {
                submit = "submit"
                continue
              }
              if (action.type === "refresh") {
                submit = "refresh"
                continue
              }
              const current = next[action.key]
              if (action.type === "set") next[action.key] = action.value
              if (action.type === "toggle" && typeof current === "boolean") next[action.key] = !current
              if (action.type === "increment" && typeof current === "number") {
                next[action.key] = Math.max(-1e9, Math.min(1e9, current + action.by))
              }
              if (action.type === "filter") next[action.key] = action.value
              if (action.type === "navigate") next[action.key] = action.target
            }
            for (const [key, current] of Object.entries(next)) {
              if (current !== props.state[key]) props.setState(key, current)
            }
            if (submit) props.onSubmit?.(next, submit)
          }
          return (
            <button
              type="button"
              class="w-full rounded-lg px-4 py-2.5 text-12-semibold transition-opacity hover:opacity-85"
              classList={{
                "bg-text-strong text-background-base": value.variant !== "secondary",
                "border border-border-weak-base bg-background-base text-text-base": value.variant === "secondary",
              }}
              onClick={run}
            >
              {value.label}
            </button>
          )
        })()}
      </Match>
      <Match when={props.component.type === "computed"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "computed" }>
          const result = createMemo(() => evaluateNumericExpression(value.expression, props.state))
          return (
            <div class="min-w-0 rounded-lg border border-border-weak-base bg-background-stronger p-3">
              <div class="text-11-medium text-text-weak">{value.label}</div>
              <div class="mt-1 truncate text-20-semibold tabular-nums text-text-strong">
                {formatRichUINumber(result(), value.precision)}
                {value.unit ?? ""}
              </div>
            </div>
          )
        })()}
      </Match>
      <Match when={props.component.type === "state-value"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "state-value" }>
          return (
            <div class="min-w-0 rounded-lg border border-border-weak-base bg-background-stronger p-3">
              <div class="text-11-medium text-text-weak">{value.label}</div>
              <div class="mt-1 truncate text-20-semibold tabular-nums text-text-strong">
                {String(props.state[value.key] ?? "")}
                {value.unit ?? ""}
              </div>
            </div>
          )
        })()}
      </Match>
    </Switch>
  )
}
