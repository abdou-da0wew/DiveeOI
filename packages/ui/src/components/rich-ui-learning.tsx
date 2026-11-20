import { createMemo, createSignal, For, Show } from "solid-js"
import type { ChatUIDiagramComponent, ChatUIQuizComponent } from "@diveeoi/db/chat-ui"

export function RichUIQuiz(props: { component: ChatUIQuizComponent }) {
  const [answers, setAnswers] = createSignal<Record<string, string[]>>({})
  const [checked, setChecked] = createSignal<Record<string, boolean>>({})
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [finished, setFinished] = createSignal(false)
  const question = createMemo(() => props.component.questions[activeIndex()]!)
  const selected = () => answers()[question().id] ?? []
  const isCorrect = (item: ChatUIQuizComponent["questions"][number]) => {
    const actual = [...(answers()[item.id] ?? [])].sort()
    const expected = [...item.correctOptionIds].sort()
    return actual.length === expected.length && actual.every((id, index) => id === expected[index])
  }
  const score = createMemo(() => props.component.questions.filter(isCorrect).length)
  const choose = (optionID: string) => {
    if (checked()[question().id]) return
    setAnswers((current) => {
      const existing = current[question().id] ?? []
      const next =
        question().selection === "single"
          ? [optionID]
          : existing.includes(optionID)
            ? existing.filter((id) => id !== optionID)
            : [...existing, optionID]
      return { ...current, [question().id]: next }
    })
  }
  const check = () => {
    if (selected().length === 0) return
    setChecked((current) => ({ ...current, [question().id]: true }))
  }
  const next = () => {
    if (activeIndex() === props.component.questions.length - 1) setFinished(true)
    else setActiveIndex((index) => index + 1)
  }
  const reset = () => {
    setAnswers({})
    setChecked({})
    setActiveIndex(0)
    setFinished(false)
  }

  return (
    <section class="flex min-w-0 flex-col gap-3">
      <div class="flex min-w-0 items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
          <Show when={props.component.description}>
            <p class="mt-1 text-12-regular leading-relaxed text-text-weak">{props.component.description}</p>
          </Show>
        </div>
        <span class="shrink-0 rounded-full bg-background-base px-2.5 py-1 text-10-medium tabular-nums text-text-weak">
          {finished() ? "Complete" : `${activeIndex() + 1} / ${props.component.questions.length}`}
        </span>
      </div>
      <Show
        when={!finished()}
        fallback={
          <div class="flex flex-col gap-3 border-t border-border-weak-base pt-3">
            <div class="text-center">
              <div class="text-26-semibold tabular-nums text-text-strong">
                {score()} / {props.component.questions.length}
              </div>
              <div class="mt-1 text-12-regular text-text-weak">Correct answers</div>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-background-base">
              <div
                class="h-full rounded-full bg-icon-success-base transition-[width] duration-300"
                style={{ width: `${(score() / props.component.questions.length) * 100}%` }}
              />
            </div>
            <button type="button" class="self-center rounded-lg border border-border-weak-base px-3 py-2 text-12-medium text-text-base hover:bg-background-base" onClick={reset}>
              Try again
            </button>
          </div>
        }
      >
        <div class="h-1.5 overflow-hidden rounded-full bg-background-base">
          <div
            class="h-full rounded-full bg-text-strong/70 transition-[width] duration-200"
            style={{ width: `${((activeIndex() + 1) / props.component.questions.length) * 100}%` }}
          />
        </div>
        <div class="flex flex-col gap-3">
          <h4 class="text-13-semibold leading-relaxed text-text-strong">{question().prompt}</h4>
          <p class="text-10-regular text-text-weak">
            {question().selection === "multiple" ? "Choose all correct answers" : "Choose one answer"}
          </p>
          <div class="grid min-w-0 gap-2">
            <For each={question().options}>
              {(option, index) => {
                const chosen = () => selected().includes(option.id)
                const revealed = () => Boolean(checked()[question().id])
                const correct = () => question().correctOptionIds.includes(option.id)
                return (
                  <button
                    type="button"
                    class="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
                    classList={{
                      "border-border-base bg-background-base text-text-strong": chosen() && !revealed(),
                      "border-border-weak-base text-text-base hover:bg-background-base": !chosen() && !revealed(),
                      "border-icon-success-base/50 bg-icon-success-base/10 text-text-strong": revealed() && correct(),
                      "border-icon-danger-base/40 bg-icon-danger-base/5 text-text-base": revealed() && chosen() && !correct(),
                    }}
                    disabled={revealed()}
                    aria-pressed={chosen()}
                    onClick={() => choose(option.id)}
                  >
                    <span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-background-stronger text-10-medium tabular-nums text-text-weak">
                      {String.fromCharCode(65 + index())}
                    </span>
                    <span class="min-w-0 flex-1 text-12-regular">{option.label}</span>
                    <Show when={chosen() && !revealed()}>
                      <span class="size-2 shrink-0 rounded-full bg-text-strong" />
                    </Show>
                    <Show when={revealed() && correct()}>
                      <span class="text-11-semibold text-icon-success-base">Correct</span>
                    </Show>
                  </button>
                )
              }}
            </For>
          </div>
          <Show when={checked()[question().id]}>
            <div class="border-l-2 border-icon-success-base/70 py-1 pl-3">
              <p class="text-12-semibold text-text-strong">
                {isCorrect(question()) ? "That's right." : "Not quite. Review the correct choice above."}
              </p>
              <Show when={question().explanation}>
                <p class="mt-1 text-11-regular leading-relaxed text-text-weak">{question().explanation}</p>
              </Show>
            </div>
          </Show>
          <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span class="text-10-regular text-text-weak">
              {Object.keys(checked()).length} of {props.component.questions.length} checked
            </span>
            <div class="flex flex-wrap items-center gap-2">
              <Show when={activeIndex() > 0}>
                <button
                  type="button"
                  class="rounded-lg border border-border-weak-base px-3 py-2 text-11-medium text-text-base hover:bg-background-base"
                  onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
                >
                  Back
                </button>
              </Show>
              <Show
                when={checked()[question().id]}
                fallback={
                  <button
                    type="button"
                    class="rounded-lg bg-text-strong px-4 py-2 text-11-semibold text-background-base disabled:opacity-40"
                    disabled={selected().length === 0}
                    onClick={check}
                  >
                    Check answer
                  </button>
                }
              >
                <button type="button" class="rounded-lg bg-text-strong px-4 py-2 text-11-semibold text-background-base" onClick={next}>
                  {activeIndex() === props.component.questions.length - 1 ? "See results" : "Next question"}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </section>
  )
}

export function RichUIDiagram(props: { component: ChatUIDiagramComponent }) {
  const [selectedID, setSelectedID] = createSignal(props.component.nodes[0]?.id ?? "")
  const selected = createMemo(() => props.component.nodes.find((node) => node.id === selectedID()) ?? props.component.nodes[0])
  const horizontal = props.component.direction === "left-right"
  const nodeWidth = 196
  const nodeHeight = 82
  const gap = 74
  const layout = createMemo(() => {
    const width = horizontal ? 36 + props.component.nodes.length * (nodeWidth + gap) : 330
    const height = horizontal ? 178 : 36 + props.component.nodes.length * (nodeHeight + gap)
    const positions = new Map<string, { x: number; y: number }>()
    props.component.nodes.forEach((node, index) => {
      positions.set(node.id, horizontal
        ? { x: 18 + index * (nodeWidth + gap), y: 48 }
        : { x: 67, y: 18 + index * (nodeHeight + gap) })
    })
    return { width, height, positions }
  })
  const center = (nodeID: string) => {
    const point = layout().positions.get(nodeID) ?? { x: 0, y: 0 }
    return horizontal
      ? { x: point.x + nodeWidth, y: point.y + nodeHeight / 2 }
      : { x: point.x + nodeWidth / 2, y: point.y + nodeHeight }
  }
  const target = (nodeID: string) => {
    const point = layout().positions.get(nodeID) ?? { x: 0, y: 0 }
    return horizontal
      ? { x: point.x, y: point.y + nodeHeight / 2 }
      : { x: point.x + nodeWidth / 2, y: point.y }
  }

  return (
    <section class="flex min-w-0 flex-col gap-3">
      <div class="min-w-0">
        <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
        <Show when={props.component.description}>
          <p class="mt-1 text-12-regular leading-relaxed text-text-weak">{props.component.description}</p>
        </Show>
      </div>
      <div class="max-w-full overflow-x-auto rounded-lg bg-background-base/60 p-2">
        <svg
          viewBox={`0 0 ${layout().width} ${layout().height}`}
          width={layout().width}
          height={layout().height}
          role="img"
          aria-label={props.component.title}
          class="block max-w-none"
        >
          <For each={props.component.edges}>
            {(edge) => {
              const start = center(edge.from)
              const end = target(edge.to)
              const midX = (start.x + end.x) / 2
              const midY = (start.y + end.y) / 2
              return (
                <g>
                  <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="currentColor" stroke-opacity="0.35" stroke-width="2" />
                  <path
                    d={horizontal
                      ? `M ${end.x - 8} ${end.y - 5} L ${end.x} ${end.y} L ${end.x - 8} ${end.y + 5}`
                      : `M ${end.x - 5} ${end.y - 8} L ${end.x} ${end.y} L ${end.x + 5} ${end.y - 8}`}
                    fill="none"
                    stroke="currentColor"
                    stroke-opacity="0.45"
                    stroke-width="2"
                  />
                  <Show when={edge.label}>
                    <text x={midX} y={midY - 8} text-anchor="middle" fill="currentColor" opacity="0.7" font-size="10">
                      {edge.label}
                    </text>
                  </Show>
                </g>
              )
            }}
          </For>
          <For each={props.component.nodes}>
            {(node) => {
              const position = () => layout().positions.get(node.id) ?? { x: 0, y: 0 }
              const active = () => selectedID() === node.id
              return (
                <g
                  transform={`translate(${position().x} ${position().y})`}
                  role="button"
                  tabindex="0"
                  aria-label={`Select ${node.label}`}
                  onClick={() => setSelectedID(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      setSelectedID(node.id)
                    }
                  }}
                  class="cursor-pointer outline-none"
                >
                  <rect
                    width={nodeWidth}
                    height={nodeHeight}
                    rx={node.kind === "start" || node.kind === "output" ? 24 : 12}
                    fill={active() ? "var(--background-stronger)" : "var(--background-base)"}
                    stroke="currentColor"
                    stroke-opacity={active() ? 0.8 : 0.25}
                    stroke-width={active() ? 2.5 : 1.2}
                  />
                  <text x={nodeWidth / 2} y={nodeHeight / 2 - 2} text-anchor="middle" fill="currentColor" font-size="13" font-weight="600">
                    {node.label.length > 25 ? node.label.slice(0, 23) + "…" : node.label}
                  </text>
                  <text x={nodeWidth / 2} y={nodeHeight / 2 + 19} text-anchor="middle" fill="currentColor" opacity="0.55" font-size="9">
                    {node.kind.toUpperCase()}
                  </text>
                </g>
              )
            }}
          </For>
        </svg>
      </div>
      <Show when={selected()}>
        {(node) => (
          <div class="border-l-2 border-text-strong/40 py-1 pl-3">
            <div class="text-12-semibold text-text-strong">{node().label}</div>
            <Show when={node().detail}>
              <p class="mt-1 text-11-regular leading-relaxed text-text-weak">{node().detail}</p>
            </Show>
            <p class="mt-1 text-9-medium uppercase tracking-wide text-text-weak">{node().kind}</p>
          </div>
        )}
      </Show>
      <div class="flex flex-wrap gap-1.5">
        <For each={props.component.nodes}>
          {(node) => (
            <button
              type="button"
              class="rounded-full border px-2.5 py-1 text-10-medium transition-colors"
              classList={{
                "border-border-base bg-background-base text-text-strong": selectedID() === node.id,
                "border-transparent text-text-weak hover:bg-background-base": selectedID() !== node.id,
              }}
              aria-pressed={selectedID() === node.id}
              onClick={() => setSelectedID(node.id)}
            >
              {node.label}
            </button>
          )}
        </For>
      </div>
    </section>
  )
}
