import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Markdown } from "@diveeoi/ui/markdown"
import { RichUIRenderer } from "@diveeoi/ui/rich-ui"
import { useLanguage } from "@/context/language"
import type { ExamQuestion } from "@diveeoi/db/chat-ui"

export function QuestionCard(props: {
  question: ExamQuestion
  index: number
  answer?: string | string[]
  disabled: boolean
  onSingle: (optionID: string) => void
  onMultiple: (optionID: string, checked: boolean) => void
  onWritten: (value: string) => void
  questionState?: Record<string, string | number | boolean>
  onQuestionStateChange?: (values: Record<string, string | number | boolean>) => void
}) {
  const selected = (id: string) => (Array.isArray(props.answer) ? props.answer.includes(id) : props.answer === id)
  const components = createMemo(() => props.question.components)

  const language = useLanguage()
  return (
    <section class="min-w-0 rounded-2xl border border-border-weak-base bg-background-stronger p-4 sm:p-5">
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background-base text-11-semibold tabular-nums text-text-weak">
            {props.index}
          </div>
          <div class="min-w-0 pt-0.5">
            <div class="text-13-semibold leading-relaxed text-text-strong">
              <Markdown text={props.question.prompt} />
            </div>
            <div class="mt-1 text-10-regular uppercase tracking-wide text-text-weak">
              {props.question.type === "multiple"
                ? language.t("exam.type.multiple")
                : props.question.type === "short"
                  ? language.t("exam.type.short")
                  : props.question.type === "boolean"
                    ? language.t("exam.type.boolean")
                    : language.t("exam.type.single")}
            </div>
          </div>
        </div>
        <span class="shrink-0 rounded-md bg-background-base px-2 py-1 text-10-medium tabular-nums text-text-weak">
          {props.question.points === 1 ? language.t("exam.points.one", { points: props.question.points }) : language.t("exam.points.other", { points: props.question.points })}
        </span>
      </div>

      <Show when={components()?.length}>
        <div class="mt-4">
          <RichUIRenderer
            spec={{
              id: `exam-${props.question.id}`,
              version: 1,
              title: language.t("exam.interactiveMaterial"),
              layoutMode: "auto",
              layout: "stack",
              state: props.question.state,
              components: components()!,
            }}
            state={props.questionState}
            onStateChange={props.onQuestionStateChange}
            embedded
          />
        </div>
      </Show>

      <Switch>
        <Match when={props.question.type === "short"}>
          <textarea
            class="mt-4 min-h-28 w-full resize-y rounded-xl border border-border-weak-base bg-background-base px-3 py-3 text-13-regular leading-relaxed text-text-base outline-none transition-colors placeholder:text-text-weaker focus:border-border-base focus:ring-2 focus:ring-border-weak-base disabled:opacity-60"
            placeholder={language.t("exam.answer.placeholder")}
            value={typeof props.answer === "string" ? props.answer : ""}
            disabled={props.disabled}
            onInput={(event) => props.onWritten(event.currentTarget.value)}
            aria-label={language.t("exam.answer.aria", { index: props.index })}
          />
        </Match>
        <Match when={props.question.type === "single" || props.question.type === "boolean"}>
          <div class="mt-4 grid gap-2">
            <For each={props.question.options}>
              {(option) => (
                <label
                  class="flex cursor-pointer items-center gap-3 rounded-xl border border-border-weak-base bg-background-base px-3 py-3 transition-[background-color,border-color] hover:border-border-base hover:bg-background-stronger has-[:checked]:border-border-base has-[:checked]:bg-background-stronger"
                  classList={{ "opacity-60 cursor-not-allowed": props.disabled }}
                >
                  <input
                    type="radio"
                    name={`exam-${props.question.id}`}
                    value={option.id}
                    checked={selected(option.id)}
                    disabled={props.disabled}
                    onChange={() => props.onSingle(option.id)}
                    class="size-4 shrink-0 accent-current"
                  />
                  <span class="text-12-regular text-text-base">{option.label}</span>
                </label>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.question.type === "multiple"}>
          <div class="mt-4 grid gap-2">
            <For each={props.question.options}>
              {(option) => (
                <label
                  class="flex cursor-pointer items-center gap-3 rounded-xl border border-border-weak-base bg-background-base px-3 py-3 transition-[background-color,border-color] hover:border-border-base hover:bg-background-stronger has-[:checked]:border-border-base has-[:checked]:bg-background-stronger"
                  classList={{ "opacity-60 cursor-not-allowed": props.disabled }}
                >
                  <input
                    type="checkbox"
                    checked={selected(option.id)}
                    disabled={props.disabled}
                    onChange={(event) => props.onMultiple(option.id, event.currentTarget.checked)}
                    class="size-4 shrink-0 accent-current"
                  />
                  <span class="text-12-regular text-text-base">{option.label}</span>
                </label>
              )}
            </For>
          </div>
        </Match>
      </Switch>
      <Show when={props.answer && (Array.isArray(props.answer) ? props.answer.length : props.answer.trim().length > 0)}>
        <div class="mt-3 text-10-medium text-icon-success-base">Answer saved</div>
      </Show>
    </section>
  )
}
