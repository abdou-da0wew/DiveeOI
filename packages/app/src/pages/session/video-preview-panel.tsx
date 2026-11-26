// packages/app/src/pages/session/video-preview-panel.tsx
//
// Coenx Video preview - plays an exported MP4 (or any video file) from the
// session directory as a tab in the session tab strip, next to the exam tabs
// and the book viewer. Opened by the `diveeoi:open-video-preview` window
// event or automatically when the agent's `coenx_video_export` tool call
// completes (see video-side-tabs.tsx); FileTabContent (file-tabs.tsx) mounts
// this component for `video:<relative path>` tabs.
//
// Data comes from the standard file content endpoint (GET /file), which
// returns binary files as { type: "binary", content: base64, mimeType }.

import { createMemo, createResource, Show } from "solid-js"
import { IconButton } from "@diveeoi/ui/icon-button"
import { CoenxInteractivePanel } from "./coenx-interactive-panel"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

// Cache decoded data URLs per session-relative path: re-focusing the tab must
// not re-download the whole MP4 (a few MB of base64 on every open).
const videoDataCache = new Map<string, Promise<string>>()

const cachedVideoData = (path: string, load: () => Promise<string>) => {
  const hit = videoDataCache.get(path)
  if (hit) return hit
  const promise = load().catch((error) => {
    videoDataCache.delete(path)
    throw error
  })
  videoDataCache.set(path, promise)
  return promise
}

export function VideoPreviewPanel(props: {
  /** Session-directory-relative path of the video file. */
  path: string
  title?: string
  onClose?: () => void
}) {
  const language = useLanguage()
  const sdk = useSDK()

  const [source] = createResource(
    () => props.path,
    async (path) =>
      cachedVideoData(path, async () => {
        const response = await sdk().client.file.read({ path })
        const content = response.data as { type?: string; content?: string; mimeType?: string }
        if (content?.type !== "binary" || typeof content.content !== "string" || content.content.length === 0) {
          throw new Error("not-a-video-file")
        }
        const mime = content.mimeType?.startsWith("video/") ? content.mimeType : "video/mp4"
        return `data:${mime};base64,${content.content}`
      }),
  )

  const displayName = createMemo(() => props.title || props.path.split("/").pop() || props.path)
  const isInteractive = createMemo(() => /\.coenx4$/i.test(props.path))

  return (
    <div class="size-full flex flex-col min-w-0">
      <div class="h-9 shrink-0 flex items-center gap-1.5 pl-3 pr-2 border-b border-border-weaker-base">
        <svg viewBox="0 0 20 20" fill="none" class="w-3.5 h-3.5 text-text-weak" aria-hidden="true">
          <rect x="3" y="4.5" width="14" height="11" rx="1.75" stroke="currentColor" stroke-width="1.3" />
          <path d="M8.5 8.25 12 10l-3.5 1.75v-3.5Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
        </svg>
        <div class="text-12-regular text-text-weak truncate flex-1" title={props.path}>
          {displayName()}
        </div>
        <div class="text-11-regular text-text-weak truncate max-w-30 hidden md:inline" title={language.t(isInteractive() ? "video.interactive.hint" : "video.preview.hint")}>
          {language.t(isInteractive() ? "video.interactive.hint" : "video.preview.hint")}
        </div>
        <IconButton icon="close-small" variant="ghost" class="h-6 w-6" onClick={() => props.onClose?.()} aria-label={language.t("video.tab.close")} />
      </div>

      <Show
        when={!isInteractive()}
        fallback={<CoenxInteractivePanel path={props.path} title={props.title} onClose={props.onClose} />}
      >
        <Show
          when={!source.error}
          fallback={
            <div class="flex-1 flex items-center justify-center px-6 text-center text-12-regular text-text-weak">
              {language.t("video.preview.error")}
            </div>
          }
        >
          <Show
            when={source()}
            fallback={
              <div class="flex-1 flex items-center justify-center px-6 text-center text-12-regular text-text-weak">
                {language.t("video.preview.loading")}
              </div>
            }
          >
            <div class="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 bg-background-stronger p-3">
              <video
                class="max-h-full max-w-full rounded-sm shadow-sm bg-black"
                src={source()}
                controls
                autoplay
                loop
                playsinline
                aria-label={displayName()}
              />
              <div class="text-11-regular text-text-weak truncate max-w-full" title={props.path}>
                {props.path}
              </div>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
