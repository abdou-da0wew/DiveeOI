import type { InteractionAction, InteractionTrigger, Scalar, Scene, VideoComposition } from "../model/types"
import { evaluateExpression } from "./expressions"

export interface PlayerEvent {
  type: InteractionTrigger["type"]
  targetId?: string
  value?: Scalar
  key?: string
}

export interface InteractionResult {
  sceneChanged: boolean
  stateChanged: boolean
  playedAudio: string[]
  emitted: Array<{ event: string; payload?: Scalar }>
  feedback?: { text: string; tone: "neutral" | "success" | "error" }
}

export class InteractiveEngine {
  readonly state: Record<string, Scalar>
  readonly hiddenNodes = new Set<string>()
  readonly firedTimers = new Set<string>()
  currentSceneId: string
  feedback: InteractionResult["feedback"]
  private readonly hiddenByScene = new Map<string, Set<string>>()
  private globalFrame = 0

  constructor(readonly composition: VideoComposition) {
    this.state = { ...composition.initialState }
    this.currentSceneId = composition.scenes[0].id
  }

  get currentScene(): Scene {
    return this.composition.scenes.find((scene) => scene.id === this.currentSceneId) ?? this.composition.scenes[0]
  }

  setFrame(frame: number) {
    this.globalFrame = Math.max(0, Math.floor(frame))
  }

  navigate(sceneId: string) {
    if (!this.composition.scenes.some((scene) => scene.id === sceneId)) return false
    if (sceneId === this.currentSceneId) return true
    this.hiddenByScene.set(this.currentSceneId, new Set(this.hiddenNodes))
    this.currentSceneId = sceneId
    this.hiddenNodes.clear()
    for (const nodeId of this.hiddenByScene.get(sceneId) ?? []) this.hiddenNodes.add(nodeId)
    for (const key of this.firedTimers) {
      if (key.startsWith(`scene:${sceneId}:`)) this.firedTimers.delete(key)
    }
    return true
  }

  dispatch(event: PlayerEvent): InteractionResult {
    const scene = this.currentScene
    const result: InteractionResult = { sceneChanged: false, stateChanged: false, playedAudio: [], emitted: [] }
    const handlers = scene.interactions ?? []
    for (const handler of handlers) {
      if (!this.matches(handler.trigger, event)) continue
      if (handler.when && !evaluateExpression(handler.when, { state: this.state, event })) continue
      for (const action of handler.actions) this.apply(action, result)
      if (result.sceneChanged) break
    }
    if (result.feedback) this.feedback = result.feedback
    return result
  }

  tick(localFrame: number): InteractionResult {
    const result: InteractionResult = { sceneChanged: false, stateChanged: false, playedAudio: [], emitted: [] }
    const sceneId = this.currentSceneId
    for (const handler of this.currentScene.interactions ?? []) {
      const key = `scene:${sceneId}:${handler.id}`
      if (
        handler.trigger.type !== "timer" ||
        handler.trigger.frame > localFrame ||
        this.firedTimers.has(key) ||
        (handler.when && !evaluateExpression(handler.when, { state: this.state }))
      ) {
        continue
      }
      this.firedTimers.add(key)
      for (const action of handler.actions) this.apply(action, result)
      if (result.sceneChanged) break
    }
    for (const event of this.composition.timeline ?? []) {
      const key = `timeline:${event.id}`
      if (event.frame > this.globalFrame || this.firedTimers.has(key)) continue
      this.firedTimers.add(key)
      for (const action of event.actions) this.apply(action, result)
    }
    if (result.feedback) this.feedback = result.feedback
    return result
  }

  private matches(trigger: InteractionTrigger, event: PlayerEvent) {
    if (trigger.type !== event.type) return false
    if ("targetId" in trigger) return trigger.targetId === event.targetId
    if (trigger.type === "key") return trigger.key === event.key
    return true
  }

  private apply(action: InteractionAction, result: InteractionResult) {
    switch (action.type) {
      case "set": {
        const next =
          typeof action.value === "object" && action.value !== null && "op" in action.value
            ? (evaluateExpression(action.value, { state: this.state }) ?? null)
            : action.value
        if (this.state[action.key] !== next) {
          this.state[action.key] = next
          result.stateChanged = true
        }
        break
      }
      case "increment": {
        const next = Number(this.state[action.key] ?? 0) + action.amount
        if (this.state[action.key] !== next) {
          this.state[action.key] = next
          result.stateChanged = true
        }
        break
      }
      case "goto":
        result.sceneChanged = this.navigate(action.sceneId) || result.sceneChanged
        break
      case "show":
        this.hiddenNodes.delete(action.targetId)
        break
      case "hide":
        this.hiddenNodes.add(action.targetId)
        break
      case "feedback":
        result.feedback = { text: action.text, tone: action.tone ?? "neutral" }
        break
      case "playAudio":
        result.playedAudio.push(action.trackId)
        break
      case "emit":
        result.emitted.push({ event: action.event, payload: action.payload })
        break
    }
  }
}

export function dispatchInteraction(engine: InteractiveEngine, event: PlayerEvent) {
  return engine.dispatch(event)
}
