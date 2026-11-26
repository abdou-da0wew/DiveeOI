export { createComposition, createScene, rect, ellipse, text, button, addNode } from "./authoring/composition"
export { validateComposition, totalFrames, RENDER_PROFILES, VideoValidationError } from "./model/validate"
export { COENX_VIDEO_CAPABILITIES } from "./capabilities"
export type { FeatureCapability, FeatureSupport, RendererCapability, RendererId } from "./capabilities"
export { renderStandardVideo } from "./render/standard"
export { compileInteractiveProject } from "./compiler/interactive"
export { mountInteractivePlayer } from "./runtime/player"
export { InteractiveEngine, dispatchInteraction } from "./interactive/engine"
export { evaluateExpression } from "./interactive/expressions"
export { sampleKeyframes, evaluateNodeAtFrame, evaluateSceneAtFrame, locateScene } from "./animation/timeline"
export { simulatePhysics } from "./physics/simulate"
export { simulatePhysicsFallback } from "./physics/world"
export { simulatePhysics3D, physics3DPoseAt } from "./physics/simulate3d"
export type { Physics3DSimulation, Physics3DSimulationOptions } from "./physics/simulate3d"
export { boxMesh, projectMesh3D } from "./render/geometry3d"
export type { ProjectedFace } from "./render/geometry3d"
export { createEducationalVideo, citationsForVideo } from "./learning"
export type * from "./model/types"
export type * from "./physics/world"
export type { InteractivePlayerHandle, InteractivePlayerOptions } from "./runtime/player"
export type { InteractiveCompileOptions, InteractiveCompileResult } from "./compiler/interactive"
export type { PhysicsOptions } from "./physics/simulate"

export * from "./format"
export * from "./fonts"
export { prepareRenderFonts } from "./render/fonts"
export { resolveImageMagickBinary, resolveImageMagickRuntime } from "./render/rasterizer"
export type { ImageMagickResolutionOptions, ImageMagickRuntime } from "./render/rasterizer"
export { canvasFilterValue, effectPadding, parseFilterAttribute, svgFilterDefinition } from "./render/effects"
export { EFFECT_BUDGETS, effectSurfacePixels } from "./model/validate-effects"
export { renderNativeFrame } from "./render/native"
export type { NativeFrameRequest } from "./render/native"
export { renderNativeVideo } from "./render/native-video"
export { SvgVideoRenderer } from "./runtime/svg-renderer"
export { createZip, readZip, crc32 } from "./container/zip"
export { packCoenx, unpackCoenx, validateCoenx, CONTAINER_VERSION } from "./container/pack"
export type { CoenxManifest, CoenxPackOptions, CoenxValidation } from "./container/pack"
export {
  SETTLE_EASING,
  POP_EASING,
  ENTRANCE_FRAMES,
  EXIT_FRAMES,
  STAGGER_FRAMES,
  entrance,
  popIn,
  slideIn,
  stagger,
  kenBurns,
  breathe,
  countUp,
  exit,
} from "./motion/presets"
