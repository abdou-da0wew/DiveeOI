import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { ChatUIComponent, ChatUIControl } from "@diveeoi/db/chat-ui"
import { evaluateNumericExpression, formatRichUINumber } from "./rich-ui-expression"

type Simulation = Extract<ChatUIComponent, { type: "simulation" }>
type Values = Record<string, number | boolean | string>

function initialValue(control: ChatUIControl) {
  return control.value
}

function Control(props: {
  control: ChatUIControl
  value: number | boolean | string
  onChange: (value: number | boolean | string) => void
}) {
  const control = props.control
  const slider = control.type === "slider" ? control : undefined
  const toggle = control.type === "toggle" ? control : undefined
  const select = control.type === "select" ? control : undefined

  return (
    <label class="flex min-w-0 flex-col gap-2 rounded-lg border border-border-weak-base bg-background-base p-3">
      <span class="flex items-center justify-between gap-3 text-12-medium text-text-strong">
        <span>{control.label}</span>
        <Show when={slider}>
          <span class="font-mono text-11-regular text-text-weak tabular-nums">
            {typeof props.value === "number" ? formatRichUINumber(props.value, 2) : ""}
            {slider?.unit ?? ""}
          </span>
        </Show>
      </span>
      {slider && (
        <input
          type="range"
          class="w-full accent-current"
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={String(props.value)}
          onInput={(event) => props.onChange(Number(event.currentTarget.value))}
          aria-label={slider.label}
        />
      )}
      {toggle && (
        <span class="flex items-center justify-between gap-3">
          <span class="text-11-regular text-text-weak">{props.value ? "Enabled" : "Disabled"}</span>
          <input
            type="checkbox"
            class="size-4 accent-current"
            checked={Boolean(props.value)}
            onChange={(event) => props.onChange(event.currentTarget.checked)}
            aria-label={toggle.label}
          />
        </span>
      )}
      {select && (
        <select
          class="h-9 min-w-0 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular text-text-base"
          value={String(props.value)}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          aria-label={select.label}
        >
          <For each={select.options}>{(option) => <option value={option.value}>{option.label}</option>}</For>
        </select>
      )}
    </label>
  )
}

export function RichUISimulation(props: { component: Simulation }) {
  const [values, setValues] = createStore<Values>(
    Object.fromEntries(props.component.controls.map((control) => [control.id, initialValue(control)])),
  )
  const outputs = () =>
    props.component.outputs.map((output) => ({
      ...output,
      value: evaluateNumericExpression(output.expression, values),
    }))

  return (
    <section class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-weak-base bg-background-stronger p-4">
      <div class="flex flex-col gap-1">
        <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
        <Show when={props.component.description}>
          <p class="text-12-regular leading-relaxed text-text-weak">{props.component.description}</p>
        </Show>
      </div>
      <div class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <For each={props.component.controls}>
          {(control) => (
            <Control
              control={control}
              value={values[control.id] ?? control.value}
              onChange={(value) => setValues(control.id, value)}
            />
          )}
        </For>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <For each={outputs()}>
          {(output) => (
            <div class="min-w-0 rounded-lg bg-background-base px-3 py-3">
              <div class="text-11-medium text-text-weak">{output.label}</div>
              <div class="mt-1 truncate font-mono text-20-semibold tabular-nums text-text-strong">
                {formatRichUINumber(output.value, output.precision ?? 2)}
                <Show when={output.unit}>
                  <span class="ml-1 text-12-regular text-text-weak">{output.unit}</span>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  )
}
