import { mountInteractivePlayer, type InteractivePlayerHandle } from "../runtime/player"
import type { VideoComposition } from "../model/types"

declare global {
  interface Window {
    __COENX_COMPOSITION__?: VideoComposition
  }
}

/**
 * Standalone player entry for .coenx4 containers: the composition is embedded
 * inline on the page (window.__COENX_COMPOSITION__), so the file plays with
 * zero network access, even opened straight from disk.
 */
async function mountStandalonePlayer() {
  const element = document.querySelector<HTMLElement>("[data-coenx-player]")
  const composition = window.__COENX_COMPOSITION__
  if (!element || !composition) return
  await document.fonts?.ready
  let handle: InteractivePlayerHandle
  try {
    handle = mountInteractivePlayer(element, composition, {
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
  } catch (error) {
    element.textContent = error instanceof Error ? error.message : String(error)
    element.setAttribute("role", "alert")
    return
  }
  element.dispatchEvent(new CustomEvent("coenx:ready", { detail: { composition, handle } }))
  const play = document.querySelector<HTMLButtonElement>("[data-coenx-play]")
  const pause = document.querySelector<HTMLButtonElement>("[data-coenx-pause]")
  play?.addEventListener("click", () => handle.play())
  pause?.addEventListener("click", () => handle.pause())
  window.addEventListener("pagehide", () => handle.destroy(), { once: true })
  window.CoenxVideo = {
    mount: (target, targetComposition) => mountInteractivePlayer(target, targetComposition, { autoplay: false }),
  }
}

void mountStandalonePlayer()
