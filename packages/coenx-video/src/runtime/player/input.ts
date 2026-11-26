import type { VideoStage } from "../../model/types"
import { InteractiveEngine, type PlayerEvent } from "../../interactive/engine"

export interface InteractionBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PlayerInputOptions {
  wrapper: HTMLElement
  stageElement: Element
  canvas?: HTMLCanvasElement
  stage: VideoStage
  engine: InteractiveEngine
  /** Current node boxes (center coordinates) for hit-testing, updated per render. */
  interactionBoxes: () => Map<string, InteractionBox>
  dispatch: (event: PlayerEvent) => void
  unlockAudio: () => void
  pause: () => void
  isPlaying: () => boolean
  isDestroyed: () => boolean
}

const DRAG_THRESHOLD = 4

export function bindPlayerInput(options: PlayerInputOptions) {
  const { wrapper, stageElement, stage } = options

  // ----- Hover + drag state (declared before the listener closures) -----

  const hoverState = { last: undefined as string | undefined }

  const drag: {
    active: boolean
    targetId?: string
    grabOffset: { x: number; y: number }
    origin: { x: number; y: number }
    pointerId?: number
  } = { active: false, grabOffset: { x: 0, y: 0 }, origin: { x: 0, y: 0 } }

  const stagePoint = (event: PointerEvent | MouseEvent) => {
    const rect = stageElement.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * stage.width,
      y: ((event.clientY - rect.top) / rect.height) * stage.height,
    }
  }

  /** Top-most node whose box contains the stage point (or the SVG DOM hit). */
  const hitTest = (event: Event, point?: { x: number; y: number }) => {
    if (event.target instanceof Element) {
      const visual = event.target.closest("[data-coenx-node]")
      if (visual) return visual.getAttribute("data-coenx-node") ?? undefined
    }
    if (!point) return undefined
    return [...options.interactionBoxes().entries()]
      .reverse()
      .find(
        ([, box]) =>
          point.x >= box.x - box.width / 2 &&
          point.x <= box.x + box.width / 2 &&
          point.y >= box.y - box.height / 2 &&
          point.y <= box.y + box.height / 2,
      )?.[0]
  }

  const visibility = () => {
    if (document.hidden) options.pause()
    else if (!document.hidden) hoverState.last = undefined
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

  // ----- Hover (pointer move) -----

  const pointerMove = (event: PointerEvent) => {
    if (!options.isPlaying() || options.isDestroyed() || drag.active) return
    if (event.target instanceof HTMLElement && event.target.tagName === "INPUT") return
    const point = stagePoint(event)
    const targetId = hitTest(event, point)
    if (targetId === hoverState.last) return
    if (hoverState.last) options.dispatch({ type: "hover", targetId: hoverState.last, phase: "leave", x: point.x, y: point.y })
    if (targetId) options.dispatch({ type: "hover", targetId, phase: "enter", x: point.x, y: point.y })
    hoverState.last = targetId
  }

  // ----- Drag (pointer down/move/up with a movement threshold) -----

  const pointerDown = (event: PointerEvent) => {
    if (!options.isPlaying() || options.isDestroyed()) return
    if (event.target instanceof HTMLElement && (event.target.tagName === "INPUT" || event.target.tagName === "SELECT")) return
    const point = stagePoint(event)
    const targetId = hitTest(event, point)
    if (!targetId) return
    const box = options.interactionBoxes().get(targetId)
    drag.active = false
    drag.targetId = targetId
    drag.grabOffset = box ? { x: point.x - box.x, y: point.y - box.y } : { x: 0, y: 0 }
    drag.origin = { x: point.x, y: point.y }
    drag.pointerId = event.pointerId
  }

  const pointerDragMove = (event: PointerEvent) => {
    if (drag.targetId === undefined || event.pointerId !== drag.pointerId) return
    const point = stagePoint(event)
    if (!drag.active) {
      const moved = Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y)
      if (moved < DRAG_THRESHOLD) return
      drag.active = true
      options.dispatch({ type: "drag", targetId: drag.targetId, phase: "start", x: drag.origin.x, y: drag.origin.y })
    }
    options.dispatch({
      type: "drag",
      targetId: drag.targetId,
      phase: "move",
      x: point.x - drag.grabOffset.x,
      y: point.y - drag.grabOffset.y,
    })
  }

  const pointerUp = (event: PointerEvent) => {
    if (drag.targetId === undefined) return
    if (event.pointerId !== drag.pointerId) return
    if (drag.active) {
      const point = stagePoint(event)
      options.dispatch({
        type: "drag",
        targetId: drag.targetId,
        phase: "end",
        x: point.x - drag.grabOffset.x,
        y: point.y - drag.grabOffset.y,
      })
    }
    drag.active = false
    drag.targetId = undefined
    drag.pointerId = undefined
  }

  const click = (event: Event) => {
    if (drag.active || drag.targetId !== undefined) return
    if (!options.isPlaying() || options.isDestroyed()) return
    const point = event instanceof MouseEvent ? stagePoint(event) : undefined
    const targetId = hitTest(event, point)
    if (targetId) options.dispatch({ type: "click", targetId })
  }

  document.addEventListener("visibilitychange", visibility)
  window.addEventListener("keydown", keyboard)
  wrapper.addEventListener("pointerdown", options.unlockAudio, { once: true })
  stageElement.addEventListener("click", click)
  stageElement.addEventListener("pointerdown", pointerDown as EventListener)
  stageElement.addEventListener("pointermove", pointerMove as EventListener)
  stageElement.addEventListener("pointermove", pointerDragMove as EventListener)
  stageElement.addEventListener("pointerup", pointerUp as EventListener)
  stageElement.addEventListener("pointercancel", pointerUp as EventListener)
  return () => {
    document.removeEventListener("visibilitychange", visibility)
    window.removeEventListener("keydown", keyboard)
    wrapper.removeEventListener("pointerdown", options.unlockAudio)
    stageElement.removeEventListener("click", click)
    stageElement.removeEventListener("pointerdown", pointerDown as EventListener)
    stageElement.removeEventListener("pointermove", pointerMove as EventListener)
    stageElement.removeEventListener("pointermove", pointerDragMove as EventListener)
    stageElement.removeEventListener("pointerup", pointerUp as EventListener)
    stageElement.removeEventListener("pointercancel", pointerUp as EventListener)
  }
}
