import { describe, expect, test } from "bun:test"
import { applyComputedTexts, ease, sampleKeyframes } from "../src/animation/timeline"
import type { TextNode, VisualNode } from "../src/model/types"
import {
  breathe,
  countUp,
  entrance,
  exit,
  kenBurns,
  popIn,
  slideIn,
  stagger,
} from "../src/motion/presets"

function textNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    kind: "text",
    id: "t",
    x: 100,
    y: 200,
    width: 300,
    height: 60,
    text: "placeholder",
    ...overrides,
  }
}

describe("easing curves", () => {
  test("new easings hit their endpoints", () => {
    for (const mode of ["back-out", "back-in-out", "expo-out", "expo-in-out", "elastic-out", "bounce-out"] as const) {
      expect(ease(0, mode)).toBeCloseTo(0, 5)
      expect(ease(1, mode)).toBeCloseTo(1, 5)
    }
  })

  test("back-out overshoots before settling", () => {
    expect(ease(0.8, "back-out")).toBeGreaterThan(1)
  })

  test("expo-out settles fast then long", () => {
    expect(ease(0.3, "expo-out")).toBeGreaterThan(0.7)
  })

  test("elastic-out oscillates", () => {
    expect(ease(0.4, "elastic-out")).toBeGreaterThan(1)
  })

  test("bounce-out bounces above the running value", () => {
    expect(ease(0.4, "bounce-out")).toBeGreaterThan(0.5)
  })
})

describe("entrance presets", () => {
  test("entrance animates opacity + translation + scale together", () => {
    const animated = entrance(textNode(), { delay: 5 }) as VisualNode & { animations?: { property: string }[] }
    const properties = animated.animations!.map((animation) => animation.property)
    expect(properties).toContain("opacity")
    expect(properties).toContain("y")
    expect(properties).toContain("scaleX")
    expect(properties).toContain("scaleY")
  })

  test("stagger offsets each sibling", () => {
    const [first, second] = stagger([textNode(), textNode({ id: "t2" })], { stagger: 4 })
    const firstOpacity = (first.animations ?? []).find((animation) => animation.property === "opacity")!
    const secondOpacity = (second.animations ?? []).find((animation) => animation.property === "opacity")!
    expect(secondOpacity.keyframes[0].frame).toBe(firstOpacity.keyframes[0].frame + 4)
  })

  test("presets append without clobbering existing animations", () => {
    const base = textNode({ animations: [{ property: "rotation", keyframes: [{ frame: 0, value: 0 }] }] })
    const animated = popIn(base)
    const properties = animated.animations!.map((animation) => animation.property)
    expect(properties).toContain("rotation")
    expect(properties).toContain("scaleX")
  })

  test("slideIn travels from the given direction", () => {
    const animated = slideIn(textNode({ x: 500 }), { direction: "left", distance: 100 })
    const xAnimation = animated.animations!.find((animation) => animation.property === "x")!
    expect(xAnimation.keyframes[0].value).toBe(600)
    expect(xAnimation.keyframes[1].value).toBe(500)
  })
})

describe("kenBurns + breathe", () => {
  test("kenBurns zooms and pans", () => {
    const animated = kenBurns(textNode(), { durationFrames: 120, scaleTo: 1.1 })
    const scale = animated.animations!.find((animation) => animation.property === "scaleX")!
    expect(scale.keyframes.at(-1)!.value).toBeCloseTo(1.1)
    expect(animated.animations!.some((animation) => animation.property === "x")).toBe(true)
  })

  test("breathe samples a sine around the base position", () => {
    const animated = breathe(textNode({ y: 100 }), { amplitude: 6, periodFrames: 60 })
    const yAnimation = animated.animations!.find((animation) => animation.property === "y")!
    expect(yAnimation.keyframes.length).toBeGreaterThan(8)
    const mid = yAnimation.keyframes[Math.floor(yAnimation.keyframes.length / 2)]!
    expect(Math.abs(mid.value as number)).toBeLessThanOrEqual(106)
  })
})

describe("countUp", () => {
  test("sets count fields and drives textProgress", () => {
    const animated = countUp(textNode(), { to: 12500, prefix: "$", suffix: "", decimals: 0, delay: 6, durationFrames: 24 })
    expect(animated.countTo).toBe(12500)
    expect(animated.countPrefix).toBe("$")
    const progress = animated.animations!.find((animation) => animation.property === "textProgress")!
    expect(progress.keyframes[0].frame).toBe(6)
    expect(progress.keyframes[1].value).toBe(1)
  })

  test("applyComputedTexts renders the eased number", () => {
    const animated = countUp(textNode(), { to: 12500, delay: 0, durationFrames: 10 })
    const half = applyComputedTexts([sampled(animated, 5)])[0] as TextNode
    // expo-out at half time has already raced past 96% - the race-then-settle beat.
    expect(half.text).toBe("12,109")
    const done = applyComputedTexts([sampled(animated, 30)])[0] as TextNode
    expect(done.text).toBe("12,500")
  })

  test("decimals and suffix format", () => {
    const animated = countUp(textNode(), { to: 98.6, decimals: 1, suffix: "%", durationFrames: 10 })
    const value = applyComputedTexts([sampled(animated, 10)])[0] as TextNode
    expect(value.text).toBe("98.6%")
  })
})

describe("exit preset", () => {
  test("exits faster than entrances and drifts out", () => {
    const animated = exit(textNode({ y: 400 }), { startFrame: 90 })
    const opacity = animated.animations!.find((animation) => animation.property === "opacity")!
    expect(opacity.keyframes[1].frame - opacity.keyframes[0].frame).toBe(10)
    const y = animated.animations!.find((animation) => animation.property === "y")!
    expect(y.keyframes[1].value).toBe(364)
  })
})

function sampled(node: VisualNode, frame: number): VisualNode {
  const result = { ...node } as unknown as Record<string, unknown>
  for (const animation of (node as unknown as { animations?: { property: string; keyframes: { frame: number; value: number }[] }[] }).animations ?? []) {
    const value = sampleKeyframes(animation.keyframes as never, frame)
    if (value !== undefined) result[animation.property] = value
  }
  return result as unknown as VisualNode
}
