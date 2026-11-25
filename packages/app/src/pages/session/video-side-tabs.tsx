// packages/app/src/pages/session/video-side-tabs.tsx
//
// Side-panel bridge for Coenx Video preview tabs. Watches the active
// session's tool parts and opens a `video:<path>` tab in the session tab
// strip when the agent's `coenx_video_export` call completes (same pattern
// as the exam tabs in exam-side-tabs.tsx). Also listens for the manual
// `diveeoi:open-video-preview` window event so previews can be triggered
// from anywhere in the app.

import { createEffect, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { openVideoTab, tabForVideo, type OpenVideoDetail } from "@/pages/session/video-tabs"

type ToolPartLike = {
  type?: string
  tool?: string
  state?: { status?: string; metadata?: unknown }
}

/** Extracts the exported relative path from a completed export tool part. */
function exportedPathFromMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return
  const record = metadata as Record<string, unknown>
  const candidate = record.outputPath
  if (typeof candidate !== "string" || !candidate.trim()) return
  return candidate
}

export function VideoSidePanelBridge() {
  const params = useParams()
  const { tabs, view } = useSessionLayout()
  const sync = useSync()

  const openDetail = (detail: OpenVideoDetail, sessionID: string | undefined) => {
    if (!sessionID || sessionID !== params.id) return
    view().reviewPanel.open()
    openVideoTab(
      { open: (tab) => tabs().open(tab), setActive: (tab) => tabs().setActive(tab) },
      detail,
    )
  }

  createEffect(() => {
    const manual = (event: Event) => {
      const detail = (event as CustomEvent<OpenVideoDetail>).detail
      if (!detail?.path) return
      openDetail(detail, params.id)
    }
    window.addEventListener("diveeoi:open-video-preview", manual)
    onCleanup(() => window.removeEventListener("diveeoi:open-video-preview", manual))
  })

  // Watch the session message stream for completed coenx_video_export calls.
  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return
    const messages = sync().data.message[sessionID] ?? []
    for (const message of messages) {
      const parts = sync().data.part[message.id] ?? []
      for (const part of parts as ToolPartLike[]) {
        if (part.type !== "tool" || part.tool !== "coenx_video_export" || part.state?.status !== "completed") continue
        const path = exportedPathFromMetadata(part.state.metadata)
        if (!path) continue
        const tab = tabForVideo(path)
        // Only auto-open the first time per export file per session: once the
        // tab exists, completing calls must not steal focus.
        if (tabs().all().includes(tab)) continue
        openDetail({ path }, sessionID)
      }
    }
  })

  return null
}
