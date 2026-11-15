import { For, Match, Show, Switch } from "solid-js"
import { RichUIChart } from "./rich-ui-chart"
import {
  RichUIComposition,
  type ChatUICompositionComponent,
  type ChatUIState,
  type StateSetter,
} from "./rich-ui-composition"
import { Markdown } from "./markdown"
import { RichUISimulation } from "./rich-ui-simulation"
import { RichUIAdvanced } from "./rich-ui-advanced"
import type { ChatUIAdvancedComponent, ChatUIComponent } from "@diveeoi/db/chat-ui"

export function ComponentView(props: {
  component: ChatUIComponent
  state: ChatUIState
  setState: StateSetter
  onSubmit?: (state: ChatUIState, intent?: "submit" | "refresh") => void
  onFilesChange?: (key: string, files: File[]) => void
}) {
  return (
    <Switch>
      <Match
        when={["group", "tabs", "conditional", "field", "button", "file-upload", "state-value", "computed"].includes(
          props.component.type,
        )}
      >
        <RichUIComposition
          component={props.component as ChatUICompositionComponent}
          state={props.state}
          setState={props.setState}
          onSubmit={props.onSubmit}
          onFilesChange={props.onFilesChange}
          renderComponent={(component) => (
            <ComponentView
              component={component}
              state={props.state}
              setState={props.setState}
              onSubmit={props.onSubmit}
              onFilesChange={props.onFilesChange}
            />
          )}
        />
      </Match>
      <Match
        when={[
          "workflow",
          "desktop",
          "database",
          "api",
          "scene",
          "wizard",
          "monitor",
          "circuit",
          "map",
          "data-grid",
          "media",
        ].includes(props.component.type)}
      >
        <RichUIAdvanced
          component={props.component as ChatUIAdvancedComponent}
          state={props.state}
          setState={props.setState}
        />
      </Match>
      <Match when={props.component.type === "heading"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "heading" }>
          return value.level === 2 ? (
            <h2 class="text-16-semibold text-text-strong">{value.text}</h2>
          ) : (
            <h3 class="text-14-semibold text-text-strong">{value.text}</h3>
          )
        })()}
      </Match>
      <Match when={props.component.type === "text"}>
        <div class="text-13-regular leading-relaxed text-text-base">
          <Markdown text={(props.component as Extract<ChatUIComponent, { type: "text" }>).content} />
        </div>
      </Match>
      <Match when={props.component.type === "metric"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "metric" }>
          return (
            <div class="min-w-0 rounded-xl border border-border-weak-base bg-background-stronger p-4">
              <div class="text-11-medium text-text-weak">{value.label}</div>
              <div
                class="mt-1 truncate text-24-semibold tabular-nums"
                classList={{
                  "text-text-strong": value.tone === "default" || !value.tone,
                  "text-icon-success-base": value.tone === "positive",
                  "text-icon-warning-base": value.tone === "warning",
                }}
              >
                {value.value}
                <Show when={value.unit}>
                  <span class="ml-1 text-12-regular text-text-weak">{value.unit}</span>
                </Show>
              </div>
            </div>
          )
        })()}
      </Match>
      <Match when={props.component.type === "callout"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "callout" }>
          return (
            <div
              class="rounded-xl border px-4 py-3"
              classList={{
                "border-border-weak-base bg-background-base": value.tone === "info",
                "border-icon-success-base/30 bg-icon-success-base/5": value.tone === "success",
                "border-icon-warning-base/30 bg-icon-warning-base/5": value.tone === "warning",
              }}
            >
              <div class="text-12-semibold text-text-strong">{value.title}</div>
              <div class="mt-1 text-12-regular leading-relaxed text-text-weak">{value.content}</div>
            </div>
          )
        })()}
      </Match>
      <Match when={props.component.type === "progress"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "progress" }>
          const percent = Math.min(100, Math.max(0, (value.value / value.max) * 100))
          return (
            <div class="rounded-xl border border-border-weak-base bg-background-stronger p-4">
              <div class="flex items-center justify-between gap-3">
                <span class="text-12-medium text-text-strong">{value.label}</span>
                <span class="font-mono text-11-regular tabular-nums text-text-weak">
                  {value.value}
                  {value.unit ?? ""} / {value.max}
                  {value.unit ?? ""}
                </span>
              </div>
              <div class="mt-3 h-2 overflow-hidden rounded-full bg-background-base">
                <div
                  class="h-full rounded-full bg-text-strong/75 transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )
        })()}
      </Match>
      <Match when={props.component.type === "chart"}>
        <RichUIChart chart={props.component as Extract<ChatUIComponent, { type: "chart" }>} />
      </Match>
      <Match when={props.component.type === "table"}>
        {(() => {
          const value = props.component as Extract<ChatUIComponent, { type: "table" }>
          return (
            <div class="min-w-0 overflow-hidden rounded-xl border border-border-weak-base bg-background-stronger">
              <Show when={value.title}>
                <div class="border-b border-border-weak-base px-4 py-3 text-13-semibold text-text-strong">
                  {value.title}
                </div>
              </Show>
              <div class="max-w-full overflow-x-auto">
                <table class="w-full border-collapse text-left text-12-regular">
                  <thead>
                    <tr class="bg-background-base">
                      <For each={value.columns}>
                        {(column) => <th class="whitespace-nowrap px-3 py-2.5 font-medium text-text-weak">{column}</th>}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={value.rows}>
                      {(row) => (
                        <tr class="border-t border-border-weak-base">
                          <For each={row}>{(cell) => <td class="px-3 py-2.5 text-text-base">{cell}</td>}</For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}
      </Match>
      <Match when={props.component.type === "simulation"}>
        <RichUISimulation component={props.component as Extract<ChatUIComponent, { type: "simulation" }>} />
      </Match>
    </Switch>
  )
}
