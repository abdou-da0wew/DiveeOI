export * as ExamTabs from "./exam-tabs"

import { createStore } from "solid-js/store"
import type { ExamAnalytics, ExamGrade, ExamSpec } from "@diveeoi/db/chat-ui"

export type ExamAnswer = string | string[]
export type ExamStatus = "in-progress" | "submitted"
export type ExamPresentation = "normal" | "fill" | "fullscreen"
export type ExamReportStatus = "pending" | "sending" | "sent" | "error"

export type ExamTabEntry = {
  exam: ExamSpec
  sessionID: string
  startedAt: number
  answers: Record<string, ExamAnswer>
  questionState: Record<string, Record<string, string | number | boolean>>
  attemptNumber: number
  grade?: ExamGrade
  analytics?: ExamAnalytics
  status: ExamStatus
  presentation: ExamPresentation
  elapsedMs?: number
  submittedAt?: number
  reportStatus?: ExamReportStatus
}

const [store, setStore] = createStore<Record<string, ExamTabEntry>>({})

export const examTabs = () => store

export function hydrateExamTabs(entries: Record<string, ExamTabEntry>) {
  const restored = Object.fromEntries(
    Object.entries(entries).map(([id, entry]) => [
      id,
      {
        ...entry,
        questionState: entry.questionState ?? {},
        attemptNumber: entry.attemptNumber ?? 1,
        presentation: "normal" as const,
        reportStatus:
          entry.status === "submitted" && entry.reportStatus === "sending" ? ("pending" as const) : entry.reportStatus,
      },
    ]),
  )
  setStore({ ...store, ...restored })
}

export function restoreExam(exam: ExamSpec, sessionID: string, startedAt: number) {
  if (!sessionID || !exam.id || store[exam.id]) return
  setStore(exam.id, {
    exam,
    sessionID,
    startedAt,
    answers: {},
    questionState: {},
    attemptNumber: 1,
    status: "in-progress",
    presentation: "normal",
  })
}

export function registerExam(exam: ExamSpec, sessionID: string) {
  if (!sessionID || !exam.id || store[exam.id]) return
  setStore(exam.id, {
    exam,
    sessionID,
    startedAt: Date.now(),
    answers: {},
    questionState: {},
    attemptNumber: 1,
    status: "in-progress",
    presentation: "normal",
  })
}

export function updateExamAnswer(examID: string, questionID: string, answer: ExamAnswer) {
  const current = store[examID]
  if (!current || current.status !== "in-progress") return
  setStore(examID, "answers", questionID, Array.isArray(answer) ? [...answer] : answer)
}

export function updateExamQuestionState(
  examID: string,
  questionID: string,
  values: Record<string, string | number | boolean>,
) {
  const current = store[examID]
  if (!current || current.status !== "in-progress") return
  setStore(examID, "questionState", questionID, { ...values })
}

export function setExamPresentation(examID: string, presentation: ExamPresentation) {
  if (!store[examID]) return
  setStore(examID, "presentation", presentation)
}

export function submitExam(examID: string, submittedAt = Date.now()) {
  const current = store[examID]
  if (!current || current.status !== "in-progress") return
  setStore(examID, {
    ...current,
    status: "submitted",
    submittedAt,
    elapsedMs: Math.max(0, submittedAt - current.startedAt),
    reportStatus: "pending",
  })
}

export function applyExamGrade(examID: string, grade: ExamGrade, stats?: ExamAnalytics) {
  const current = store[examID]
  if (!current || current.status !== "submitted" || grade.examId !== examID) return
  if (grade.attemptNumber !== current.attemptNumber) return
  setStore(examID, "grade", grade)
  if (stats) setStore(examID, "analytics", stats)
  setStore(examID, "reportStatus", "sent")
}

export function retryExam(examID: string, now = Date.now()) {
  const current = store[examID]
  const next = current?.grade?.nextAttempt
  if (!current || current.status !== "submitted" || !next || current.grade?.attemptsRemaining === 0) return false
  setStore(examID, {
    ...current,
    exam: next,
    startedAt: now,
    submittedAt: undefined,
    elapsedMs: undefined,
    answers: {},
    questionState: {},
    attemptNumber: current.attemptNumber + 1,
    grade: undefined,
    analytics: undefined,
    status: "in-progress",
    reportStatus: undefined,
    presentation: "normal",
  })
  return true
}

export function setExamReportStatus(examID: string, status: ExamReportStatus) {
  if (!store[examID] || store[examID].status !== "submitted") return
  setStore(examID, "reportStatus", status)
}

export function examTimeRemaining(exam: ExamTabEntry, now = Date.now()) {
  if (!exam.exam.durationMinutes) return undefined
  const duration = exam.exam.durationMinutes * 60_000
  return Math.max(0, duration - (now - exam.startedAt))
}

export function formatExamDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}
