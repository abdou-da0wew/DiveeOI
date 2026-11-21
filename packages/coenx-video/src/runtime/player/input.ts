import type { VideoStage } from "../../model/types"
import { InteractiveEngine, type PlayerEvent } from "../../interactive/engine"

export interface PlayerInputOptions {
  wrapper: HTMLElement
  stageElement: Element
  canvas?: HTMLCanvasElement
  stage: VideoStage
  engine: InteractiveEngine
  dispatch: (event: PlayerEvent) => void
  unlockAudio: () => void
  pause: () => void
  isPlaying: () => boolean
  isDestroyed: () => boolean
}

export function bindPlayerInput(options: PlayerInputOptions) {
  const { wrapper, stageElement, canvas, stage, engine } = options
  const visibility = () => {
    if (document.hidden) options.pause()
  }
  const keyboard = (event: KeyboardEvent) => {
    if (
      !options.isPlaying() ||
      options.isDestroyed() ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return
    }
    options.dispatch({ type: "key", key: event.key })
  }
  const click = (event: Event) => {
    const pointer = event as MouseEvent
    if (!(event.target instanceof Element)) return
    const visual = event.target.closest("[data-coenx-node]")
    if (visual) {
      const targetId = visual.getAttribute("data-coenx-node")
      if (targetId) options.dispatch({ type: "click", targetId })
      return
    }
    if (!canvas) return
    const rect = stageElement.getBoundingClientRect()
    const x = ((pointer.clientX - rect.left) / rect.width) * stage.width
    const y = ((pointer.clientY - rect.top) / rect.height) * stage.height
    const node = [...engine.currentScene.nodes]
      .reverse()
      .find(
        (item) =>
          item.visible !== false &&
          !engine.hiddenNodes.has(item.id) &&
          x >= item.x - item.width / 2 &&
          x <= item.x + item.width / 2 &&
          y >= item.y - item.height / 2 &&
          y <= item.y + item.height / 2,
      )
    if (node) options.dispatch({ type: "click", targetId: node.id })
  }

  document.addEventListener("visibilitychange", visibility)
  window.addEventListener("keydown", keyboard)
  wrapper.addEventListener("pointerdown", options.unlockAudio, { once: true })
  stageElement.addEventListener("click", click)
  return () => {
    document.removeEventListener("visibilitychange", visibility)
    window.removeEventListener("keydown", keyboard)
    wrapper.removeEventListener("pointerdown", options.unlockAudio)
    stageElement.removeEventListener("click", click)
  }
}
