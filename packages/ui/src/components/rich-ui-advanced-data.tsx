import { createMemo, createSignal, For, Show } from "solid-js"
import type { ChatUIAdvancedComponent } from "@diveeoi/db/chat-ui"

export function Workflow(props: { component: Extract<ChatUIAdvancedComponent, { type: "workflow" }> }) {
  const [selected, setSelected] = createSignal(0)
  const [extra, setExtra] = createSignal<string[]>([])
  const [executed, setExecuted] = createSignal(false)
  const nodes = createMemo(() => [
    ...props.component.nodes,
    ...extra().map((label, index) => ({ id: `added-${index}`, label, kind: "process" as const })),
  ])
  return (
    <section class="flex min-w-0 flex-col gap-3 py-1">
      <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
      <div class="rounded-lg bg-background-base p-3">
        <div class="mb-2 flex items-center justify-between text-10-medium uppercase tracking-wide text-text-weak">
          <span>Workflow canvas</span>
          <span>{nodes().length} nodes</span>
        </div>
        <div class="flex flex-col items-stretch gap-1">
          <For each={nodes()}>
            {(node, index) => (
              <>
                <button
                  type="button"
                  class="flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors"
                  classList={{
                    "border-border-base bg-background-stronger": selected() === index(),
                    "border-border-weak-base bg-background-base": selected() !== index(),
                  }}
                  onClick={() => setSelected(index())}
                >
                  <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-background-base font-mono text-11-medium text-text-weak">
                    {index() + 1}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-12-semibold text-text-strong">{node.label}</span>
                    <span class="block text-10-regular capitalize text-text-weak">{node.kind}</span>
                  </span>
                  <span class="text-10-regular text-text-weak">{selected() === index() ? "Selected" : "Select"}</span>
                </button>
                <Show when={index() < nodes().length - 1}>
                  <div class="flex h-4 items-center justify-center text-text-weak">↓</div>
                </Show>
              </>
            )}
          </For>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          class="rounded-lg border border-border-weak-base px-3 py-2 text-11-medium text-text-base hover:bg-background-base"
          onClick={() => {
            setExtra((value) => [...value, `Process ${value.length + 1}`])
            setExecuted(false)
          }}
        >
          Add node
        </button>
        <button
          type="button"
          class="rounded-lg bg-text-strong px-3 py-2 text-11-semibold text-background-base"
          onClick={() => setExecuted(true)}
        >
          Execute workflow
        </button>
      </div>
      <Show when={executed()}>
        <p class="text-11-medium text-icon-success-base">Workflow completed: {nodes().length} nodes processed.</p>
      </Show>
    </section>
  )
}

export function Desktop(props: { component: Extract<ChatUIAdvancedComponent, { type: "desktop" }> }) {
  const [active, setActive] = createSignal(props.component.apps[0]?.id ?? "")
  const selected = createMemo(() => props.component.apps.find((app) => app.id === active()) ?? props.component.apps[0])
  return (
    <section class="overflow-hidden rounded-xl border border-border-weak-base bg-[#101923] p-3 text-white">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-14-semibold">{props.component.title}</h3>
        <span class="text-10-regular text-slate-300">Desktop preview</span>
      </div>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <For each={props.component.apps}>
          {(app) => (
            <button
              type="button"
              class="flex min-w-0 flex-col items-center gap-1 rounded-lg p-2 text-center transition-colors"
              classList={{
                "bg-slate-600": active() === app.id,
                "bg-slate-800 hover:bg-slate-700": active() !== app.id,
              }}
              onClick={() => setActive(app.id)}
            >
              <span class="flex size-8 items-center justify-center rounded-lg bg-slate-700 text-12-semibold">
                {app.icon.slice(0, 2).toUpperCase()}
              </span>
              <span class="max-w-full truncate text-10-medium">{app.name}</span>
            </button>
          )}
        </For>
      </div>
      <div class="mt-3 rounded-lg border border-slate-700 bg-slate-800 p-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-12-semibold">{selected()?.name}</span>
          <span class="text-10-regular text-slate-300">Window</span>
        </div>
        <pre class="whitespace-pre-wrap break-words font-sans text-11-regular leading-relaxed text-slate-200">
          {selected()?.content}
        </pre>
      </div>
    </section>
  )
}

export function Database(props: { component: Extract<ChatUIAdvancedComponent, { type: "database" }> }) {
  const [selected, setSelected] = createSignal(0)
  return (
    <section class="flex min-w-0 flex-col gap-3 py-1">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
        <span class="text-10-regular text-text-weak">{props.component.rows.length} records</span>
      </div>
      <div class="max-w-full overflow-x-auto rounded-lg border border-border-weak-base">
        <table class="w-full border-collapse text-left text-11-regular">
          <thead>
            <tr class="bg-background-base">
              <For each={props.component.columns}>
                {(column) => <th class="whitespace-nowrap px-3 py-2 font-medium text-text-weak">{column}</th>}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={props.component.rows}>
              {(row, index) => (
                <tr>
                  <For each={row}>
                    {(cell, cellIndex) => (
                      <td class="border-t border-border-weak-base px-3 py-2">
                        <Show when={cellIndex() === 0} fallback={<span class="text-text-base">{cell}</span>}>
                          <button
                            type="button"
                            class="font-medium text-text-strong underline-offset-2 hover:underline"
                            onClick={() => setSelected(index())}
                          >
                            {cell}
                          </button>
                        </Show>
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <div class="rounded-lg bg-background-base p-3">
        <div class="mb-2 text-10-medium uppercase tracking-wide text-text-weak">Selected record</div>
        <dl class="grid grid-cols-2 gap-x-3 gap-y-2">
          {" "}
          <For each={props.component.columns}>
            {(column, index) => (
              <>
                <dt class="truncate text-10-regular text-text-weak">{column}</dt>
                <dd class="break-words text-11-medium text-text-strong">
                  {props.component.rows[selected()]?.[index()] ?? ""}
                </dd>
              </>
            )}
          </For>
        </dl>
      </div>
    </section>
  )
}

export function API(props: { component: Extract<ChatUIAdvancedComponent, { type: "api" }> }) {
  const [method, setMethod] = createSignal(props.component.methods[0] ?? "GET")
  const [endpoint, setEndpoint] = createSignal(props.component.endpoint)
  const [sent, setSent] = createSignal(false)
  return (
    <section class="flex min-w-0 flex-col gap-3 py-1">
      <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
      <div class="flex min-w-0 gap-2">
        <select
          aria-label="HTTP method"
          class="h-9 rounded-lg border border-border-weak-base bg-background-base px-2 text-11-medium text-text-strong"
          value={method()}
          onChange={(event) => {
            setMethod(event.currentTarget.value as (typeof props.component.methods)[number])
            setSent(false)
          }}
        >
          <For each={props.component.methods}>{(value) => <option value={value}>{value}</option>}</For>
        </select>
        <input
          aria-label="API endpoint"
          class="h-9 min-w-0 flex-1 rounded-lg border border-border-weak-base bg-background-base px-3 text-11-regular text-text-base"
          value={endpoint()}
          onInput={(event) => {
            setEndpoint(event.currentTarget.value)
            setSent(false)
          }}
        />
      </div>
      <button
        type="button"
        class="self-end rounded-lg bg-text-strong px-3 py-2 text-11-semibold text-background-base"
        onClick={() => setSent(true)}
      >
        Send simulated request
      </button>
      <Show when={sent()}>
        <div class="overflow-hidden rounded-lg border border-border-weak-base bg-background-base">
          <div class="flex items-center justify-between border-b border-border-weak-base px-3 py-2">
            <span class="text-11-semibold text-text-strong">Response preview</span>
            <span class="text-10-medium text-icon-success-base">{props.component.sampleStatus} · Simulated</span>
          </div>
          <div class="px-3 py-2 text-10-regular text-text-weak">
            {method()} {endpoint()}
          </div>
          <pre class="max-h-52 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-11-regular text-text-base">
            {props.component.sampleResponse}
          </pre>
        </div>
      </Show>
      <p class="text-10-regular text-text-weak">Local demonstration only. No network request is made.</p>
    </section>
  )
}
