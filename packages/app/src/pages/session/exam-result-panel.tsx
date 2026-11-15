import { For, Show } from "solid-js"
import type { ExamGrade, ExamSpec } from "@diveeoi/db/chat-ui"
import { Icon } from "@diveeoi/ui/icon"
import type { ExamTabEntry } from "./exam-tabs"
import { retryExam } from "./exam-tabs"

export function ExamResultPanel(props: { exam: ExamSpec; entry: ExamTabEntry; grade: ExamGrade; examID: string }) {
  const grade = () => props.grade
  return (
    <div class="mt-4 flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="rounded-lg bg-background-base p-3">
          <div class="text-10-medium uppercase text-text-weak">Score</div>
          <div class="mt-1 text-18-semibold tabular-nums text-text-strong">
            {grade().score}/{grade().maximum}
          </div>
        </div>
        <div class="rounded-lg bg-background-base p-3">
          <div class="text-10-medium uppercase text-text-weak">Percentage</div>
          <div class="mt-1 text-18-semibold tabular-nums text-text-strong">{grade().percentage}%</div>
        </div>
        <div class="rounded-lg bg-background-base p-3">
          <div class="text-10-medium uppercase text-text-weak">Attempt</div>
          <div class="mt-1 text-18-semibold tabular-nums text-text-strong">
            {grade().attemptNumber}/{grade().attemptsAllowed}
          </div>
        </div>
        <div class="rounded-lg bg-background-base p-3">
          <div class="text-10-medium uppercase text-text-weak">Review</div>
          <div class="mt-1 text-18-semibold tabular-nums text-text-strong">{grade().needsReviewCount}</div>
        </div>
      </div>
      <Show when={props.entry.analytics}>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="rounded-lg bg-background-base p-3">
            <div class="text-10-medium uppercase text-text-weak">Average</div>
            <div class="mt-1 text-15-semibold tabular-nums text-text-strong">
              {props.entry.analytics?.averagePercentage}%
            </div>
          </div>
          <div class="rounded-lg bg-background-base p-3">
            <div class="text-10-medium uppercase text-text-weak">Best attempt</div>
            <div class="mt-1 text-15-semibold tabular-nums text-text-strong">
              {props.entry.analytics?.bestPercentage}%
            </div>
          </div>
        </div>
      </Show>
      <div class="flex flex-col gap-2">
        <For each={grade().questionResults}>
          {(result, index) => (
            <div class="rounded-xl border border-border-weak-base bg-background-base p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-12-semibold text-text-strong">
                  Question {index() + 1} · {result.earned}/{result.maximum}
                </span>
                <span class="text-10-medium uppercase text-text-weak">{result.status}</span>
              </div>
              <p class="mt-1 text-11-regular text-text-weak">{result.feedback}</p>
              <Show when={result.explanation}>
                <p class="mt-2 text-11-regular leading-relaxed text-text-base">{result.explanation}</p>
              </Show>
              <Show when={result.correctOptionIDs?.length}>
                <p class="mt-2 text-11-regular text-text-weak">
                  Correct answer:{" "}
                  {result
                    .correctOptionIDs!.map(
                      (id) =>
                        props.exam.questions
                          .find((question) => question.id === result.questionId)
                          ?.options?.find((option) => option.id === id)?.label ?? id,
                    )
                    .join(", ")}
                </p>
              </Show>
              <Show when={result.criteria?.length}>
                <div class="mt-2 flex flex-col gap-1">
                  <For each={result.criteria}>
                    {(criterion) => (
                      <div class="flex justify-between gap-2 text-10-regular text-text-weak">
                        <span>{criterion.description}</span>
                        <span class="tabular-nums">
                          {criterion.earned}/{criterion.maximum}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
      <Show when={grade().needsReview}>
        <p class="text-11-regular text-icon-warning-base">
          This is a provisional score. Some written answers still need tutor review.
        </p>
      </Show>
      <Show when={grade().nextAttempt && grade().attemptsRemaining > 0}>
        <button
          type="button"
          class="inline-flex h-9 items-center justify-center gap-2 self-start rounded-lg bg-text-strong px-4 text-12-semibold text-background-base hover:opacity-85"
          onClick={() => retryExam(props.examID)}
        >
          Retry with {grade().nextAttempt!.questions.length} new questions
          <Icon name="arrow-right" size="small" />
        </button>
      </Show>
    </div>
  )
}
