import type { Keyframe, Scene, VideoComposition, VisualNode } from "../model/types"

export function ease(value: number, mode: Keyframe["easing"] = "linear") {
  const t = Math.max(0, Math.min(1, value))
  if (mode === "step") return t < 1 ? 0 : 1
  if (mode === "ease-in") return t * t
  if (mode === "ease-out") return 1 - (1 - t) * (1 - t)
  if (mode === "ease-in-out") return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  return t
}

export function sampleKeyframes(keyframes: Keyframe[], frame: number): Keyframe["value"] | undefined {
  if (keyframes.length === 0) return undefined
  if (frame <= keyframes[0].frame) return keyframes[0].value
  const last = keyframes[keyframes.length - 1]
  if (frame >= last.frame) return last.value
  for (let index = 1; index < keyframes.length; index++) {
    const right = keyframes[index]
    const left = keyframes[index - 1]
    if (frame > right.frame) continue
    const amount = ease((frame - left.frame) / Math.max(1, right.frame - left.frame), left.easing)
    if (typeof left.value === "number" && typeof right.value === "number")
      return left.value + (right.value - left.value) * amount
    return amount < 1 ? left.value : right.value
  }
  return last.value
}

function setVectorComponent(
  target: Record<string, unknown>,
  key: "position" | "rotation3d" | "scale3d",
  index: number,
  value: number,
) {
  const current = (target[key] as [number, number, number] | undefined) ?? (key === "scale3d" ? [1, 1, 1] : [0, 0, 0])
  const next: [number, number, number] = [...current]
  next[index] = value
  target[key] = next
}

export function evaluateNodeAtFrame(node: VisualNode, frame: number): VisualNode {
  const result = { ...node } as VisualNode
  const target = result as unknown as Record<string, unknown>
  for (const animation of node.animations ?? []) {
    const value = sampleKeyframes(animation.keyframes, frame)
    if (value === undefined) continue
    const property = animation.property
    if (property.startsWith("morph:") && result.kind === "mesh3d" && typeof value === "number") {
      const name = property.slice("morph:".length)
      result.morphWeights = { ...result.morphWeights, [name]: value }
      continue
    }
    const vectorProperties: Record<string, ["position" | "rotation3d" | "scale3d", number]> = {
      positionX3d: ["position", 0],
      positionY3d: ["position", 1],
      positionZ3d: ["position", 2],
      rotationX3d: ["rotation3d", 0],
      rotationY3d: ["rotation3d", 1],
      rotationZ3d: ["rotation3d", 2],
      scaleX3d: ["scale3d", 0],
      scaleY3d: ["scale3d", 1],
      scaleZ3d: ["scale3d", 2],
    }
    const vector = vectorProperties[property]
    if (vector && typeof value === "number" && result.kind === "mesh3d") {
      setVectorComponent(target, vector[0], vector[1], value)
      continue
    }
    target[property] = value
  }
  return result
}

export function locateScene(composition: VideoComposition, frame: number) {
  const total = composition.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0)
  const target = Math.max(0, Math.min(Math.max(0, total - 1), Math.floor(frame)))
  let start = 0
  for (const scene of composition.scenes) {
    const end = start + scene.durationFrames
    if (target < end)
      return { scene, sceneIndex: composition.scenes.indexOf(scene), startFrame: start, localFrame: target - start }
    start = end
  }
  const scene = composition.scenes[composition.scenes.length - 1]
  return {
    scene,
    sceneIndex: composition.scenes.length - 1,
    startFrame: Math.max(0, total - scene.durationFrames),
    localFrame: scene.durationFrames - 1,
  }
}

export function evaluateSceneAtFrame(
  scene: Scene,
  frame: number,
  hidden: ReadonlySet<string> = new Set(),
): VisualNode[] {
  const localFrame = Math.max(0, Math.min(scene.durationFrames - 1, Math.floor(frame)))
  return scene.nodes
    .filter((node) => node.visible !== false && !hidden.has(node.id))
    .map((node) => evaluateNodeAtFrame(node, localFrame))
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
}

export function compositionDurationSeconds(composition: VideoComposition) {
  return composition.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0) / composition.stage.fps
}
