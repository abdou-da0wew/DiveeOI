// packages/app/src/pages/session/video-tabs.ts
//
// Coenx Video preview tabs - first-class tab support for the video renderer
// panel (video-preview-panel.tsx). A video tab id is `video:<relative path>`;
// it lives in the session tab store like any other tab (context/layout.tsx
// keeps non-`file://` ids untouched) and is rendered by FileTabContent
// (file-tabs.tsx), which mounts VideoPreviewPanel for tabs with this prefix.
//
// Trigger flow: when the agent's `coenx_video_export` tool call completes
// (watched by VideoSidePanelBridge in video-side-tabs.tsx) or anything
// dispatches the `diveeoi:open-video-preview` window event, the bridge opens
// (or focuses) the tab for the exported file, like the exam and book tabs.

import { createSignal } from "solid-js"

export interface OpenVideoDetail {
  /** Session-directory-relative path of the exported MP4 (or preview output). */
  path: string
  /** Optional display title (defaults to the file name). */
  title?: string
}

const [pendingVideoDetail, setPendingVideoDetail] = createSignal<OpenVideoDetail | null>(null)

export { pendingVideoDetail }

/** Drop the pending detail (e.g. once consumed by a video tab panel). */
export const clearPendingVideoDetail = () => setPendingVideoDetail(null)

/** Tab id for a video preview tab. */
export const tabForVideo = (path: string) => `video:${path}`

/** Video path behind a `video:` tab id; undefined for any other tab. */
export const videoPathFromTab = (tab: string) => (tab.startsWith("video:") ? tab.slice(6) : undefined)

/** Display title for a video tab (file name without directories). */
export const videoTabTitle = (path: string) => path.split("/").pop() || path

/**
 * Open (or focus) the tab for an exported video. Uses the raw tab-store API
 * (open + setActive) rather than createOpenSessionFileTab, which is
 * file-path specific; also raises the review panel so the tab strip is
 * visible (same behavior as exam tabs).
 */
export function openVideoTab(
  api: {
    open: (tab: string) => unknown | Promise<unknown>
    setActive: (tab: string) => void
  },
  detail: OpenVideoDetail,
) {
  if (!detail.path) return
  setPendingVideoDetail(detail)
  const tab = tabForVideo(detail.path)
  void api.open(tab)
  api.setActive(tab)
}
