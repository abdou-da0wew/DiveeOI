import type {
  Expression,
  InteractionAction,
  InteractionTrigger,
  NodeOverrideProps,
  Scalar,
  Scene,
  VideoComposition,
} from "../model/types"
import { evaluateExpression } from "./expressions"

export interface PlayerEvent {
  type: InteractionTrigger["type"]
  targetId?: string
  value?: Scalar
  key?: string
  phase?: string
  withId?: string
  x?: number
  y?: number
}

export interface ImpulseCommand {
  nodeId: string
  vx: number
  vy: number
}

export interface InteractionResult {
  sceneChanged: boolean
  stateChanged: boolean
  nodesChanged: boolean
  playedAudio: string[]
  emitted: Array<{ event: string; payload?: Scalar }>
  impulses: ImpulseCommand[]
  gotoFrame?: number
  feedback?: { text: string; tone: "neutral" | "success" | "error" }
}

/** Per-node concrete visual overrides produced by `setNode` actions. */
export type NodeOverride = Record<string, Scalar>

const MAX_ACTION_DEPTH = 8

function emptyResult(): InteractionResult {
  return { sceneChanged: false, stateChanged: false, nodesChanged: false, playedAudio: [], emitted: [], impulses: [] }
}

export class InteractiveEngine {
  readonly state: Record<string, Scalar>
  readonly hiddenNodes = new Set<string>()
  /** nodeId -> override props (text/x/y/rotation/opacity/scale); cleared on scene navigation. */
  readonly nodeOverrides = new Map<string, NodeOverride>()
  readonly firedTimers = new Set<string>()
  currentSceneId: string
  feedback: InteractionResult["feedback"]
  /**
   * Bumped whenever node overrides or hidden nodes change. Consumers that
   * merge per-frame data with these overrides (the live-physics player) use
   * it to skip rebuilds while the world is idle - a zero-allocation frame
   * for static or settled scenes.
   */
  overridesVersion = 0
  private readonly hiddenByScene = new Map<string, Set<string>>()
  private readonly overridesByScene = new Map<string, Array<[string, NodeOverride]>>()
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
    this.overridesByScene.set(this.currentSceneId, [...this.nodeOverrides.entries()])
    this.currentSceneId = sceneId
    this.hiddenNodes.clear()
    this.nodeOverrides.clear()
    this.overridesVersion++
    for (const nodeId of this.hiddenByScene.get(sceneId) ?? []) this.hiddenNodes.add(nodeId)
    for (const [nodeId, override] of this.overridesByScene.get(sceneId) ?? []) this.nodeOverrides.set(nodeId, override)
    for (const key of this.firedTimers) {
      if (key.startsWith(`scene:${sceneId}:`)) this.firedTimers.delete(key)
    }
    return true
  }

  dispatch(event: PlayerEvent): InteractionResult {
    const scene = this.currentScene
    const result = emptyResult()
    const handlers = scene.interactions ?? []
    for (const handler of handlers) {
      if (!this.matches(handler.trigger, event)) continue
      if (handler.when && !evaluateExpression(handler.when, { state: this.state, event })) continue
      for (const action of handler.actions) this.apply(action, result, 0, event)
      if (result.sceneChanged) break
    }
    if (result.feedback) this.feedback = result.feedback
    return result
  }

  tick(localFrame: number): InteractionResult {
    const result = emptyResult()
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
    if ("targetId" in trigger) {
      if (trigger.targetId !== event.targetId) return false
      if ((trigger.type === "hover" || trigger.type === "drag") && trigger.phase && trigger.phase !== event.phase) {
        return false
      }
      if (trigger.type === "collide" && trigger.withId && trigger.withId !== event.withId) return false
      return true
    }
    if (trigger.type === "key") return trigger.key === event.key
    return true
  }

  private apply(action: InteractionAction, result: InteractionResult, depth = 0, event?: PlayerEvent) {
    if (depth > MAX_ACTION_DEPTH) return
    const context = event ? { state: this.state, event } : { state: this.state }
    switch (action.type) {
      case "set": {
        const next =
          typeof action.value === "object" && action.value !== null && "op" in action.value
            ? (evaluateExpression(action.value, context) ?? null)
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
      case "gotoFrame":
        result.gotoFrame = Math.max(0, Math.floor(action.frame))
        break
      case "run":
        for (const nested of action.actions) this.apply(nested, result, depth + 1, event)
        break
      case "setNode": {
        const override: NodeOverride = { ...this.nodeOverrides.get(action.targetId) }
        let changed = false
        for (const [key, value] of Object.entries(action.props) as Array<[keyof NodeOverrideProps, Scalar | Expression | undefined]>) {
          if (value === undefined) continue
          const next =
            typeof value === "object" && value !== null && "op" in value
              ? (evaluateExpression(value, context) ?? null)
              : value
          if (next === undefined || next === null) continue
          if (override[key] !== next) {
            override[key] = next
            changed = true
          }
        }
        if (changed) {
          this.nodeOverrides.set(action.targetId, override)
          this.overridesVersion++
          result.nodesChanged = true
        }
        break
      }
      case "impulse":
        result.impulses.push({ nodeId: action.targetId, vx: action.vx, vy: action.vy })
        break
      case "show":
        if (this.hiddenNodes.delete(action.targetId)) {
          this.overridesVersion++
        }
        break
      case "hide":
        if (!this.hiddenNodes.has(action.targetId)) {
          this.hiddenNodes.add(action.targetId)
          this.overridesVersion++
        }
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
