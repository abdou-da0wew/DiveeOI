import { createMemo, For, Show } from "solid-js"
import type { ChatUIComponent } from "@diveeoi/db/chat-ui"

type Chart = Extract<ChatUIComponent, { type: "chart" }>

export function RichUIChart(props: { chart: Chart }) {
  const bounds = createMemo(() => {
    const values = props.chart.points.map((point) => point.value)
    const min = Math.min(0, ...values)
    const max = Math.max(0, ...values)
    return { min, max: max === min ? min + 1 : max }
  })
  const bars = createMemo(() => {
    const range = bounds().max - bounds().min
    return props.chart.points.map((point) => ({
      ...point,
      height: Math.max(3, (Math.abs(point.value) / Math.max(Math.abs(bounds().min), Math.abs(bounds().max), 1)) * 100),
      offset: ((point.value - bounds().min) / range) * 100,
    }))
  })
  const polyline = createMemo(() => {
    const points = props.chart.points
    const low = Math.min(...points.map((point) => point.value))
    const high = Math.max(...points.map((point) => point.value))
    const range = high === low ? 1 : high - low
    return points
      .map((point, index) => {
        const x = 8 + (index / Math.max(1, points.length - 1)) * 284
        const y = 84 - ((point.value - low) / range) * 68
        return `${x},${y}`
      })
      .join(" ")
  })

  return (
    <section class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-weak-base bg-background-stronger p-4">
      <h3 class="text-13-semibold text-text-strong">{props.chart.title}</h3>
      <Show
        when={props.chart.kind === "line"}
        fallback={
          <div class="flex h-36 items-end gap-2 border-b border-border-weak-base px-2 pb-1">
            <For each={bars()}>
              {(point) => (
                <div class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span class="text-10-regular tabular-nums text-text-weak">{point.value}</span>
                  <div
                    class="w-full max-w-12 rounded-t-md bg-text-strong/70"
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
            <For each={props.chart.points}>
              {(point, index) => {
                const values = props.chart.points.map((item) => item.value)
                const low = Math.min(...values)
                const high = Math.max(...values)
                const range = high === low ? 1 : high - low
                return (
                  <circle
                    cx={8 + (index() / Math.max(1, props.chart.points.length - 1)) * 284}
                    cy={84 - ((point.value - low) / range) * 68}
                    r="3.5"
                    fill="currentColor"
                  />
                )
              }}
            </For>
          </svg>
          <div class="grid grid-cols-4 gap-1">
            <For each={props.chart.points}>
              {(point) => <span class="truncate text-center text-10-regular text-text-weak">{point.label}</span>}
            </For>
          </div>
        </div>
      </Show>
    </section>
  )
}
