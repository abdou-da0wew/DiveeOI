import type { NodeEffect } from "../model/types"

/**
 * Shared WP4 effect helpers: one semantic definition consumed by the static
 * SVG backend, the interactive SVG backend, the Canvas backend, the native
 * payload and the CML compiler.
 *
 * Semantics (identical on every backend that claims support):
 * - Effects apply to the node's rendered content BEFORE clipping, masking and
 *   opacity, in list order (the SVG rendering model: content -> filter ->
 *   clip-path -> mask -> opacity).
 * - Blur and drop-shadow radii are Gaussian sigmas (CSS blur() semantics:
 *   `feGaussianBlur stdDeviation`, canvas `blur()`, and the Rust three-pass
 *   box approximation all take the same sigma).
 * - Color adjustment follows CSS filter semantics: brightness multiplies,
 *   contrast pivots around 0.5, saturate uses the SVG saturate matrix and
 *   hueRotate the SVG hue-rotate matrix; sub-ops compose in that fixed order.
 */

const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i
export const EFFECT_TYPES: ReadonlyArray<NodeEffect["type"]> = ["blur", "drop-shadow", "color-adjust", "grain", "vignette"]

/**
 * Injects a deterministic per-frame seed into grain effects so animated
 * grain shimmers across frames while staying stable within a frame (and
 * reproducible across renders). Validation still bounds the base seed.
 */
export function withGrainFrameSeeds<T extends { effects?: NodeEffect[] }>(nodes: readonly T[], frame: number): T[] {
  return nodes.map((node) => {
    if (!node.effects?.some((effect) => effect.type === "grain")) return node
    return {
      ...node,
      effects: node.effects.map((effect) => {
        if (effect.type !== "grain") return effect
        const mixed = (Math.round(effect.seed ?? 7) + frame * 1013 + (effect.size ?? 2) * 7919) % 2147483647
        return { ...effect, seed: Math.max(0, mixed) }
      }),
    } as T
  })
}

/** Padding (pixels) an effect chain requires around the node box: 3 sigmas of blur plus shadow offsets. */
export function effectPadding(effects: readonly NodeEffect[]): number {
  let sigma = 0
  let offset = 0
  for (const effect of effects) {
    if (effect.type === "blur") sigma = Math.max(sigma, effect.radius)
    if (effect.type === "drop-shadow") {
      sigma = Math.max(sigma, effect.radius)
      offset = Math.max(offset, Math.abs(effect.dx), Math.abs(effect.dy))
    }
  }
  return Math.ceil(sigma * 3) + offset
}

/** Parses a CML node `filter` attribute into a bounded effect chain. */
export function parseFilterAttribute(value: string): NodeEffect[] {
  const effects: NodeEffect[] = []
  const pattern = /([a-z-]+)\s*\(([^)]*)\)/g
  let consumed = 0
  for (const match of value.matchAll(pattern)) {
    const leading = value.slice(consumed, match.index ?? consumed)
    if (leading.trim()) throw new Error(`filter attribute contains unexpected text: ${leading.trim()}`)
    consumed = (match.index ?? 0) + match[0].length
    const name = match[1]!
    const args = (match[2] ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
    const numbers = () => {
      const parsed = args.slice(0, 3).map((item) => Number(item))
      if (parsed.some((item) => !Number.isFinite(item))) throw new Error(`filter ${name}() expects numeric arguments`)
      return parsed as [number, number, number]
    }
    switch (name) {
      case "blur": {
        if (args.length !== 1) throw new Error("filter blur() takes exactly one radius")
        effects.push({ type: "blur", radius: numbers()[0] })
        break
      }
      case "drop-shadow": {
        if (args.length !== 3 && args.length !== 4) throw new Error("filter drop-shadow() takes dx, dy, radius and an optional color")
        const [dx, dy, radius] = numbers()
        const color = args[3]
        if (color !== undefined && !HEX_COLOR.test(color)) throw new Error("filter drop-shadow() color must be #RRGGBB or #RRGGBBAA")
        effects.push({ type: "drop-shadow", dx, dy, radius, ...(color ? { color } : {}) })
        break
      }
      case "brightness":
      case "contrast":
      case "saturate": {
        if (args.length !== 1) throw new Error(`filter ${name}() takes exactly one amount`)
        effects.push({ type: "color-adjust", [name]: numbers()[0] } as NodeEffect)
        break
      }
      case "hue-rotate": {
        if (args.length !== 1) throw new Error("filter hue-rotate() takes exactly one degree value")
        effects.push({ type: "color-adjust", hueRotate: numbers()[0] })
        break
      }
      case "grain": {
        if (args.length > 2) throw new Error("filter grain() takes an optional amount and size")
        const values = args.map((item) => Number(item))
        if (values.some((item) => !Number.isFinite(item))) throw new Error("filter grain() expects numeric arguments")
        effects.push({ type: "grain", ...(values[0] !== undefined ? { amount: values[0] } : {}), ...(values[1] !== undefined ? { size: values[1] } : {}) })
        break
      }
      case "vignette": {
        if (args.length > 2) throw new Error("filter vignette() takes an optional strength and radius")
        const values = args.map((item) => Number(item))
        if (values.some((item) => !Number.isFinite(item))) throw new Error("filter vignette() expects numeric arguments")
        effects.push({ type: "vignette", ...(values[0] !== undefined ? { strength: values[0] } : {}), ...(values[1] !== undefined ? { radius: values[1] } : {}) })
        break
      }
      default:
        throw new Error(`unsupported filter function ${name}() (allowed: blur, drop-shadow, brightness, contrast, saturate, hue-rotate, grain, vignette)`)
    }
  }
  const remainder = value.slice(consumed).trim()
  if (remainder) throw new Error(`filter attribute contains unexpected text: ${remainder}`)
  if (!effects.length) throw new Error("filter attribute needs at least one effect function")
  return effects
}

/** CSS filter chain for the Canvas backend; empty string when no effects apply. */
export function canvasFilterValue(effects: readonly NodeEffect[] | undefined): string {
  if (!effects?.length) return ""
  return effects
    .map((effect) => {
      if (effect.type === "blur") return `blur(${effect.radius}px)`
      if (effect.type === "drop-shadow") {
        const color = effect.color ?? "#000000"
        return `drop-shadow(${effect.dx}px ${effect.dy}px ${effect.radius}px ${rgba(color)})`
      }
      const parts: string[] = []
      if (effect.type !== "color-adjust") return ""
      if (effect.brightness !== undefined) parts.push(`brightness(${effect.brightness})`)
      if (effect.contrast !== undefined) parts.push(`contrast(${effect.contrast})`)
      if (effect.saturate !== undefined) parts.push(`saturate(${effect.saturate})`)
      if (effect.hueRotate !== undefined) parts.push(`hue-rotate(${effect.hueRotate}deg)`)
      return parts.join(" ")
    })
    .filter(Boolean)
    .join(" ")
    .trim()
}

function rgba(color: string) {
  const hex = color.slice(1)
  const expanded = hex.length === 6 ? hex : hex.slice(0, 6)
  const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
  const channel = (value: string) => Number.parseInt(value, 16)
  return `rgba(${channel(expanded.slice(0, 2))}, ${channel(expanded.slice(2, 4))}, ${channel(expanded.slice(4, 6))}, ${alpha})`
}

/** 3x3 saturate matrix (SVG feColorMatrix type="saturate"). */
function saturateMatrix(s: number): number[] {
  return [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]
}

/** 3x3 hue-rotate matrix (SVG feColorMatrix type="hueRotate", degrees). */
function hueRotateMatrix(degrees: number): number[] {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [
    0.213 + cos * 0.787 - sin * 0.213,
    0.715 - cos * 0.715 - sin * 0.715,
    0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143,
    0.715 + cos * 0.285 + sin * 0.14,
    0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787,
    0.715 - cos * 0.715 + sin * 0.715,
    0.072 + cos * 0.928 + sin * 0.072,
  ]
}

function multiply3x3(left: number[], right: number[]): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      for (let k = 0; k < 3; k++) out[row * 3 + column]! += left[row * 3 + k]! * right[k * 3 + column]!
  return out
}

/**
 * Combined 4x5 feColorMatrix values for one color-adjust effect (brightness,
 * contrast, saturate, hueRotate composed in that fixed order). Alpha passes
 * through unchanged. Returns undefined when nothing is configured.
 */
export function colorAdjustMatrix(effect: Extract<NodeEffect, { type: "color-adjust" }>): string | undefined {
  const hasAny =
    effect.brightness !== undefined || effect.contrast !== undefined || effect.saturate !== undefined || effect.hueRotate !== undefined
  if (!hasAny) return undefined
  let matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  let offset = [0, 0, 0]
  // Compose the new linear op (m, o) after the current one:
  // out = m * (matrix * v + offset) + o = (m*matrix) * v + (m*offset + o).
  const applyLinear = (m: number[], o: number[]) => {
    matrix = multiply3x3(m, matrix)
    offset = [
      m[0]! * offset[0]! + m[1]! * offset[1]! + m[2]! * offset[2]! + o[0]!,
      m[3]! * offset[0]! + m[4]! * offset[1]! + m[5]! * offset[2]! + o[1]!,
      m[6]! * offset[0]! + m[7]! * offset[1]! + m[8]! * offset[2]! + o[2]!,
    ]
  }
  if (effect.brightness !== undefined) {
    const b = effect.brightness
    applyLinear([b, 0, 0, 0, b, 0, 0, 0, b], [0, 0, 0])
  }
  if (effect.contrast !== undefined) {
    const c = effect.contrast
    applyLinear([c, 0, 0, 0, c, 0, 0, 0, c], [0.5 - 0.5 * c, 0.5 - 0.5 * c, 0.5 - 0.5 * c])
  }
  if (effect.saturate !== undefined) applyLinear(saturateMatrix(effect.saturate), [0, 0, 0])
  if (effect.hueRotate !== undefined) applyLinear(hueRotateMatrix(effect.hueRotate), [0, 0, 0])
  const rows = [0, 1, 2].map((row) => {
    const values = [matrix[row * 3]!, matrix[row * 3 + 1]!, matrix[row * 3 + 2]!, 0, offset[row]!]
    return values.map((value) => Number(value.toFixed(6)).toString())
  })
  rows.push(["0", "0", "0", "1", "0"])
  return rows.map((row) => row.join(" ")).join(" ")
}

interface EffectPrimitive {
  tag: string
  attributes: Record<string, string>
}

/** Ordered SVG filter primitives for one effect chain. */
export function effectPrimitives(effects: readonly NodeEffect[]): EffectPrimitive[] {
  const primitives: EffectPrimitive[] = []
  for (const effect of effects) {
    if (effect.type === "blur") {
      primitives.push({ tag: "feGaussianBlur", attributes: { stdDeviation: String(effect.radius) } })
      continue
    }
    if (effect.type === "drop-shadow") {
      const color = effect.color ?? "#000000"
      const hex = color.slice(1)
      primitives.push({
        tag: "feDropShadow",
        attributes: {
          dx: String(effect.dx),
          dy: String(effect.dy),
          stdDeviation: String(effect.radius),
          "flood-color": `#${hex.slice(0, 6)}`,
          "flood-opacity": hex.length === 8 ? String(Number.parseInt(hex.slice(6, 8), 16) / 255) : "1",
        },
      })
      continue
    }
    if (effect.type === "grain") {
      const amount = Math.max(0, Math.min(1, effect.amount ?? 0.35))
      const size = Math.max(1, Math.min(8, Math.round(effect.size ?? 2)))
      const seed = Math.max(0, Math.min(2147483647, Math.round(effect.seed ?? 7)))
      const frequency = (0.9 / size).toFixed(4)
      primitives.push({ tag: "feTurbulence", attributes: { type: "fractalNoise", baseFrequency: frequency, numOctaves: "2", seed: String(seed), result: "coenx-grain-noise" } })
      primitives.push({
        tag: "feColorMatrix",
        attributes: {
          in: "coenx-grain-noise",
          type: "matrix",
          values: `0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 ${(0.2126 * amount).toFixed(5)} ${(0.7152 * amount).toFixed(5)} ${(0.0722 * amount).toFixed(5)} 0 0`,
          result: "coenx-grain-layer",
        },
      })
      primitives.push({ tag: "feComposite", attributes: { in: "coenx-grain-layer", in2: "SourceGraphic", operator: "over" } })
      continue
    }
    if (effect.type === "vignette") continue
    const values = colorAdjustMatrix(effect)
    if (values) primitives.push({ tag: "feColorMatrix", attributes: { type: "matrix", values } })
  }
  return primitives
}

/**
 * Static-SVG `<filter>` definition. The region is userSpaceOnUse and padded
 * in node-local coordinates so blur and shadow output are not clipped by the
 * default -10%..120% region.
 */
export function svgFilterDefinition(effects: readonly NodeEffect[], id: string, width: number, height: number, pad: number): string {
  const primitives = effectPrimitives(effects)
  const body = primitives
    .map((primitive) => {
      const attributes = Object.entries(primitive.attributes)
        .map(([key, value]) => ` ${key}="${value}"`)
        .join("")
      return `<${primitive.tag}${attributes}/>`
    })
    .join("")
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${-width / 2 - pad}" y="${-height / 2 - pad}" width="${width + pad * 2}" height="${height + pad * 2}">${body}</filter>`
}

/** Serializes effects for the native renderer payload (plain JSON values). */
export function nativeEffectsPayload(effects: readonly NodeEffect[] | undefined):
  | Array<Record<string, unknown>>
  | undefined {
  if (!effects?.length) return undefined
  return effects.map((effect) => {
    if (effect.type === "blur") return { type: "blur", radius: effect.radius }
    if (effect.type === "drop-shadow")
      return { type: "drop-shadow", dx: effect.dx, dy: effect.dy, radius: effect.radius, color: effect.color ?? "#000000" }
    if (effect.type === "grain")
      return {
        type: "grain",
        amount: Math.max(0, Math.min(1, effect.amount ?? 0.35)),
        size: Math.max(1, Math.min(8, Math.round(effect.size ?? 2))),
        seed: Math.max(0, Math.min(2147483647, Math.round(effect.seed ?? 7))),
      }
    if (effect.type === "vignette")
      return {
        type: "vignette",
        strength: Math.max(0, Math.min(1, effect.strength ?? 0.5)),
        radius: Math.max(0, Math.min(1, effect.radius ?? 0.7)),
      }
    return {
      type: "color-adjust",
      brightness: effect.brightness,
      contrast: effect.contrast,
      saturate: effect.saturate,
      hueRotate: effect.hueRotate,
    }
  })
}

/**
 * True when a node effect chain degrades on the Canvas backend because
 * CSS filter chaining is unavailable. Callers surface this as an explicit
 * partial-capability warning (never a silent drop).
 */
export function canvasFilterUnsupportedWarning(effects: readonly NodeEffect[] | undefined, supported: boolean): string | undefined {
  if (supported || !effects?.length) return undefined
  return `Canvas backend cannot apply ${effects.length} filter effect(s): CSS filter chaining is unavailable in this browser and the effects would be lost`
}
