import { createMemo, For, Show } from "solid-js"
import type { ChatUIComponent, ChatUIStateValue } from "@diveeoi/db/chat-ui"

type Chart = Extract<ChatUIComponent, { type: "chart" }>
type State = Record<string, ChatUIStateValue>

export function RichUIChart(props: { chart: Chart; state: State }) {
  const points = createMemo(() =>
    props.chart.points.map((point) => ({
      label: point.label,
      value: "key" in point ? (typeof props.state[point.key] === "number" ? (props.state[point.key] as number) : 0) : point.value,
    })),
  )
  const bounds = createMemo(() => {
    const values = points().map((point) => point.value)
    const min = Math.min(0, ...values)
    const max = Math.max(0, ...values)
    return { min, max: max === min ? min + 1 : max }
  })
  const bars = createMemo(() => {
    const range = bounds().max - bounds().min
    return points().map((point) => ({
      ...point,
      height: Math.max(3, (Math.abs(point.value) / Math.max(Math.abs(bounds().min), Math.abs(bounds().max), 1)) * 100),
      offset: ((point.value - bounds().min) / range) * 100,
    }))
  })
  const polyline = createMemo(() => {
    const values = points()
    const low = Math.min(...values.map((point) => point.value))
    const high = Math.max(...values.map((point) => point.value))
    const range = high === low ? 1 : high - low
    return values
      .map((point, index) => {
        const x = 8 + (index / Math.max(1, values.length - 1)) * 284
        const y = 84 - ((point.value - low) / range) * 68
        return `${x},${y}`
      })
      .join(" ")
  })

  return (
    <section class="flex min-w-0 flex-col gap-3 py-1">
      <div class="flex min-w-0 items-center justify-between gap-3">
        <h3 class="text-13-semibold text-text-strong">{props.chart.title}</h3>
        <Show when={props.chart.points.some((point) => "key" in point)}>
          <span class="shrink-0 text-9-medium uppercase tracking-wide text-icon-success-base">Live data</span>
        </Show>
      </div>
      <Show
        when={props.chart.kind === "line"}
        fallback={
          <div class="flex h-36 min-w-0 items-end gap-2 border-b border-border-weak-base px-2 pb-1">
            <For each={bars()}>
              {(point) => (
                <div class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span class="text-10-regular tabular-nums text-text-weak">{point.value}</span>
                  <div
                    class="w-full max-w-12 rounded-t-md bg-text-strong/70 transition-[height] duration-200"
                    style={{ height: `${point.height}%` }}
                    title={`${point.label}: ${point.value}`}
                  />
                  <span class="max-w-full truncate text-10-regular text-text-weak">{point.label}</span>
                </div>
              )}
            </For>
          </div>
        }
      >
        <div class="min-w-0">
          <svg viewBox="0 0 300 100" role="img" aria-label={props.chart.title} class="h-36 w-full overflow-visible">
            <line x1="8" y1="84" x2="292" y2="84" stroke="currentColor" opacity="0.15" />
            <polyline
              points={polyline()}
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <For each={points()}>
              {(point, index) => {
                const values = points().map((item) => item.value)
                const low = Math.min(...values)
                const high = Math.max(...values)
                const range = high === low ? 1 : high - low
                const x = 8 + (index() / Math.max(1, points().length - 1)) * 284
                const y = 84 - ((point.value - low) / range) * 68
                return <circle cx={x} cy={y} r="3.5" fill="currentColor"><title>{point.label}: {point.value}</title></circle>
              }}
            </For>
          </svg>
          <div class="flex min-w-0 justify-between gap-2">
            <For each={points()}>
              {(point) => <span class="min-w-0 flex-1 truncate text-center text-9-regular text-text-weak">{point.label}</span>}
            </For>
          </div>
        </div>
      </Show>
      <div class="grid min-w-0 grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        <For each={points()}>
          {(point) => (
            <div class="flex min-w-0 items-baseline justify-between gap-2">
              <span class="truncate text-10-regular text-text-weak">{point.label}</span>
              <span class="shrink-0 font-mono text-10-medium tabular-nums text-text-base">{point.value}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  )
}
