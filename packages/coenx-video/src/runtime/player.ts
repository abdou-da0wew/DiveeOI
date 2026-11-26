import type { Scalar, Scene, VideoComposition } from "../model/types"
import { evaluateSceneAtFrame } from "../animation/timeline"
import { physics3DPoseAt, simulatePhysics3D, type Physics3DSimulation } from "../physics/simulate3d"
import { LivePhysicsWorld } from "../physics/live"
import { InteractiveEngine, type InteractionResult, type PlayerEvent } from "../interactive/engine"
import { CanvasVideoRenderer, type CanvasAssetResolver } from "./canvas-renderer"
import { InteractiveControls } from "./controls"
import { SvgVideoRenderer } from "./svg-renderer"
import type { NodeOverrideMap } from "./overrides"
import { createPlayerAudioRuntime } from "./player/audio"
import { bindPlayerInput, type InteractionBox } from "./player/input"
import { applySceneTransition, sizeCanvas } from "./player/view"

export interface InteractivePlayerOptions {
  autoplay?: boolean
  maxFps?: number
  maxDevicePixelRatio?: number
  renderer?: "canvas" | "svg"
  resolveAsset?: CanvasAssetResolver
  onStateChange?: (state: Record<string, Scalar>) => void
  onSceneChange?: (sceneId: string) => void
  onEvent?: (event: InteractionResult["emitted"][number]) => void
}

export interface InteractivePlayerHandle {
  play(): void
  pause(): void
  seek(frame: number): void
  getState(): Record<string, string | number | boolean | null>
  destroy(): void
}

/** Hard cap on physics steps per rendered frame (protects against stalls). */
const MAX_PHYSICS_STEPS_PER_RENDER = 12

export function mountInteractivePlayer(
  container: HTMLElement,
  composition: VideoComposition,
  options: InteractivePlayerOptions = {},
): InteractivePlayerHandle {
  if (composition.version !== 1) throw new Error("Unsupported interactive video version")
  const stage = composition.stage
  const wrapper = document.createElement("div")
  wrapper.style.cssText =
    "position:relative;width:100%;aspect-ratio:var(--coenx-aspect);overflow:hidden;background:#10131b;isolation:isolate;"
  wrapper.style.setProperty("--coenx-aspect", `${stage.width} / ${stage.height}`)
  const canvas = options.renderer === "svg" ? undefined : document.createElement("canvas")
  const svgRenderer = options.renderer === "svg" ? new SvgVideoRenderer(composition, options.resolveAsset) : undefined
  const stageElement = canvas ?? svgRenderer!.element
  stageElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
  const controlsRoot = document.createElement("div")
  wrapper.append(stageElement, controlsRoot)
  container.append(wrapper)

  const renderer = canvas
    ? new CanvasVideoRenderer({ canvas, composition, resolveAsset: options.resolveAsset })
    : svgRenderer!
  const engine = new InteractiveEngine(composition)
  let physics3dSceneId: string | undefined
  let physics3dSimulation: Physics3DSimulation | undefined
  let currentFrame = 0
  let sceneStartFrame = 0
  let playing = false
  let destroyed = false
  let raf = 0
  let lastTime = 0
  let lastRender = 0
  let fractionalFrames = 0
  let sceneId = engine.currentSceneId
  const maxFps = Math.max(1, Math.min(options.maxFps ?? 30, 60))
  const maxDpr = Math.max(1, Math.min(options.maxDevicePixelRatio ?? 1.5, 2))
  const audio = createPlayerAudioRuntime(composition, stage.fps, options.resolveAsset, () => currentFrame)
  const controls = new InteractiveControls(controlsRoot, composition, {
    dispatch: (event) => dispatchEvent(event),
  })

  // ----- Live 2D physics -----

  let livePhysics: LivePhysicsWorld | undefined
  let livePhysicsSceneId: string | undefined
  let lastPhysicsFrame = 0
  /** Last drawn node boxes (center coordinates) used for hit-testing. */
  let interactionBoxes = new Map<string, InteractionBox>()

  function currentScene(): Scene {
    return engine.currentScene
  }

  function getLivePhysics(scene: Scene) {
    if (scene.id === livePhysicsSceneId) return livePhysics
    livePhysicsSceneId = scene.id
    if (!scene.physics) {
      livePhysics = undefined
      return undefined
    }
    const geometry = new Map(
      scene.nodes
        .filter((node) => scene.physics!.bodies.some((body) => body.nodeId === node.id))
        .map((node) => [node.id, { x: node.x, y: node.y, width: node.width, height: node.height }]),
    )
    livePhysics = new LivePhysicsWorld(scene.physics, geometry)
    lastPhysicsFrame = currentFrame - sceneStartFrame
    return livePhysics
  }

  function getPhysics3dSimulation(scene: Scene) {
    if (scene.id === physics3dSceneId) return physics3dSimulation
    physics3dSceneId = scene.id
    if (!scene.physics3d) {
      physics3dSimulation = undefined
      return undefined
    }
    const settings = {
      ...scene.physics3d,
      bodies: scene.physics3d.bodies.map((body) => {
        const node = scene.nodes.find((item) => item.id === body.nodeId)
        return node?.kind === "mesh3d"
          ? {
              ...body,
              position: body.position ?? node.position ?? [0, 0, 0],
              rotation: body.rotation ?? node.rotation3d ?? [0, 0, 0],
            }
          : body
      }),
    }
    physics3dSimulation = simulatePhysics3D(settings, scene.durationFrames - 1, { dt: 1 / stage.fps })
    return physics3dSimulation
  }

  function handleInteractionResult(result: InteractionResult, source: PlayerEvent | undefined) {
    emitEvents(result.emitted)
    for (const impulse of result.impulses) {
      if (livePhysics) livePhysics.applyImpulse(impulse.nodeId, impulse.vx, impulse.vy)
    }
    for (const id of result.playedAudio) audio.play(id)
    if (result.gotoFrame !== undefined) {
      const scene = currentScene()
      const local = Math.max(0, Math.min(scene.durationFrames - 1, Math.floor(result.gotoFrame)))
      currentFrame = sceneStartFrame + local
      lastPhysicsFrame = local
      fractionalFrames = 0
    }
    controls.setState({ ...engine.state })
    if (result.stateChanged) options.onStateChange?.({ ...engine.state })
    if (result.sceneChanged) syncScene()
    if (source?.type !== "collide") render(true)
  }

  function syncScene() {
    if (engine.currentSceneId === sceneId) return
    sceneId = engine.currentSceneId
    sceneStartFrame = currentFrame
    options.onSceneChange?.(sceneId)
    render(true)
  }

  function emitEvents(events: InteractionResult["emitted"]) {
    for (const event of events) {
      options.onEvent?.(event)
      wrapper.dispatchEvent(new CustomEvent("coenx:event", { detail: event, bubbles: true }))
    }
  }

  function dispatchEvent(event: PlayerEvent) {
    const result = engine.dispatch(event)
    if (livePhysics && event.targetId && event.type === "drag" && livePhysics.has(event.targetId)) {
      if (event.phase === "start") livePhysics.beginDrag(event.targetId)
      if (event.phase === "move" && event.x !== undefined && event.y !== undefined) {
        livePhysics.dragTo(event.targetId, event.x, event.y)
      }
      if (event.phase === "end") livePhysics.endDrag(event.targetId)
    }
    handleInteractionResult(result, event)
  }

  function stepLivePhysics(scene: Scene, localFrame: number): NodeOverrideMap | undefined {
    const world = getLivePhysics(scene)
    if (!world) return undefined
    const steps = Math.max(0, Math.min(Math.round(localFrame - lastPhysicsFrame), MAX_PHYSICS_STEPS_PER_RENDER))
    for (let index = 0; index < steps; index++) {
      for (const collision of world.step(1 / stage.fps)) {
        const result = engine.dispatch({ type: "collide", targetId: collision.a, withId: collision.b })
        emitEvents(result.emitted)
        for (const id of result.playedAudio) audio.play(id)
        if (result.stateChanged) options.onStateChange?.({ ...engine.state })
        controls.setState({ ...engine.state })
        if (result.feedback) engine.feedback = result.feedback
        // Scene changes from collision handlers take effect after the step loop.
      }
    }
    if (steps > 0) lastPhysicsFrame = localFrame
    const poses = world.poses()
    const merged = new Map(engine.nodeOverrides)
    for (const [nodeId, pose] of poses) {
      merged.set(nodeId, { ...merged.get(nodeId), x: pose.x, y: pose.y })
    }
    return merged
  }

  function recordInteractionBoxes(scene: Scene, localFrame: number, overrides: NodeOverrideMap | undefined) {
    const boxes = new Map<string, InteractionBox>()
    for (const node of evaluateSceneAtFrame(scene, localFrame, engine.hiddenNodes)) {
      const override = overrides?.get(node.id)
      boxes.set(node.id, {
        x: override?.x !== undefined ? Number(override.x) : node.x,
        y: override?.y !== undefined ? Number(override.y) : node.y,
        width: node.width,
        height: node.height,
      })
    }
    interactionBoxes = boxes
  }

  function render(force = false) {
    if (destroyed) return
    const rect = wrapper.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    sizeCanvas(canvas, wrapper, stage, maxDpr)
    const scene = currentScene()
    const localFrame = Math.max(0, Math.min(scene.durationFrames - 1, currentFrame - sceneStartFrame))
    const physicsSimulation = getPhysics3dSimulation(scene)
    const physics3d = physicsSimulation
      ? Object.fromEntries(
          [...physicsSimulation.bodyIndexes.keys()].flatMap((nodeId) => {
            const pose = physics3DPoseAt(physicsSimulation, nodeId, localFrame)
            return pose ? [[nodeId, pose]] : []
          }),
        )
      : undefined
    const overrides = stepLivePhysics(scene, localFrame)
    recordInteractionBoxes(scene, localFrame, overrides)
    renderer.draw(scene, localFrame, engine.hiddenNodes, physics3d, overrides)
    applySceneTransition(stageElement, controlsRoot, scene, localFrame)
    controls.setState({ ...engine.state })
    controls.update(scene)
    const interaction = engine.tick(localFrame)
    if (interaction.stateChanged) options.onStateChange?.({ ...engine.state })
    emitEvents(interaction.emitted)
    for (const id of interaction.playedAudio) audio.play(id)
    for (const impulse of interaction.impulses) {
      if (livePhysics) livePhysics.applyImpulse(impulse.nodeId, impulse.vx, impulse.vy)
    }
    if (interaction.gotoFrame !== undefined) {
      const local = Math.max(0, Math.min(scene.durationFrames - 1, Math.floor(interaction.gotoFrame)))
      currentFrame = sceneStartFrame + local
      lastPhysicsFrame = local
      fractionalFrames = 0
    }
    if (interaction.sceneChanged) syncScene()
    if (interaction.feedback) wrapper.setAttribute("data-feedback", interaction.feedback.tone)
    else wrapper.removeAttribute("data-feedback")
    if (force) lastRender = performance.now()
  }

  function advanceToNextScene(scene: Scene) {
    const index = composition.scenes.findIndex((item) => item.id === scene.id)
    const next = composition.scenes[index + 1]
    if (!next) {
      playing = false
      audio.pauseAll()
      return
    }
    engine.navigate(next.id)
    syncScene()
  }

  function step(now: number) {
    if (!playing || destroyed) return
    raf = requestAnimationFrame(step)
    if (now - lastRender < 1000 / maxFps) return
    if (lastTime) fractionalFrames += Math.max(0, Math.min(0.1, (now - lastTime) / 1000)) * stage.fps
    lastTime = now
    const advance = Math.floor(fractionalFrames)
    if (advance > 0) {
      currentFrame += advance
      fractionalFrames -= advance
    }
    const scene = currentScene()
    if (currentFrame - sceneStartFrame >= scene.durationFrames) advanceToNextScene(scene)
    engine.setFrame(currentFrame)
    audio.sync()
    render()
    lastRender = now
  }

  function play() {
    if (playing || destroyed) return
    audio.unlock()
    playing = true
    lastTime = 0
    raf = requestAnimationFrame(step)
  }

  function pause() {
    playing = false
    cancelAnimationFrame(raf)
    audio.pauseAll()
  }

  function seek(frame: number) {
    const total = composition.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0)
    currentFrame = Math.max(0, Math.min(total - 1, Math.floor(frame)))
    fractionalFrames = 0
    let remaining = currentFrame
    let target = composition.scenes[0]
    sceneStartFrame = 0
    for (const scene of composition.scenes) {
      if (remaining < scene.durationFrames) {
        target = scene
        break
      }
      remaining -= scene.durationFrames
      sceneStartFrame += scene.durationFrames
    }
    engine.navigate(target.id)
    engine.setFrame(currentFrame)
    syncScene()
    audio.sync()
    render(true)
  }

  const resize = new ResizeObserver(() => render(true))
  resize.observe(wrapper)
  const intersection =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          if (entries[0]?.isIntersecting) {
            if (options.autoplay) play()
          } else pause()
        })
      : undefined
  intersection?.observe(wrapper)
  const removeInputListeners = bindPlayerInput({
    wrapper,
    stageElement,
    canvas,
    stage,
    engine,
    interactionBoxes: () => interactionBoxes,
    dispatch: dispatchEvent,
    unlockAudio: audio.unlock,
    pause,
    isPlaying: () => playing,
    isDestroyed: () => destroyed,
  })
  controls.setState({ ...engine.state })
  render(true)
  if (options.autoplay) play()

  return {
    play,
    pause,
    seek,
    getState: () => ({ ...engine.state }),
    destroy() {
      destroyed = true
      pause()
      resize.disconnect()
      removeInputListeners()
      intersection?.disconnect()
      audio.destroy()
      controls.destroy()
      renderer.destroy()
      wrapper.remove()
    },
  }
}

export * as VideoPlayer from "./player"
