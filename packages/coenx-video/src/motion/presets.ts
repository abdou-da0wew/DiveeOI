import type { AnimatedProperty, Easing, NodeAnimation, VisualNode } from "../model/types"

/**
 * Motion-design presets for Coenx compositions.
 *
 * These encode the craft rules that separate designed motion from generic
 * fades (the "AI look"):
 * 1. Never animate with linear interpolation alone - entrances settle on
 *    expo/back-out curves with overshoot life.
 * 2. Entrances move 2-3 properties together (opacity + translation + scale);
 *    a lone fade is rejected by design.
 * 3. Stagger siblings by a few frames so nothing enters simultaneously.
 * 4. Exits are faster than entrances (~10 frames vs ~20).
 * 5. Anything on screen longer than ~2s breathes with subtle sine motion.
 * 6. Stills get Ken Burns (slow scale + pan) instead of sitting static.
 * 7. Numbers count up with eased textProgress, never pop in as final values.
 *
 * Every preset appends to (never replaces) the node's existing animations
 * and returns the node for fluent chaining.
 */

/** Default settle curve for entrances: fast out, long soft landing. */
export const SETTLE_EASING: Easing = "expo-out"
/** Overshoot curve for pops and attention beats. */
export const POP_EASING: Easing = "back-out"
/** Default entrance duration in frames at 30fps (the ~0.7s design norm). */
export const ENTRANCE_FRAMES = 20
/** Default exit duration in frames - faster than entrances by design. */
export const EXIT_FRAMES = 10
/** Default stagger offset between siblings in frames. */
export const STAGGER_FRAMES = 4

type WithAnimations = VisualNode & { animations?: NodeAnimation[] }

function pushAnimations(node: WithAnimations, animations: NodeAnimation[]): WithAnimations {
  return { ...node, animations: [...(node.animations ?? []), ...animations] } as WithAnimations
}

function keyframes(
  property: AnimatedProperty,
  from: number,
  to: number,
  startFrame: number,
  endFrame: number,
  easing: Easing,
): NodeAnimation {
  return {
    property,
    keyframes: [
      { frame: startFrame, value: from, easing },
      { frame: endFrame, value: to, easing: "linear" },
    ],
  }
}

export type EntranceDirection = "up" | "down" | "left" | "right" | "none"

export interface EntranceOptions {
  /** Delay (frames) before the entrance starts. */
  delay?: number
  /** Entrance length in frames. */
  durationFrames?: number
  /** Travel distance in pixels. */
  distance?: number
  /** Travel direction; "none" fades+scales in place. */
  direction?: EntranceDirection
  /** Starting scale (1 = no scale motion). */
  scaleFrom?: number
  easing?: Easing
  /** Starting opacity (0 by default). */
  opacityFrom?: number
}

/**
 * Standard entrance: opacity + translation + scale together on the settle
 * curve. This is the default way anything enters a Coenx scene.
 */
export function entrance<T extends VisualNode>(node: T, options: EntranceOptions = {}): T {
  const delay = Math.max(0, Math.round(options.delay ?? 0))
  const duration = Math.max(1, Math.round(options.durationFrames ?? ENTRANCE_FRAMES))
  const easing = options.easing ?? SETTLE_EASING
  const distance = options.distance ?? 42
  const scaleFrom = options.scaleFrom ?? 0.94
  const opacityFrom = options.opacityFrom ?? 0
  const direction = options.direction ?? "up"
  const animations: NodeAnimation[] = [keyframes("opacity", opacityFrom, 1, delay, delay + duration, easing)]
  const travel: Record<Exclude<EntranceDirection, "none">, [AnimatedProperty, number]> = {
    up: ["y", node.y + distance],
    down: ["y", node.y - distance],
    left: ["x", node.x - distance],
    right: ["x", node.x + distance],
  }
  if (direction !== "none") {
    const [property, from] = travel[direction]
    animations.push(keyframes(property, from, (node as unknown as Record<string, number>)[property as string], delay, delay + duration, easing))
  }
  if (scaleFrom !== 1) {
    animations.push(keyframes("scaleX", scaleFrom, node.scaleX ?? 1, delay, delay + duration, easing))
    animations.push(keyframes("scaleY", scaleFrom, node.scaleY ?? 1, delay, delay + duration, easing))
  }
  return pushAnimations(node, animations) as T
}

export interface PopInOptions {
  delay?: number
  durationFrames?: number
  scaleFrom?: number
  easing?: Easing
}

/**
 * Attention pop: overshoot scale on the back curve plus opacity. Use for
 * badges, icons, stat tiles - anything that should land with a thump.
 */
export function popIn<T extends VisualNode>(node: T, options: PopInOptions = {}): T {
  const delay = Math.max(0, Math.round(options.delay ?? 0))
  const duration = Math.max(1, Math.round(options.durationFrames ?? 18))
  const easing = options.easing ?? POP_EASING
  const scaleFrom = options.scaleFrom ?? 0.55
  const animations = [
    keyframes("opacity", 0, 1, delay, delay + duration, easing),
    keyframes("scaleX", scaleFrom, node.scaleX ?? 1, delay, delay + duration, easing),
    keyframes("scaleY", scaleFrom, node.scaleY ?? 1, delay, delay + duration, easing),
  ]
  return pushAnimations(node, animations) as T
}

export interface SlideInOptions {
  delay?: number
  durationFrames?: number
  direction?: "left" | "right" | "up" | "down"
  distance?: number
  easing?: Easing
}

/** Slide entrance without scale motion - lower thirds, banners, tickers. */
export function slideIn<T extends VisualNode>(node: T, options: SlideInOptions = {}): T {
  const delay = Math.max(0, Math.round(options.delay ?? 0))
  const duration = Math.max(1, Math.round(options.durationFrames ?? ENTRANCE_FRAMES))
  const easing = options.easing ?? SETTLE_EASING
  const distance = options.distance ?? 120
  const direction = options.direction ?? "left"
  const deltas: Record<string, [AnimatedProperty, number]> = {
    up: ["y", node.y + distance],
    down: ["y", node.y - distance],
    left: ["x", node.x + distance],
    right: ["x", node.x - distance],
  }
  const [property, from] = deltas[direction]
  return pushAnimations(node, [
    keyframes("opacity", 0, 1, delay, delay + duration, easing),
    keyframes(property, from, (node as unknown as Record<string, number>)[property as string], delay, delay + duration, easing),
  ]) as T
}

export interface StaggerOptions extends EntranceOptions {
  /** Frame offset between siblings (3-6 keeps the eye tracking). */
  stagger?: number
}

/** Entrance every sibling a few frames apart, in list order. */
export function stagger<T extends VisualNode>(nodes: readonly T[], options: StaggerOptions = {}): T[] {
  const step = Math.max(1, Math.round(options.stagger ?? STAGGER_FRAMES))
  return nodes.map((node, index) => entrance(node, { ...options, delay: (options.delay ?? 0) + index * step }))
}

export interface KenBurnsOptions {
  durationFrames?: number
  scaleFrom?: number
  scaleTo?: number
  /** Pan offset [dx, dy] applied to x/y at the start, eased to the target. */
  panFrom?: readonly [number, number]
  panTo?: readonly [number, number]
  easing?: Easing
}

/**
 * Ken Burns motion for still images: slow scale + pan so photos never sit
 * static. Defaults drift slightly up-left while zooming to 1.08.
 */
export function kenBurns<T extends VisualNode>(node: T, options: KenBurnsOptions = {}): T {
  const duration = Math.max(1, Math.round(options.durationFrames ?? 150))
  const easing = options.easing ?? "ease-in-out"
  const [panFromX, panFromY] = options.panFrom ?? [-14, -8]
  const [panToX, panToY] = options.panTo ?? [0, 0]
  const scaleFrom = options.scaleFrom ?? 1
  const scaleTo = options.scaleTo ?? 1.08
  return pushAnimations(node, [
    keyframes("scaleX", scaleFrom, scaleTo, 0, duration, easing),
    keyframes("scaleY", scaleFrom, scaleTo, 0, duration, easing),
    keyframes("x", node.x + panFromX, node.x + panToX, 0, duration, easing),
    keyframes("y", node.y + panFromY, node.y + panToY, 0, duration, easing),
  ]) as T
}

export interface BreatheOptions {
  /** Peak displacement in pixels (or degrees for rotation). */
  amplitude?: number
  /** Full sine period in frames (90 = 3s at 30fps). */
  periodFrames?: number
  /** Phase offset in frames so siblings do not pulse in unison. */
  phase?: number
  property?: "y" | "x" | "rotation" | "scaleX" | "scaleY"
}

/**
 * Idle breathing: subtle sine micro-motion for anything on screen longer
 * than ~2 seconds. Sampled into linear keyframes so every backend agrees.
 */
export function breathe<T extends VisualNode>(node: T, options: BreatheOptions = {}): T {
  const amplitude = options.amplitude ?? 5
  const period = Math.max(8, Math.round(options.periodFrames ?? 90))
  const phase = options.phase ?? 0
  const property = options.property ?? "y"
  const base =
    (node as unknown as Record<string, number | undefined>)[property] ??
    (property.startsWith("scale") ? 1 : 0)
  const steps = 12
  const keyframeList = Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps
    const value = base + amplitude * Math.sin((2 * Math.PI * (t * period + phase)) / period)
    return { frame: Math.round(t * period), value, easing: "linear" as const }
  })
  return pushAnimations(node, [{ property, keyframes: keyframeList }]) as T
}

export interface CountUpOptions {
  from?: number
  to: number
  delay?: number
  durationFrames?: number
  decimals?: number
  prefix?: string
  suffix?: string
  easing?: Easing
}

/**
 * Stat count-up: drives the text node's textProgress 0..1 so every backend
 * renders the eased, formatted number (see TextNode.countTo).
 */
export function countUp<T extends VisualNode & { countTo?: number }>(node: T, options: CountUpOptions): T {
  const delay = Math.max(0, Math.round(options.delay ?? 0))
  const duration = Math.max(1, Math.round(options.durationFrames ?? 30))
  const easing = options.easing ?? SETTLE_EASING
  const prepared = {
    ...node,
    countFrom: options.from ?? 0,
    countTo: options.to,
    countDecimals: options.decimals ?? 0,
    ...(options.prefix !== undefined ? { countPrefix: options.prefix } : {}),
    ...(options.suffix !== undefined ? { countSuffix: options.suffix } : {}),
    animations: [
      ...(node.animations ?? []),
      {
        property: "textProgress" as AnimatedProperty,
        keyframes: [
          { frame: delay, value: 0, easing },
          { frame: delay + duration, value: 1, easing: "linear" as const },
        ],
      },
    ],
  } as T
  return prepared
}

export interface ExitOptions {
  /** Frame the exit starts (absolute, scene-local). */
  startFrame: number
  durationFrames?: number
  direction?: "up" | "down" | "left" | "right" | "none"
  distance?: number
  scaleTo?: number
  easing?: Easing
}

/**
 * Exit beat: faster than entrances by design, drifting out with a slight
 * scale change. Compose with entrance presets on timed sections.
 */
export function exit<T extends VisualNode>(node: T, options: ExitOptions): T {
  const start = Math.max(0, Math.round(options.startFrame))
  const duration = Math.max(1, Math.round(options.durationFrames ?? EXIT_FRAMES))
  const easing = options.easing ?? "ease-in"
  const distance = options.distance ?? 36
  const direction = options.direction ?? "up"
  const animations: NodeAnimation[] = [keyframes("opacity", node.opacity ?? 1, 0, start, start + duration, easing)]
  if (direction !== "none") {
    const travel = {
      up: ["y", node.y - distance],
      down: ["y", node.y + distance],
      left: ["x", node.x - distance],
      right: ["x", node.x + distance],
    } as const
    const [property, to] = travel[direction]
    animations.push(
      keyframes(property as AnimatedProperty, (node as unknown as Record<"x" | "y", number>)[property], to, start, start + duration, easing),
    )
  }
  if (options.scaleTo !== undefined && options.scaleTo !== 1) {
    animations.push(keyframes("scaleX", node.scaleX ?? 1, options.scaleTo, start, start + duration, easing))
    animations.push(keyframes("scaleY", node.scaleY ?? 1, options.scaleTo, start, start + duration, easing))
  }
  return pushAnimations(node, animations) as T
}
