import type { NodeEffect, Scene } from "./types"
import { effectPadding } from "../render/effects"

/**
 * Hard budgets for the WP4 bounded effect chain. Validation enforces every
 * bound before any renderer starts; renderers may additionally defend the
 * same limits defensively.
 */
export const EFFECT_BUDGETS = {
  /** Maximum effects in one node chain. */
  maxEffectsPerNode: 4,
  /** Maximum blur sigma (radius) in pixels. */
  maxBlurRadius: 64,
  /** Maximum drop-shadow blur sigma in pixels. */
  maxShadowRadius: 32,
  /** Maximum absolute drop-shadow offset per axis in pixels. */
  maxShadowOffset: 128,
  /** Maximum brightness multiplier (CSS brightness semantics). */
  maxBrightness: 4,
  /** Maximum contrast multiplier (CSS contrast semantics). */
  maxContrast: 4,
  /** Maximum saturate multiplier (CSS saturate semantics). */
  maxSaturate: 4,
  /** Maximum absolute hue-rotate degrees. */
  maxHueRotate: 360,
  /** Maximum padded effect-surface pixels per node (temporary surface budget). */
  maxEffectSurfacePixels: 8_388_608,
} as const

const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

function add(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message)
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/**
 * Pixel size of the padded temporary surface a node's effect chain needs.
 * Validation rejects chains whose padded surface exceeds the budget so no
 * backend can allocate an unbounded offscreen.
 */
export function effectSurfacePixels(width: number, height: number, effects: readonly NodeEffect[]): number {
  const pad = effectPadding(effects)
  return (width + pad * 2) * (height + pad * 2)
}

function validateEffect(nodeId: string, index: number, raw: unknown, width: number, height: number, issues: string[]) {
  const label = `node ${nodeId} effect[${index}]`
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    add(issues, false, `${label} is not an effect object`)
    return
  }
  const effect = raw as Record<string, unknown>
  switch (effect.type) {
    case "blur": {
      add(
        issues,
        finite(effect.radius) && (effect.radius as number) >= 0 && (effect.radius as number) <= EFFECT_BUDGETS.maxBlurRadius,
        `${label} blur radius must be between 0 and ${EFFECT_BUDGETS.maxBlurRadius}`,
      )
      break
    }
    case "drop-shadow": {
      add(
        issues,
        finite(effect.dx) && Math.abs(effect.dx as number) <= EFFECT_BUDGETS.maxShadowOffset,
        `${label} drop-shadow dx must be within ±${EFFECT_BUDGETS.maxShadowOffset}`,
      )
      add(
        issues,
        finite(effect.dy) && Math.abs(effect.dy as number) <= EFFECT_BUDGETS.maxShadowOffset,
        `${label} drop-shadow dy must be within ±${EFFECT_BUDGETS.maxShadowOffset}`,
      )
      add(
        issues,
        finite(effect.radius) && (effect.radius as number) >= 0 && (effect.radius as number) <= EFFECT_BUDGETS.maxShadowRadius,
        `${label} drop-shadow radius must be between 0 and ${EFFECT_BUDGETS.maxShadowRadius}`,
      )
      const color = effect.color
      if (color !== undefined)
        add(issues, typeof color === "string" && HEX_COLOR.test(color), `${label} drop-shadow color must be #RRGGBB or #RRGGBBAA`)
      break
    }
    case "color-adjust": {
      for (const [name, max] of [
        ["brightness", EFFECT_BUDGETS.maxBrightness],
        ["contrast", EFFECT_BUDGETS.maxContrast],
        ["saturate", EFFECT_BUDGETS.maxSaturate],
      ] as const) {
        const amount = effect[name]
        if (amount !== undefined)
          add(issues, finite(amount) && (amount as number) >= 0 && (amount as number) <= max, `${label} ${name} must be between 0 and ${max}`)
      }
      const hueRotate = effect.hueRotate
      if (hueRotate !== undefined)
        add(
          issues,
          finite(hueRotate) && Math.abs(hueRotate as number) <= EFFECT_BUDGETS.maxHueRotate,
          `${label} hueRotate must be within ±${EFFECT_BUDGETS.maxHueRotate} degrees`,
        )
      add(
        issues,
        effect.brightness !== undefined || effect.contrast !== undefined || effect.saturate !== undefined || effect.hueRotate !== undefined,
        `${label} color-adjust must set at least one of brightness, contrast, saturate or hueRotate`,
      )
      break
    }
    default:
      add(issues, false, `${label} has an unsupported effect type (allowed: blur, drop-shadow, color-adjust)`)
  }
}

/**
 * Validates every node effect chain in the scene: chain depth, per-effect
 * parameter bounds and the padded temporary-surface pixel budget. Mesh3d
 * nodes cannot carry effects (native output projects meshes to flat faces).
 */
export function validateSceneEffects(scene: Scene, issues: string[]) {
  for (const node of scene.nodes) {
    const effects = node.effects
    if (effects === undefined) continue
    add(issues, Array.isArray(effects) && effects.length > 0, `node ${node.id} effects must be a non-empty array when present`)
    if (!Array.isArray(effects)) continue
    add(
      issues,
      effects.length <= EFFECT_BUDGETS.maxEffectsPerNode,
      `node ${node.id} exceeds the ${EFFECT_BUDGETS.maxEffectsPerNode}-effect chain budget`,
    )
    add(issues, node.kind !== "mesh3d", `3D mesh node ${node.id} cannot carry filter effects`)
    effects.forEach((effect, index) => validateEffect(node.id, index, effect, node.width, node.height, issues))
    if (node.kind !== "mesh3d") {
      add(
        issues,
        effectSurfacePixels(node.width, node.height, effects) <= EFFECT_BUDGETS.maxEffectSurfacePixels,
        `node ${node.id} effect chain exceeds the ${EFFECT_BUDGETS.maxEffectSurfacePixels}-pixel temporary surface budget`,
      )
    }
  }
}
