import type { UserMessagePresentation } from "@diveeoi/ui/user-message-metadata"
import type { ExamTabEntry } from "./exam-tabs"
import { formatExamDuration } from "./exam-tabs"

export function buildExamSubmissionPresentation(entry: ExamTabEntry): UserMessagePresentation {
  const answered = entry.exam.questions.filter((question) => {
    const answer = entry.answers[question.id]
    return Array.isArray(answer) ? answer.length > 0 : typeof answer === "string" && answer.trim().length > 0
  }).length
  const attempt = entry.attemptNumber ?? 1
  return {
    kind: "exam-submission",
    label: "Exam submission",
    summary: `${entry.exam.title} · #${attempt} · ${answered}/${entry.exam.questions.length}`,
    metadata: {
      exam: entry.exam.title,
      attempt,
      questions: entry.exam.questions.length,
      answered,
    },
  }
}

export function buildExamSubmissionReport(entry: ExamTabEntry) {
  const exam = entry.exam
  const answers = exam.questions.map((question) => ({
    questionId: question.id,
    answer: entry.answers[question.id] ?? "",
  }))
  const answered = answers.filter((item) =>
    Array.isArray(item.answer) ? item.answer.length > 0 : item.answer.trim().length > 0,
  ).length

  const payload = {
    examID: exam.id,
    attemptNumber: entry.attemptNumber ?? 1,
    elapsedMs: entry.elapsedMs ?? 0,
    answers,
    interactiveState: entry.questionState ?? {},
  }

  return [
    `The student submitted exam "${exam.title}". This is attempt ${payload.attemptNumber}.`,
    `Elapsed time: ${formatExamDuration(payload.elapsedMs)}`,
    `Time limit: ${exam.durationMinutes ? `${exam.durationMinutes} minutes` : "None"}`,
    `Answered: ${answered}/${exam.questions.length}`,
    "",
    "Call the grade_exam tool now with this exact JSON payload. Do not attempt to grade the submission from memory. The server owns the private answer key and grading rubric.",
    "",
    JSON.stringify(payload),
  ].join("\n")
}
