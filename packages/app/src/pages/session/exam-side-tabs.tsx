import { Identifier } from "@/utils/id"
import { createEffect, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { parseExamDraft } from "@diveeoi/db/exam-parse"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { sendFollowupDraft } from "@/components/prompt-input/submit"
import { showToast } from "@/utils/toast"
import { Persist, persisted } from "@/utils/persist"
import {
  examTabs,
  hydrateExamTabs,
  applyExamGrade,
  registerExam,
  restoreExam,
  setExamPresentation,
  setExamReportStatus,
  type ExamTabEntry,
} from "./exam-tabs"
import { buildExamSubmissionPresentation, buildExamSubmissionReport } from "./exam-report"
import { buildRichUISubmit } from "./rich-ui-submit"

type OpenExamDetail = {
  exam: unknown
  sessionID?: string
}

function ExamTabPersistence(props: { sessionID: string }) {
  const sdk = useSDK()
  const server = useServer()
  const sync = useSync()
  const [saved, setSaved, , ready] = persisted(
    Persist.serverSession(server.scope(), sdk().directory, props.sessionID, "exam-attempts"),
    createStore({ entries: {} as Record<string, ExamTabEntry> }),
  )

  createEffect(() => {
    const messages = sync().data.message[props.sessionID] ?? []
    for (const message of messages) {
      const parts = sync().data.part[message.id] ?? []
      for (const part of parts) {
        if (part.type !== "tool" || part.tool !== "create_exam" || part.state.status !== "completed") continue
        const metadata = part.state.metadata
        const raw = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).exam : undefined
        if (!raw || typeof raw !== "object" || !("id" in raw)) continue
        const id = typeof raw.id === "string" ? raw.id : ""
        if (!id) continue
        const parsed = parseExamDraft(raw, id, Math.random, { randomize: false })
        if (!parsed.ok) continue
        restoreExam(parsed.value, props.sessionID, message.time.created)
      }
    }
  })

  createEffect(() => {
    if (!ready()) return
    const entries = saved.entries
    if (Object.keys(entries).length) hydrateExamTabs(entries)
  })

  createEffect(() => {
    if (!ready()) return
    const snapshot = Object.fromEntries(
      Object.entries(examTabs()).filter(([, entry]) => entry.sessionID === props.sessionID),
    ) as Record<string, ExamTabEntry>
    const serialized = JSON.parse(JSON.stringify(snapshot)) as Record<string, ExamTabEntry>
    const timer = window.setTimeout(() => setSaved("entries", serialized), 250)
    onCleanup(() => window.clearTimeout(timer))
  })

  return null
}

export function ExamSidePanelBridge() {
  const params = useParams()
  const { tabs, view } = useSessionLayout()
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const richUISubmissions = new Set<string>()

  createEffect(() => {
    const submitRichUI = (event: Event) => {
      const submission = buildRichUISubmit((event as CustomEvent<unknown>).detail)
      if (!submission || submission.sessionID !== params.id) return
      const { sessionID, specID, prompt: promptText, files } = submission

      const key = `${sessionID}:${specID}`
      if (richUISubmissions.has(key)) return
      richUISubmissions.add(key)

      const session = sync().data.session.find((item) => item.id === sessionID)
      const model = session?.model
      if (!session || !model) {
        richUISubmissions.delete(key)
        showToast({
          title: "Could not submit form",
          description: "The active session model could not be resolved.",
        })
        return
      }

      void (async () => {
        const attachments = await Promise.all(
          files.map(async ({ file }) => {
            const bytes = new Uint8Array(await file.arrayBuffer())
            let binary = ""
            const chunkSize = 0x8000
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
              binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
            }
            return {
              type: "image" as const,
              id: Identifier.ascending("part"),
              filename: file.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 180) || "attachment",
              mime: file.type,
              dataUrl: `data:${file.type};base64,${btoa(binary)}`,
            }
          }),
        )
        const prompt = [
          { type: "text" as const, content: promptText, start: 0, end: promptText.length },
          ...attachments,
        ]
        return sendFollowupDraft({
          client: sdk().client,
          sync: sync(),
          serverSync: serverSync(),
          optimisticBusy: true,
          draft: {
            sessionID,
            sessionDirectory: session.directory,
            prompt,
            context: [],
            agent: session.agent ?? "build",
            model: { providerID: model.providerID, modelID: model.id },
            variant: model.variant,
            presentation: submission.presentation,
          },
        })
      })().then(
        (sent) => {
          if (!sent) richUISubmissions.delete(key)
          else {
            richUISubmissions.delete(key)
            showToast({
              title: "Form submitted",
              description: "The agent received the values and will use its normal tool permissions.",
            })
          }
        },
        (error: unknown) => {
          richUISubmissions.delete(key)
          showToast({
            title: "Could not submit form",
            description:
              error instanceof Error ? error.message : "The conversation could not receive the submitted values.",
          })
        },
      )
    }

    window.addEventListener("diveeoi:submit-rich-ui", submitRichUI)
    onCleanup(() => window.removeEventListener("diveeoi:submit-rich-ui", submitRichUI))
  })

  createEffect(() => {
    const openExam = (event: Event) => {
      const detail = (event as CustomEvent<OpenExamDetail>).detail
      const sessionID = detail?.sessionID ?? params.id
      if (!sessionID || sessionID !== params.id) return
      const raw = detail.exam
      if (!raw || typeof raw !== "object" || !("id" in raw)) return
      const id = typeof raw.id === "string" ? raw.id : ""
      if (!id) return
      const parsed = parseExamDraft(raw, id, Math.random, { randomize: false })
      if (!parsed.ok) return

      registerExam(parsed.value, sessionID)
      setExamPresentation(id, "normal")
      view().reviewPanel.open()
      void tabs().open(`exam:${id}`)
      tabs().setActive(`exam:${id}`)
    }

    window.addEventListener("diveeoi:open-exam", openExam)
    onCleanup(() => window.removeEventListener("diveeoi:open-exam", openExam))
  })

  createEffect(() => {
    const activeSessionID = params.id
    if (!activeSessionID) return
    const messages = sync().data.message[activeSessionID] ?? []
    for (const message of messages) {
      const parts = sync().data.part[message.id] ?? []
      for (const part of parts) {
        if (
          part.type !== "tool" ||
          (part.tool !== "grade_exam" && part.tool !== "review_exam") ||
          part.state.status !== "completed"
        )
          continue
        const metadata = part.state.metadata
        if (!metadata || typeof metadata !== "object") continue
        const grade = (metadata as Record<string, unknown>).examGrade
        if (!grade || typeof grade !== "object" || !("examId" in grade) || !("attemptNumber" in grade)) continue
        const examID = typeof grade.examId === "string" ? grade.examId : ""
        const stats = (metadata as Record<string, unknown>).analytics
        if (!examID) continue
        applyExamGrade(
          examID,
          grade as import("@diveeoi/db/chat-ui").ExamGrade,
          stats && typeof stats === "object" ? (stats as import("@diveeoi/db/chat-ui").ExamAnalytics) : undefined,
        )
      }
    }
  })

  createEffect(() => {
    const pending = Object.values(examTabs()).filter(
      (entry) => entry.sessionID === params.id && entry.status === "submitted" && entry.reportStatus === "pending",
    )

    for (const entry of pending) {
      setExamReportStatus(entry.exam.id, "sending")
      const session = sync().data.session.find((item) => item.id === entry.sessionID)
      const model = session?.model
      if (!session || !model) {
        setExamReportStatus(entry.exam.id, "error")
        showToast({
          title: "Exam submitted",
          description: "The exam was saved, but the active session model could not be resolved to send your answers.",
        })
        continue
      }

      const report = buildExamSubmissionReport(entry)
      const prompt = [{ type: "text" as const, content: report, start: 0, end: report.length }]
      void sendFollowupDraft({
        client: sdk().client,
        sync: sync(),
        serverSync: serverSync(),
        optimisticBusy: true,
        draft: {
          sessionID: entry.sessionID,
          sessionDirectory: session.directory,
          prompt,
          context: [],
          agent: session.agent ?? "build",
          model: { providerID: model.providerID, modelID: model.id },
          variant: model.variant,
          presentation: buildExamSubmissionPresentation(entry),
        },
      }).then(
        () => setExamReportStatus(entry.exam.id, "sent"),
        (error: unknown) => {
          setExamReportStatus(entry.exam.id, "error")
          showToast({
            title: "Could not send exam results",
            description: error instanceof Error ? error.message : "The conversation could not receive the exam report.",
          })
        },
      )
    }
  })

  return (
    <Show when={params.id} keyed>
      {(sessionID) => <ExamTabPersistence sessionID={sessionID} />}
    </Show>
  )
}

export { ExamTabTriggers, ExamTabContents, ExamTabOverlay } from "./exam-tab-views"
