export type Scalar = string | number | boolean | null
export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]
export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "step"

export interface Keyframe {
  frame: number
  value: number | string | boolean
  easing?: Easing
}

export type AnimatedProperty =
  | "x"
  | "y"
  | "width"
  | "height"
  | "rotation"
  | "scaleX"
  | "scaleY"
  | "opacity"
  | "fontSize"
  | "positionX3d"
  | "positionY3d"
  | "positionZ3d"
  | "rotationX3d"
  | "rotationY3d"
  | "rotationZ3d"
  | "scaleX3d"
  | "scaleY3d"
  | "scaleZ3d"
  | `morph:${string}`

export interface NodeAnimation {
  property: AnimatedProperty
  keyframes: Keyframe[]
}

export interface NodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  scaleX?: number
  scaleY?: number
  opacity?: number
  visible?: boolean
  zIndex?: number
  clipPathId?: string
  maskId?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number | string
  animations?: NodeAnimation[]
}

export interface GradientStop {
  offset: number
  color: string
  opacity?: number
}

export type GradientPaint =
  | {
      type: "linear"
      from: Vec2
      to: Vec2
      stops: GradientStop[]
    }
  | {
      type: "radial"
      center: Vec2
      radius: number
      stops: GradientStop[]
    }

export type Paint = string | GradientPaint

export interface RectNode extends NodeBase {
  kind: "rect"
  fill?: Paint
  stroke?: string
  strokeWidth?: number
  radius?: number
}

export interface EllipseNode extends NodeBase {
  kind: "ellipse"
  fill?: Paint
  stroke?: string
  strokeWidth?: number
}

export type PathCommand =
  | { type: "moveTo" | "lineTo"; point: Vec2 }
  | { type: "quadraticTo"; control: Vec2; to: Vec2 }
  | { type: "cubicTo"; control1: Vec2; control2: Vec2; to: Vec2 }
  | { type: "close" }

export type PathFillRule = "nonzero" | "evenodd"

export interface PathDefinition {
  id: string
  width: number
  height: number
  commands: PathCommand[]
  fillRule?: PathFillRule
}

export interface ClipPathDefinition {
  id: string
  pathId: string
  fillRule?: PathFillRule
}

/**
 * One vector shape inside an alpha-mask resource. Geometry is expressed in the
 * mask's own view box; only the paint's alpha channel affects the mask. Shapes
 * are flat (no nesting) and are rendered white-with-alpha by the SVG backends
 * so luminance-based SVG masks and true alpha compositing agree everywhere.
 */
export interface MaskShape {
  kind: "path" | "rect" | "ellipse"
  /** Inline path commands for `kind: "path"`; must not be combined with pathRef. */
  commands?: PathCommand[]
  /** Reference to a scene PathDefinition for `kind: "path"` (reuses the WP1 resource graph). */
  pathRef?: string
  /** rect/ellipse geometry, in mask view-box units. */
  x?: number
  y?: number
  width?: number
  height?: number
  radius?: number
  /** Alpha source: solid color (8-digit hex alpha supported) or gradient with per-stop alpha. */
  fill: Paint
  fillRule?: PathFillRule
  /** Multiplies the paint alpha; defaults to 1. */
  opacity?: number
}

/**
 * Reusable alpha-mask resource. The referencing node's box maps the mask view
 * box exactly like clip paths (node-local scaling); the mask inherits the
 * node's transform; node and transition opacity apply after the mask. Masked
 * content outside the node box is hidden (backends composite the node into a
 * node-box-bounded offscreen). Luminance masks are intentionally not part of
 * version 1 and stay capability-gated off.
 */
export interface MaskDefinition {
  id: string
  width: number
  height: number
  shapes: MaskShape[]
}

export interface PathNode extends NodeBase {
  kind: "path"
  commands?: PathCommand[]
  pathRef?: string
  fillRule?: PathFillRule
  fill?: Paint
  stroke?: string
  strokeWidth?: number
  lineCap?: "butt" | "round" | "square"
  lineJoin?: "miter" | "round" | "bevel"
}

export interface LineNode extends NodeBase {
  kind: "line"
  points: Vec2[]
  stroke: string
  strokeWidth?: number
  lineCap?: "butt" | "round" | "square"
}

export interface TextNode extends NodeBase {
  kind: "text"
  text: string
  color?: string
  align?: "left" | "center" | "right"
  lineHeight?: number
}

export interface ImageNode extends NodeBase {
  kind: "image"
  asset: string
  fit?: "contain" | "cover" | "fill"
  alt?: string
}

export interface ButtonNode extends NodeBase {
  kind: "button"
  text: string
  fill?: Paint
  color?: string
  borderColor?: string
  radius?: number
  disabled?: boolean
}

export interface InputNode extends NodeBase {
  kind: "input"
  bind: string
  placeholder?: string
  inputType?: "text" | "number"
  label?: string
}

export interface SelectNode extends NodeBase {
  kind: "select"
  bind: string
  options: Array<{ value: string; label: string }>
  placeholder?: string
}

export interface MeshMorphTarget {
  name: string
  vertices: Vec3[]
}

export interface MeshMaterial3D {
  shading?: "flat" | "smooth"
  ambient?: number
  diffuse?: number
  specular?: number
  shininess?: number
  metalness?: number
  roughness?: number
  emissive?: string
  wireframe?: boolean
  doubleSided?: boolean
}

export interface Light3D {
  type: "ambient" | "directional" | "point"
  color?: string
  intensity?: number
  direction?: Vec3
  position?: Vec3
  distance?: number
}

export interface Mesh3DNode extends NodeBase {
  kind: "mesh3d"
  vertices: Vec3[]
  triangles: Array<readonly [number, number, number]>
  position?: Vec3
  rotation3d?: Vec3
  scale3d?: Vec3
  color?: string
  stroke?: string
  lightDirection?: Vec3
  material?: MeshMaterial3D
  morphTargets?: MeshMorphTarget[]
  morphWeights?: Record<string, number>
}

export type VisualNode =
  | RectNode
  | EllipseNode
  | PathNode
  | LineNode
  | TextNode
  | ImageNode
  | ButtonNode
  | InputNode
  | SelectNode
  | Mesh3DNode

export type Expression =
  | { op: "literal"; value: Scalar }
  | { op: "state"; key: string }
  | { op: "event"; key: "value" | "key" | "targetId" }
  | { op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; left: Expression; right: Expression }
  | { op: "and" | "or"; items: Expression[] }
  | { op: "not"; value: Expression }
  | { op: "contains"; value: Expression; search: Expression }

export type InteractionTrigger =
  | { type: "click"; targetId: string }
  | { type: "submit"; targetId: string }
  | { type: "change"; targetId: string }
  | { type: "key"; key: string }
  | { type: "timer"; frame: number }

export type InteractionAction =
  | { type: "set"; key: string; value: Scalar | Expression }
  | { type: "increment"; key: string; amount: number }
  | { type: "goto"; sceneId: string }
  | { type: "show" | "hide"; targetId: string }
  | { type: "feedback"; text: string; tone?: "neutral" | "success" | "error" }
  | { type: "playAudio"; trackId: string }
  | { type: "emit"; event: string; payload?: Scalar }

export interface SceneInteraction {
  id: string
  trigger: InteractionTrigger
  when?: Expression
  actions: InteractionAction[]
}

export interface Camera3D {
  position: Vec3
  target: Vec3
  fov?: number
  near?: number
  far?: number
}

export interface PhysicsBody {
  nodeId: string
  position?: Vec2
  mass: number
  velocity: Vec2
  size: Vec2
  collider?: "aabb" | "circle"
  restitution?: number
  isStatic?: boolean
}

export interface PhysicsSettings {
  gravity?: Vec2
  bodies: PhysicsBody[]
}

export interface PhysicsBody3D {
  nodeId: string
  position?: Vec3
  velocity: Vec3
  rotation?: Vec3
  angularVelocity?: Vec3
  mass: number
  size: Vec3
  collider?: "aabb" | "sphere"
  restitution?: number
  friction?: number
  isStatic?: boolean
}

export interface Physics3DSettings {
  gravity?: Vec3
  bodies: PhysicsBody3D[]
  bounds?: { min: Vec3; max: Vec3 }
  substeps?: number
}

export type SceneTransition = {
  type: "fade" | "slide-left" | "slide-right" | "zoom" | "wipe-left" | "wipe-right" | "flip-3d"
  durationFrames: number
}

export interface Scene {
  id: string
  durationFrames: number
  background?: string
  nodes: VisualNode[]
  pathDefinitions?: PathDefinition[]
  clipPaths?: ClipPathDefinition[]
  masks?: MaskDefinition[]
  interactions?: SceneInteraction[]
  camera3d?: Camera3D
  lights3d?: Light3D[]
  physics?: PhysicsSettings
  physics3d?: Physics3DSettings
  transition?: SceneTransition
}

export interface AudioClip {
  id: string
  source: string
  kind: "music" | "voiceover" | "sfx"
  startFrame: number
  durationFrames: number
  trimStartSeconds?: number
  volume?: number
  loop?: boolean
  fadeInFrames?: number
  fadeOutFrames?: number
}

export interface TimelineEvent {
  id: string
  frame: number
  actions: InteractionAction[]
}

export interface VideoStage {
  width: number
  height: number
  fps: number
  background?: string
}

export interface LearningCitation {
  bookId: string
  passageId: string
  title?: string
  quote?: string
  page?: number
}

export interface VideoComposition {
  version: 1
  id: string
  title: string
  stage: VideoStage
  scenes: Scene[]
  audio?: AudioClip[]
  initialState?: Record<string, Scalar>
  timeline?: TimelineEvent[]
  assets?: Record<string, string>
  provenance?: {
    mode: "general" | "education"
    citations?: LearningCitation[]
    learningObjective?: string
  }
}

export interface RenderProfile {
  name: "low" | "balanced" | "quality"
  maxWidth: number
  maxHeight: number
  maxFps: number
  maxFrames: number
  maxNodes: number
  maxRasterChunkBytes: number
  maxConcurrentRenders: number
  ffmpegThreads: number
}

export interface RenderOptions {
  outputPath: string
  projectRoot?: string
  profile?: Partial<RenderProfile>
  renderer?: "svg" | "native"
  signal?: AbortSignal
  quality?: number
  preset?: "ultrafast" | "fast" | "medium" | "slow"
  onProgress?: (progress: { frame: number; totalFrames: number; percent: number }) => void
}

export interface RenderResult {
  outputPath: string
  width: number
  height: number
  fps: number
  frames: number
  durationSeconds: number
  bytes: number
}
