import { mountInteractivePlayer, type InteractivePlayerOptions } from "./player"
import type { VideoComposition } from "../model/types"

declare global {
  interface Window {
    CoenxVideo?: {
      mount: (
        element: HTMLElement,
        composition: VideoComposition,
        options?: InteractivePlayerOptions,
      ) => { destroy: () => void }
    }
  }
}

async function mountCompiledPlayer() {
  const element = document.querySelector<HTMLElement>("[data-coenx-player]")
  if (!element) return
  const compositionUrl = element.dataset.composition ?? "./composition.json"
  const response = await fetch(compositionUrl)
  if (!response.ok) throw new Error(`Failed to load interactive video composition: ${response.status}`)
  const composition = (await response.json()) as VideoComposition
  await document.fonts?.ready
  const handle = mountInteractivePlayer(element, composition, {
    autoplay: false,
    maxFps: 30,
    maxDevicePixelRatio: 1.5,
    renderer: element.dataset.renderer === "svg" ? "svg" : "canvas",
    onStateChange: (state) => {
      element.dispatchEvent(new CustomEvent("coenx:state", { detail: state, bubbles: true }))
    },
    onSceneChange: (sceneId) => {
      element.dispatchEvent(new CustomEvent("coenx:scenechange", { detail: { sceneId }, bubbles: true }))
    },
  })
  element.dispatchEvent(new CustomEvent("coenx:ready", { detail: { composition, handle } }))
  const play = document.querySelector<HTMLButtonElement>("[data-coenx-play]")
  const pause = document.querySelector<HTMLButtonElement>("[data-coenx-pause]")
  play?.addEventListener("click", () => handle.play())
  pause?.addEventListener("click", () => handle.pause())
  window.addEventListener("pagehide", () => handle.destroy(), { once: true })
  return handle
}

window.CoenxVideo = {
  mount(element, composition, options = {}) {
    return mountInteractivePlayer(element, composition, { autoplay: false, ...options })
  },
}

void mountCompiledPlayer().catch((error) => {
  const element = document.querySelector<HTMLElement>("[data-coenx-player]")
  if (element) {
    element.textContent = error instanceof Error ? error.message : String(error)
    element.setAttribute("role", "alert")
  }
})
