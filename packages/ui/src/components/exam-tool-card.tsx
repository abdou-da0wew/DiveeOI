import type { ExamSpec } from "@diveeoi/db/chat-ui"
import { Show } from "solid-js"
import { Icon } from "./icon"

export function ExamToolCard(props: { exam: ExamSpec; sessionID?: string }) {
  const open = () => {
    if (typeof window === "undefined") return
    window.dispatchEvent(
      new CustomEvent("diveeoi:open-exam", {
        detail: { exam: props.exam, sessionID: props.sessionID },
      }),
    )
  }

  return (
    <section
      data-component="exam-tool-card"
      class="my-3 min-w-0 overflow-hidden rounded-2xl border border-border-weak-base bg-background-stronger"
    >
      <div class="flex items-start justify-between gap-4 border-b border-border-weak-base px-4 py-4">
        <div class="flex min-w-0 items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-base text-text-strong">
            <Icon name="book" size="large" />
          </div>
          <div class="min-w-0">
            <div class="text-14-semibold text-text-strong">{props.exam.title}</div>
            <p class="mt-1 text-12-regular text-text-weak">Your exam is ready</p>
          </div>
        </div>
        <span class="shrink-0 rounded-full border border-border-weak-base px-2.5 py-1 text-10-medium uppercase tracking-wide text-text-weak">
          Exam
        </span>
      </div>
      <div class="grid grid-cols-3 gap-2 px-4 py-3">
        <div class="rounded-lg bg-background-base px-3 py-2">
          <div class="text-10-medium uppercase tracking-wide text-text-weak">Questions</div>
          <div class="mt-1 text-18-semibold tabular-nums text-text-strong">{props.exam.questions.length}</div>
        </div>
        <div class="rounded-lg bg-background-base px-3 py-2">
          <div class="text-10-medium uppercase tracking-wide text-text-weak">Points</div>
          <div class="mt-1 text-18-semibold tabular-nums text-text-strong">{props.exam.totalPoints}</div>
        </div>
        <div class="rounded-lg bg-background-base px-3 py-2">
          <div class="text-10-medium uppercase tracking-wide text-text-weak">Time limit</div>
          <div class="mt-1 text-18-semibold tabular-nums text-text-strong">
            <Show when={props.exam.durationMinutes} fallback="None">
              {(minutes) => <>{minutes()}m</>}
            </Show>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between gap-3 px-4 pb-4">
        <span class="text-11-regular text-text-weak">Answers and completion time are sent back to your tutor.</span>
        <button
          type="button"
          class="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-text-strong px-3 text-12-semibold text-background-base transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-strong"
          onClick={open}
        >
          Open exam
          <Icon name="arrow-right" size="small" />
        </button>
      </div>
    </section>
  )
}
