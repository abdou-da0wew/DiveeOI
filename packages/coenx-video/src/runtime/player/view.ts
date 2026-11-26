import type { Scene, VideoStage } from "../../model/types"

export function applySceneTransition(
  stageElement: HTMLElement | SVGSVGElement,
  controlsRoot: HTMLElement,
  scene: Scene,
  localFrame: number,
) {
  const transition = scene.transition
  const progress = transition ? Math.max(0, Math.min(1, localFrame / Math.max(1, transition.durationFrames))) : 1
  let transform = "none"
  let opacity = "1"
  let clipPath = "none"
  if (transition) {
    switch (transition.type) {
      case "fade":
        opacity = String(progress)
        break
      case "slide-left":
        transform = `translateX(${(1 - progress) * 100}%)`
        break
      case "slide-right":
        transform = `translateX(${-((1 - progress) * 100)}%)`
        break
      case "zoom":
        transform = `scale(${0.82 + progress * 0.18})`
        break
      case "wipe-left":
        clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`
        break
      case "wipe-right":
        clipPath = `inset(0 0 0 ${(1 - progress) * 100}%)`
        break
      case "flip-3d":
        transform = `perspective(900px) rotateY(${(1 - progress) * -90}deg)`
        break
    }
  }
  // Dirty check: most interactive scenes run without a transition, so every
  // frame would otherwise rewrite 6 style properties x 2 elements and force
  // style recalc for no visual change. Transition progress changes each frame
  // by design, so the signature compare is exact, not rounded.
  const signature = `${transition?.type ?? ""}|${transform}|${opacity}|${clipPath}`
  if (lastTransitionSignature === signature) return
  lastTransitionSignature = signature
  for (const element of [stageElement, controlsRoot]) {
    element.style.transformOrigin = "50% 50%"
    element.style.transformStyle = "preserve-3d"
    element.style.backfaceVisibility = "hidden"
    element.style.transform = transform
    element.style.opacity = opacity
    element.style.clipPath = clipPath
  }
}

let lastTransitionSignature = ""

export function sizeCanvas(
  canvas: HTMLCanvasElement | undefined,
  wrapper: HTMLElement,
  stage: VideoStage,
  maxDevicePixelRatio: number,
  /** Pre-measured wrapper rect; skips the forced layout reflow when provided. */
  measuredRect?: { width: number; height: number },
) {
  if (!canvas) return
  const rect = measuredRect ?? wrapper.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, maxDevicePixelRatio)
  const width = Math.max(1, Math.floor(rect.width * dpr))
  const height = Math.max(1, Math.floor(rect.height * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const context = canvas.getContext("2d")
  context?.setTransform(width / stage.width, 0, 0, height / stage.height, 0, 0)
}
