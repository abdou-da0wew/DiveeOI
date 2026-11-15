import { createEffect, createMemo, createSignal, For, Show, onCleanup, onMount } from "solid-js"
import { Icon } from "@diveeoi/ui/icon"
import { QuestionCard } from "./exam-question"
import { ExamResultPanel } from "./exam-result-panel"
import {
  examTabs,
  examTimeRemaining,
  formatExamDuration,
  setExamPresentation,
  setExamReportStatus,
  submitExam,
  updateExamAnswer,
  updateExamQuestionState,
} from "./exam-tabs"

export function ExamWorkspace(props: { examID: string; overlay?: boolean }) {
  const entry = createMemo(() => examTabs()[props.examID])
  const [now, setNow] = createSignal(Date.now())
  const [confirming, setConfirming] = createSignal(false)
  const answered = createMemo(() => {
    const current = entry()
    if (!current) return 0
    return current.exam.questions.filter((question) => {
      const answer = current.answers[question.id]
      return Array.isArray(answer) ? answer.length > 0 : typeof answer === "string" && answer.trim().length > 0
    }).length
  })
  const remaining = createMemo(() => {
    const current = entry()
    if (!current) return
    return examTimeRemaining(current, now())
  })
  const elapsed = createMemo(() => {
    const current = entry()
    if (!current) return 0
    return current.elapsedMs ?? Math.max(0, now() - current.startedAt)
  })
  const active = createMemo(() => {
    const current = entry()
    if (!current) return false
    return props.overlay ? current.presentation !== "normal" : current.presentation === "normal"
  })

  const answer = (questionID: string) => entry()?.answers[questionID]
  const chooseSingle = (questionID: string, optionID: string) => updateExamAnswer(props.examID, questionID, optionID)
  const chooseMultiple = (questionID: string, optionID: string, checked: boolean) => {
    const current = answer(questionID)
    const selected = Array.isArray(current) ? current : []
    const next = checked ? [...new Set([...selected, optionID])] : selected.filter((value) => value !== optionID)
    updateExamAnswer(props.examID, questionID, next)
  }
  const setWritten = (questionID: string, value: string) => updateExamAnswer(props.examID, questionID, value)

  const exitPresentation = () => {
    setExamPresentation(props.examID, "normal")
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {})
    }
  }

  const enterFullscreen = () => {
    setExamPresentation(props.examID, "fullscreen")
    if (typeof document === "undefined") return
    const result = document.documentElement.requestFullscreen?.()
    if (result) void result.catch(() => {})
  }

  const requestSubmit = () => {
    if (confirming()) {
      submitExam(props.examID)
      setConfirming(false)
      return
    }
    setConfirming(true)
  }

  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    const fullscreenChange = () => {
      if (!document.fullscreenElement && entry()?.presentation === "fullscreen") {
        setExamPresentation(props.examID, "normal")
      }
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && entry()?.presentation === "fullscreen") {
        if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
        setExamPresentation(props.examID, "normal")
      }
    }
    document.addEventListener("fullscreenchange", fullscreenChange)
    window.addEventListener("keydown", keyDown)
    onCleanup(() => {
      window.clearInterval(timer)
      document.removeEventListener("fullscreenchange", fullscreenChange)
      window.removeEventListener("keydown", keyDown)
    })
  })

  createEffect(() => {
    const current = entry()
    if (!current || current.status !== "in-progress" || !current.exam.durationMinutes) return
    if ((remaining() ?? 1) <= 0) submitExam(props.examID)
  })

  return (
    <Show when={active() && entry()}>
      {(current) => {
        const exam = () => current().exam
        const submitted = () => current().status === "submitted"
        const presentation = () => current().presentation
        const remainingText = () => {
          if (submitted()) return formatExamDuration(elapsed())
          const value = remaining()
          return value === undefined ? formatExamDuration(elapsed()) : formatExamDuration(value)
        }
        const answeredLabel = () => `${answered()} / ${exam().questions.length} answered`

        return (
          <div
            data-component="exam-workspace"
            data-exam-id={props.examID}
            class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background-base"
            classList={{
              "h-full": !props.overlay,
              "absolute inset-0 z-50 h-full shadow-2xl": props.overlay && presentation() === "fill",
              "fixed inset-0 z-[10000] h-dvh w-screen": props.overlay && presentation() === "fullscreen",
            }}
          >
            <header class="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-weak-base bg-background-stronger px-4 py-3 sm:px-6">
              <div class="flex min-w-0 items-center gap-3">
                <div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background-base text-text-strong">
                  <Icon name="book" size="large" />
                </div>
                <div class="min-w-0">
                  <div class="truncate text-14-semibold text-text-strong">{exam().title}</div>
                  <div class="mt-0.5 text-11-regular text-text-weak">
                    {submitted() ? "Submission complete" : answeredLabel()}
                  </div>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <div
                  class="flex items-center gap-2 rounded-lg border border-border-weak-base bg-background-base px-3 py-2 font-mono text-12-medium tabular-nums text-text-strong"
                  classList={{
                    "text-icon-warning-base": !submitted() && remaining() !== undefined && (remaining() ?? 0) <= 60_000,
                  }}
                  aria-live="off"
                >
                  <Icon name="status" size="small" />
                  <span>{remainingText()}</span>
                  <span class="font-sans text-10-regular text-text-weak">
                    {submitted() || !exam().durationMinutes ? "elapsed" : "left"}
                  </span>
                </div>
                <Show when={presentation() !== "normal"}>
                  <button
                    type="button"
                    class="inline-flex h-9 items-center gap-2 rounded-lg border border-border-weak-base bg-background-stronger px-3 text-12-medium text-text-strong hover:bg-background-base"
                    onClick={exitPresentation}
                  >
                    <Icon name="collapse" size="small" />
                    Exit {presentation() === "fill" ? "fill tab" : "full screen"}
                  </button>
                </Show>
                <Show when={!submitted() && presentation() === "normal"}>
                  <button
                    type="button"
                    class="inline-flex h-9 items-center gap-2 rounded-lg border border-border-weak-base bg-background-stronger px-3 text-12-medium text-text-strong hover:bg-background-base"
                    onClick={() => setExamPresentation(props.examID, "fill")}
                    aria-label="Fill tab"
                    title="Fill tab"
                  >
                    <Icon name="layout-right-full" size="small" />
                    <span class="hidden sm:inline">Fill tab</span>
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-9 items-center gap-2 rounded-lg border border-border-weak-base bg-background-stronger px-3 text-12-medium text-text-strong hover:bg-background-base"
                    onClick={enterFullscreen}
                    aria-label="Full screen"
                    title="Full screen"
                  >
                    <Icon name="expand" size="small" />
                    <span class="hidden sm:inline">Full screen</span>
                  </button>
                </Show>
              </div>
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <div class="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-5 sm:px-8 sm:py-7">
                <Show when={exam().instructions}>
                  <div class="rounded-xl border border-border-weak-base bg-background-stronger px-4 py-3 text-12-regular leading-relaxed text-text-weak">
                    {exam().instructions}
                  </div>
                </Show>

                <Show
                  when={!submitted()}
                  fallback={
                    <div class="rounded-2xl border border-icon-success-base/30 bg-icon-success-base/5 p-5">
                      <div class="flex items-center gap-2 text-14-semibold text-text-strong">
                        <Icon name="check" size="large" />
                        Exam submitted
                      </div>
                      <p class="mt-2 text-12-regular leading-relaxed text-text-weak">
                        You answered {answered()} of {exam().questions.length} questions in{" "}
                        {formatExamDuration(current().elapsedMs ?? 0)}.{" "}
                        {current().grade
                          ? `Attempt ${current().grade?.attemptNumber} scored ${current().grade?.score}/${current().grade?.maximum} (${current().grade?.percentage}%).`
                          : "Your answers are being graded by the server."}
                      </p>
                      <Show when={current().reportStatus === "error"}>
                        <div class="mt-3 flex flex-wrap items-center gap-3">
                          <span class="text-11-regular text-icon-warning-base">
                            The submission could not be sent to the conversation.
                          </span>
                          <button
                            type="button"
                            class="h-8 rounded-lg border border-border-weak-base px-3 text-11-medium text-text-strong hover:bg-background-base"
                            onClick={() => setExamReportStatus(props.examID, "pending")}
                          >
                            Retry sending
                          </button>
                        </div>
                      </Show>
                      <Show when={current().grade}>
                        {(grade) => (
                          <ExamResultPanel exam={exam()} entry={current()} grade={grade()} examID={props.examID} />
                        )}
                      </Show>
                      <Show when={current().reportStatus === "sent" && !current().grade}>
                        <div class="mt-3 text-11-medium text-icon-success-base">Submission processed</div>
                      </Show>
                    </div>
                  }
                >
                  <For each={exam().questions}>
                    {(question, index) => (
                      <QuestionCard
                        question={question}
                        index={index() + 1}
                        answer={answer(question.id)}
                        questionState={current().questionState?.[question.id]}
                        onQuestionStateChange={(values) => updateExamQuestionState(props.examID, question.id, values)}
                        disabled={submitted()}
                        onSingle={(optionID) => chooseSingle(question.id, optionID)}
                        onMultiple={(optionID, checked) => chooseMultiple(question.id, optionID, checked)}
                        onWritten={(value) => setWritten(question.id, value)}
                      />
                    )}
                  </For>
                </Show>
              </div>
            </div>

            <Show when={!submitted()}>
              <footer class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-weak-base bg-background-stronger px-4 py-3 sm:px-6">
                <div class="text-11-regular text-text-weak">
                  {answered()} of {exam().questions.length} answered · {exam().totalPoints} points
                </div>
                <div class="flex items-center gap-2">
                  <Show when={confirming()}>
                    <button
                      type="button"
                      class="h-9 rounded-lg border border-border-weak-base px-3 text-12-medium text-text-weak hover:bg-background-base"
                      onClick={() => setConfirming(false)}
                    >
                      Keep working
                    </button>
                    <span class="hidden text-11-regular text-text-weak sm:inline">Submit your answers now?</span>
                  </Show>
                  <button
                    type="button"
                    class="inline-flex h-9 items-center gap-2 rounded-lg bg-text-strong px-4 text-12-semibold text-background-base transition-opacity hover:opacity-85"
                    onClick={requestSubmit}
                  >
                    <Icon name="arrow-up" size="small" />
                    {confirming() ? "Confirm submit" : "Submit exam"}
                  </button>
                </div>
              </footer>
            </Show>
          </div>
        )
      }}
    </Show>
  )
}
