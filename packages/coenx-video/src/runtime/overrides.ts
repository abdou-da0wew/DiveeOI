import type { VisualNode } from "../model/types"
import type { NodeOverride } from "../interactive/engine"

export type NodeOverrideMap = ReadonlyMap<string, NodeOverride>

/**
 * Applies concrete engine overrides (from `setNode` actions and live physics
 * poses) to an evaluated node. Overrides win over keyframe animation because
 * they represent "what the user did right now".
 */
export function applyNodeOverride<T extends VisualNode>(node: T, override: NodeOverride | undefined): T {
  if (!override) return node
  const next: T = { ...node }
  if (override.x !== undefined) next.x = Number(override.x)
  if (override.y !== undefined) next.y = Number(override.y)
  if (override.rotation !== undefined) next.rotation = Number(override.rotation)
  if (override.opacity !== undefined) next.opacity = Math.max(0, Math.min(1, Number(override.opacity)))
  if (override.scale !== undefined) {
    const scale = Math.max(0, Number(override.scale))
    next.scaleX = scale
    next.scaleY = scale
  }
  if (override.text !== undefined && "text" in node && typeof (node as { text?: unknown }).text === "string") {
    ;(next as unknown as { text: string }).text = String(override.text)
  }
  if (override.color !== undefined && "color" in node && typeof (node as { color?: unknown }).color === "string") {
    ;(next as unknown as { color: string }).color = String(override.color)
  }
  return next
}
