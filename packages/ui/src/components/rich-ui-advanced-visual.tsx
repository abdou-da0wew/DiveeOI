import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import type { ChatUIAdvancedComponent } from "@diveeoi/db/chat-ui"

export function Scene(props: { component: Extract<ChatUIAdvancedComponent, { type: "scene" }> }) {
  const [rotation, setRotation] = createSignal(props.component.rotation)
  return (
    <section class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-weak-base bg-background-stronger p-4">
      <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
      <Show when={props.component.description}>
        <p class="text-11-regular text-text-weak">{props.component.description}</p>
      </Show>
      <div
        class="flex h-44 items-center justify-center overflow-hidden rounded-lg bg-[#111c2b]"
        style={{ perspective: "600px" }}
      >
        <svg
          viewBox="0 0 240 160"
          class="h-full w-full max-w-sm"
          role="img"
          aria-label={`${props.component.shape} scene`}
        >
          <g transform={`rotate(${rotation()} 120 80)`}>
            <Switch
              fallback={
                <>
                  <path d="M120 24 L178 126 H62 Z" fill="#2563eb" stroke="#93c5fd" stroke-width="2" />
                  <path d="M120 24 L120 126" stroke="#bfdbfe" stroke-width="1.5" />
                </>
              }
            >
              <Match when={props.component.shape === "cube"}>
                <path d="M120 25 L174 55 L120 85 L66 55 Z" fill="#93c5fd" stroke="#dbeafe" />
                <path d="M66 55 L120 85 L120 140 L66 110 Z" fill="#2563eb" stroke="#93c5fd" />
                <path d="M120 85 L174 55 L174 110 L120 140 Z" fill="#1d4ed8" stroke="#93c5fd" />
              </Match>
              <Match when={props.component.shape === "sphere"}>
                <circle cx="120" cy="82" r="54" fill="#2563eb" stroke="#93c5fd" stroke-width="2" />
                <ellipse cx="120" cy="82" rx="25" ry="54" fill="none" stroke="#bfdbfe" opacity=".7" />
                <path d="M67 82 H173" stroke="#bfdbfe" opacity=".7" />
              </Match>
            </Switch>
          </g>
        </svg>
      </div>
      <div class="flex items-center justify-between text-11-regular text-text-weak">
        <span>Rotation</span>
        <span class="font-mono tabular-nums">{rotation()}°</span>
      </div>
      <input
        aria-label="Scene rotation"
        class="w-full accent-current"
        type="range"
        min="0"
        max="360"
        step="5"
        value={rotation()}
        onInput={(event) => setRotation(Number(event.currentTarget.value))}
      />
    </section>
  )
}

export function Wizard(props: { component: Extract<ChatUIAdvancedComponent, { type: "wizard" }> }) {
  const [step, setStep] = createSignal(0)
  const [answers, setAnswers] = createSignal<string[]>([])
  const current = createMemo(() => props.component.steps[step()])
  const update = (value: string) =>
    setAnswers((old) => {
      const next = [...old]
      next[step()] = value
      return next
    })
  return (
    <section class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-weak-base bg-background-stronger p-4">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
        <span class="text-10-medium text-text-weak">
          {Math.min(step() + 1, props.component.steps.length)} / {props.component.steps.length}
        </span>
      </div>
      <div class="flex gap-1">
        <For each={props.component.steps}>
          {(_, index) => (
            <div
              class="h-1.5 flex-1 rounded-full"
              classList={{ "bg-text-strong": index() <= step(), "bg-background-base": index() > step() }}
            />
          )}
        </For>
      </div>
      <Show
        when={step() < props.component.steps.length}
        fallback={
          <div class="rounded-lg bg-background-base p-4">
            <div class="text-13-semibold text-text-strong">Setup complete</div>
            <p class="mt-1 text-11-regular text-text-weak">Your responses have been collected in this local session.</p>
            <button
              type="button"
              class="mt-3 rounded-lg border border-border-weak-base px-3 py-2 text-11-medium text-text-base"
              onClick={() => {
                setStep(0)
                setAnswers([])
              }}
            >
              Start again
            </button>
          </div>
        }
      >
        <div>
          <h4 class="text-13-semibold text-text-strong">{current()?.title}</h4>
          <p class="mt-1 text-11-regular text-text-weak">{current()?.description}</p>
          <label class="mt-3 block text-11-medium text-text-base">
            {current()?.fieldLabel}
            <input
              class="mt-1 h-9 w-full rounded-lg border border-border-weak-base bg-background-base px-3 text-11-regular text-text-base"
              placeholder={current()?.placeholder ?? "Enter a value"}
              value={answers()[step()] ?? ""}
              onInput={(event) => update(event.currentTarget.value)}
            />
          </label>
        </div>
        <div class="flex items-center justify-between">
          <button
            type="button"
            disabled={step() === 0}
            class="rounded-lg border border-border-weak-base px-3 py-2 text-11-medium text-text-base disabled:opacity-40"
            onClick={() => setStep((value) => Math.max(0, value - 1))}
          >
            Back
          </button>
          <button
            type="button"
            class="rounded-lg bg-text-strong px-3 py-2 text-11-semibold text-background-base"
            onClick={() => setStep((value) => value + 1)}
          >
            {step() === props.component.steps.length - 1 ? "Finish" : "Continue"}
          </button>
        </div>
      </Show>
    </section>
  )
}

export function Monitor(props: { component: Extract<ChatUIAdvancedComponent, { type: "monitor" }> }) {
  const [paused, setPaused] = createSignal(false)
  const [refresh, setRefresh] = createSignal(0)
  return (
    <section class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-weak-base bg-background-stronger p-4">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
        <span class="rounded-full bg-background-base px-2 py-1 text-10-medium text-text-weak">
          {paused() ? "Paused" : "Monitoring"}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <For each={props.component.metrics}>
          {(metric, index) => (
            <div class="min-w-0 rounded-lg bg-background-base p-3">
              <div class="truncate text-10-medium text-text-weak">{metric.label}</div>
              <div class="mt-1 truncate text-20-semibold tabular-nums text-text-strong">
                {paused() ? metric.value : metric.value + ((refresh() + index()) % 4) * 0.1}
                {metric.unit ?? ""}
              </div>
            </div>
          )}
        </For>
      </div>
      <div class="flex items-center justify-between gap-2">
        <span class="text-10-regular text-text-weak">Demonstration metrics, not live telemetry.</span>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-lg border border-border-weak-base px-3 py-2 text-10-medium text-text-base"
            onClick={() => setPaused((value) => !value)}
          >
            {paused() ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            disabled={paused()}
            class="rounded-lg bg-text-strong px-3 py-2 text-10-semibold text-background-base disabled:opacity-40"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh
          </button>
        </div>
      </div>
    </section>
  )
}

export function Circuit(props: { component: Extract<ChatUIAdvancedComponent, { type: "circuit" }> }) {
  const [enabled, setEnabled] = createSignal(true)
  const [voltage, setVoltage] = createSignal(props.component.voltage)
  const [resistance, setResistance] = createSignal(props.component.resistance)
  const current = createMemo(() => (enabled() ? voltage() / resistance() : 0))
  const power = createMemo(() => (enabled() ? voltage() * current() : 0))
  return (
    <section class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-weak-base bg-background-stronger p-4">
      <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
      <div class="rounded-lg bg-background-base p-3">
        <svg viewBox="0 0 320 100" class="w-full" role="img" aria-label="Series circuit diagram">
          <g fill="none" stroke-width="2.5" stroke-linecap="round">
            <path d="M40 25 H112 M160 25 H280 V78 H40 V25" stroke={enabled() ? "#16a34a" : "#64748b"} />
            <path d="M112 10 V40 M160 10 V40" stroke="#3b82f6" />
            <path d="M112 25 L120 15 L130 35 L140 15 L150 35 L160 25" stroke="#d97706" />
            <path d="M40 25 V42 M40 62 V78" stroke="#16a34a" />
            <path d="M26 42 H54 M31 62 H49" stroke="#3b82f6" />
          </g>
          <g fill="currentColor" font-size="10">
            <text x="40" y="12" text-anchor="middle">
              Source
            </text>
            <text x="136" y="9" text-anchor="middle">
              R
            </text>
          </g>
        </svg>
        <div class="text-10-regular text-text-weak">Ideal DC series circuit · {enabled() ? "Closed" : "Open"}</div>
      </div>
      <label class="flex items-center justify-between text-11-medium text-text-base">
        Circuit switch
        <input type="checkbox" checked={enabled()} onChange={(event) => setEnabled(event.currentTarget.checked)} />
      </label>
      <label class="flex flex-col gap-1 text-11-medium text-text-base">
        <span class="flex justify-between">
          <span>Voltage</span>
          <span class="font-mono">{voltage().toFixed(1)} V</span>
        </span>
        <input
          type="range"
          min="0"
          max="24"
          step="0.5"
          value={voltage()}
          onInput={(event) => setVoltage(Number(event.currentTarget.value))}
        />
      </label>
      <label class="flex flex-col gap-1 text-11-medium text-text-base">
        <span class="flex justify-between">
          <span>Resistance</span>
          <span class="font-mono">{resistance().toFixed(1)} Ω</span>
        </span>
        <input
          type="range"
          min="0.1"
          max="1000000"
          step="0.1"
          value={Math.min(1000, resistance())}
          onInput={(event) => setResistance(Number(event.currentTarget.value))}
        />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-lg bg-background-base p-3">
          <div class="text-10-medium text-text-weak">Current</div>
          <div class="mt-1 text-18-semibold tabular-nums text-text-strong">{(current() * 1000).toFixed(2)} mA</div>
        </div>
        <div class="rounded-lg bg-background-base p-3">
          <div class="text-10-medium text-text-weak">Power</div>
          <div class="mt-1 text-18-semibold tabular-nums text-text-strong">{(power() * 1000).toFixed(2)} mW</div>
        </div>
      </div>
    </section>
  )
}
