// packages/app/src/pages/session/coenx-interactive-panel.tsx
//
// Interactive Coenx Video viewer - plays a .coenx4 container (packed by
// coenx_video_pack or coenx_video_lesson) inside the session tab strip using
// the bundled runtime player: live canvas rendering, click/hover/drag input,
// state-driven interactions and physics. The container is fetched through the
// standard file endpoint (GET /file, binary base64) and unpacked in the
// browser with DecompressionStream - no server-side player needed.

import { createEffect, createMemo, createResource, createSignal, on, onCleanup, Show } from "solid-js"
import { IconButton } from "@diveeoi/ui/icon-button"
import { mountInteractivePlayer, type InteractivePlayerHandle } from "@diveeoi/coenx-video/runtime"
import { readCoenxBrowser } from "@diveeoi/coenx-video/container-browser"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

const base64ToBytes = (base64: string) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function CoenxInteractivePanel(props: {
  /** Session-directory-relative path of the .coenx4 container. */
  path: string
  title?: string
  onClose?: () => void
}) {
  const language = useLanguage()
  const sdk = useSDK()
  let container: HTMLDivElement | undefined
  // Playback controls: the player mounts paused, so the header exposes
  // play/pause/restart bound to the mounted player handle. Without these the
  // world stays on its first frame and live physics never steps.
  const [player, setPlayer] = createSignal<InteractivePlayerHandle>()
  const [playing, setPlaying] = createSignal(false)

  const togglePlayback = () => {
    const handle = player()
    if (!handle) return
    if (playing()) {
      handle.pause()
      setPlaying(false)
    } else {
      handle.play()
      setPlaying(true)
    }
  }

  const restartPlayback = () => {
    const handle = player()
    if (!handle) return
    handle.seek(0)
    handle.play()
    setPlaying(true)
  }

  const [source] = createResource(
    () => props.path,
    async (path) => {
      const response = await sdk().client.file.read({ path })
      const content = response.data as { type?: string; content?: string; mimeType?: string }
      if (content?.type !== "binary" || typeof content.content !== "string" || content.content.length === 0) {
        throw new Error("not-a-container-file")
      }
      return readCoenxBrowser(base64ToBytes(content.content))
    },
  )

  const displayName = createMemo(() => props.title || props.path.split("/").pop() || props.path)

  // Mount the runtime player once the composition arrives; destroy on change.
  createEffect(
    on(
      () => source.latest?.composition,
      (composition) => {
        if (!composition || !container) return
        container.replaceChildren()
        let handle: InteractivePlayerHandle | undefined
        try {
          handle = mountInteractivePlayer(container, composition, {
            autoplay: false,
            maxFps: 30,
            maxDevicePixelRatio: 1.5,
            onEvent: (event) => {
              // Application events (tl:answer:*, world events) surface as DOM
              // events for host integrations; the player already bubbles
              // coenx:event on the stage wrapper.
              void event
            },
          })
        } catch (error) {
          container.textContent = error instanceof Error ? error.message : String(error)
          return
        }
        setPlayer(handle)
        setPlaying(false)
        onCleanup(() => {
          handle?.destroy()
          setPlayer(undefined)
        })
      },
    ),
  )

  return (
    <div class="size-full flex flex-col min-w-0">
      <div class="h-9 shrink-0 flex items-center gap-1.5 pl-3 pr-2 border-b border-border-weaker-base">
        <svg viewBox="0 0 20 20" fill="none" class="w-3.5 h-3.5 text-text-weak" aria-hidden="true">
          <rect x="3" y="4.5" width="14" height="11" rx="1.75" stroke="currentColor" stroke-width="1.3" />
          <path d="M6 12.5v-5l4 2.5-4 2.5Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
          <circle cx="13.5" cy="13" r="1.4" fill="currentColor" />
        </svg>
        <div class="text-12-regular text-text-weak truncate flex-1" title={props.path}>
          {displayName()}
        </div>
        <div class="text-11-regular text-text-weak truncate max-w-40 hidden md:inline" title={language.t("video.interactive.hint")}>
          {language.t("video.interactive.hint")}
        </div>
        <Show when={player()}>
          <IconButton
            icon="reset"
            variant="ghost"
            class="h-6 w-6"
            onClick={restartPlayback}
            aria-label={language.t("video.interactive.restart")}
            title={language.t("video.interactive.restart")}
          />
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center text-text-weak hover:text-text-base"
            onClick={togglePlayback}
            aria-label={playing() ? language.t("video.interactive.pause") : language.t("video.interactive.play")}
            title={playing() ? language.t("video.interactive.pause") : language.t("video.interactive.play")}
          >
            <svg viewBox="0 0 20 20" fill="none" class="h-3.5 w-3.5" aria-hidden="true">
              <Show
                when={playing()}
                fallback={
                  <path d="M6.5 4.5L15 10L6.5 15.5V4.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
                }
              >
                <rect x="6" y="4.5" width="2.6" height="11" fill="currentColor" />
                <rect x="11.4" y="4.5" width="2.6" height="11" fill="currentColor" />
              </Show>
            </svg>
          </button>
        </Show>
        <IconButton icon="close-small" variant="ghost" class="h-6 w-6" onClick={() => props.onClose?.()} aria-label={language.t("video.tab.close")} />
      </div>

      <Show
        when={!source.error}
        fallback={
          <div class="flex-1 flex items-center justify-center px-6 text-center text-12-regular text-text-weak">
            {language.t("video.interactive.error")}
          </div>
        }
      >
        <Show
          when={source()}
          fallback={
            <div class="flex-1 flex items-center justify-center px-6 text-center text-12-regular text-text-weak">
              {language.t("video.interactive.loading")}
            </div>
          }
        >
          <div class="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 bg-background-stronger p-3">
            <div class="w-full max-w-200 min-h-0" ref={container} />
            <div class="text-11-regular text-text-weak truncate max-w-full" title={props.path}>
              {props.path}
            </div>
          </div>
        </Show>
      </Show>
    </div>
  )
}
