import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import type { ChatUIComponent, ChatUILayoutMode, ChatUIStateValue } from "@diveeoi/db/chat-ui"
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
  layoutMode: ChatUILayoutMode
  depth: number
  renderComponent: (component: ChatUIComponent) => JSX.Element
  onSubmit?: (state: ChatUIState, intent?: "submit" | "refresh") => void
  onFilesChange?: (key: string, files: File[]) => void
}) {
  return (
    <Switch>
      <Match when={props.component.type === "group"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "group" }>
          const surfaced = () =>
            value.surface !== "none" &&
            (props.layoutMode === "manual" || (props.layoutMode === "hybrid" && props.depth === 0))
          return (
            <section
              class="flex min-w-0 flex-col"
              classList={{
                "gap-2": value.gap === "tight",
                "gap-3": value.gap === "normal" || !value.gap,
                "gap-5": value.gap === "relaxed",
                "rounded-xl bg-background-base/60 p-3": surfaced() && value.surface === "subtle",
                "rounded-xl border border-border-weak-base p-3": surfaced() && value.surface === "outlined",
                "border-t border-border-weak-base pt-3": value.separator === "top" && props.layoutMode !== "auto",
                "border-b border-border-weak-base pb-3": value.separator === "bottom" && props.layoutMode !== "auto",
              }}
            >
              <Show when={value.title}>
                <h3 class="text-12-semibold text-text-strong">{value.title}</h3>
              </Show>
              <div
                class="grid min-w-0"
                style={value.layout === "stack" || value.layout === "row"
                  ? undefined
                  : { "grid-template-columns": "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" }}
                classList={{
                  "grid-cols-1": value.layout === "stack",
                  "grid-cols-1 sm:grid-cols-2": value.layout === "grid" && props.layoutMode === "manual",
                  "grid-cols-1 sm:flex sm:flex-wrap sm:items-start": value.layout === "row",
                  "gap-2": value.gap === "tight" && value.separator !== "between",
                  "gap-3": (value.gap === "normal" || !value.gap) && value.separator !== "between",
                  "gap-5": value.gap === "relaxed" && value.separator !== "between",
                  "gap-0": value.separator === "between" && props.layoutMode !== "auto",
                }}
              >
                <For each={value.components}>
                  {(component) => (
                    <div
                      class="min-w-0"
                      classList={{
                        "border-b border-border-weak-base py-3 last:border-0": value.separator === "between" && props.layoutMode !== "auto",
                      }}
                    >
                      {props.renderComponent(component)}
                    </div>
                  )}
                </For>
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
          const surfaced = () =>
            value.surface !== "none" &&
            (props.layoutMode === "manual" || (props.layoutMode === "hybrid" && props.depth === 0))
          return (
            <section
              class="flex min-w-0 flex-col gap-3"
              classList={{
                "rounded-xl bg-background-base/60 p-3": surfaced() && value.surface === "subtle",
                "rounded-xl border border-border-weak-base p-3": surfaced() && value.surface === "outlined",
              }}
            >
              <Show when={value.title}>
                <h3 class="text-12-semibold text-text-strong">{value.title}</h3>
              </Show>
              <div class="flex min-w-0 gap-1 overflow-x-auto border-b border-border-weak-base">
                <For each={value.tabs}>
                  {(tab) => (
                    <button
                      type="button"
                      class="shrink-0 border-b-2 px-3 py-2 text-11-medium transition-colors"
                      classList={{
                        "border-text-strong text-text-strong": active() === tab.id,
                        "border-transparent text-text-weak hover:text-text-base": active() !== tab.id,
                      }}
                      aria-pressed={active() === tab.id}
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
            <label class="flex min-w-0 flex-col gap-2 text-12-medium text-text-strong">
              <span>{value.label}{value.required ? " *" : ""}</span>
              <Show when={value.control === "text"}>
                <input
                  type="text"
                  class="h-9 w-full rounded-md border border-border-weak-base bg-background-base px-3 text-12-regular text-text-base outline-none focus:border-border-base"
                  value={String(current() ?? "")}
                  placeholder={value.placeholder}
                  required={value.required}
                  minLength={value.minLength}
                  maxLength={value.maxLength ?? 240}
                  pattern={value.pattern}
                  onInput={(event) => update(event.currentTarget.value)}
                />
              </Show>
              <Show when={value.control === "number"}>
                <input
                  type="number"
                  class="h-9 w-full rounded-md border border-border-weak-base bg-background-base px-3 text-12-regular text-text-base outline-none focus:border-border-base"
                  value={String(current() ?? 0)}
                  min={value.min}
                  max={value.max}
                  placeholder={value.placeholder}
                  required={value.required}
                  onInput={(event) => update(Number(event.currentTarget.value))}
                />
              </Show>
              <Show when={value.control === "toggle"}>
                <span class="flex items-center justify-between gap-3 rounded-md bg-background-base px-3 py-2">
                  <span class="text-11-regular text-text-weak">{current() ? "Enabled" : "Disabled"}</span>
                  <input
                    type="checkbox"
                    class="size-4 accent-current"
                    checked={Boolean(current())}
                    onChange={(event) => update(event.currentTarget.checked)}
                  />
                </span>
              </Show>
              <Show when={value.control === "select"}>
                <select
                  class="h-9 w-full rounded-md border border-border-weak-base bg-background-base px-3 text-12-regular text-text-base"
                  value={String(current() ?? "")}
                  required={value.required}
                  onChange={(event) => update(event.currentTarget.value)}
                >
                  <For each={value.options ?? []}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                </select>
              </Show>
              <Show when={value.helpText}>
                <span class="text-10-regular leading-relaxed text-text-weak">{value.helpText}</span>
              </Show>
            </label>
          )
        })()}
      </Match>
      <Match when={props.component.type === "file-upload"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "file-upload" }>
          return (
            <div class="flex min-w-0 flex-col gap-2">
              <RichUIFileUpload
                component={value}
                state={props.state}
                setState={props.setState}
                onFilesChange={props.onFilesChange}
              />
            </div>
          )
        })()}
      </Match>
      <Match when={props.component.type === "button"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "button" }>
          const run = () => {
            for (const action of value.actions) {
              if (action.type === "submit" || action.type === "refresh") {
                props.onSubmit?.(props.state, action.type)
                continue
              }
              const current = props.state[action.key]
              if (action.type === "set" || action.type === "filter") props.setState(action.key, action.value)
              if (action.type === "toggle" && typeof current === "boolean") props.setState(action.key, !current)
              if (action.type === "increment" && typeof current === "number") props.setState(action.key, current + action.by)
              if (action.type === "navigate") props.setState(action.key, action.target)
            }
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
      <Match when={props.component.type === "state-value"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "state-value" }>
          return (
            <div class="min-w-0 py-2">
              <div class="text-10-medium text-text-weak">{value.label}</div>
              <div class="mt-1 truncate text-20-semibold tabular-nums text-text-strong">
                {String(props.state[value.key] ?? "")}
                <Show when={value.unit}>
                  <span class="ml-1 text-11-regular text-text-weak">{value.unit}</span>
                </Show>
              </div>
            </div>
          )
        })()}
      </Match>
      <Match when={props.component.type === "computed"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "computed" }>
          const result = createMemo(() => evaluateNumericExpression(value.expression, props.state))
          return (
            <div class="min-w-0 py-2">
              <div class="text-10-medium text-text-weak">{value.label}</div>
              <div class="mt-1 text-20-semibold tabular-nums text-text-strong">
                {formatRichUINumber(result(), value.precision)}
                <Show when={value.unit}>
                  <span class="ml-1 text-11-regular text-text-weak">{value.unit}</span>
                </Show>
              </div>
            </div>
          )
        })()}
      </Match>
    </Switch>
  )
}
