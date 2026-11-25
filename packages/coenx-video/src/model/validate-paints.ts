import type { Scene } from "./types"

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/
const SPREADS = new Set(["pad", "repeat", "reflect"])

function add(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message)
}

/**
 * Scene-level reusable gradient paint resources (WP3). Nodes reference them
 * with { paintRef }; references are validated here and resolved by renderers.
 */
export function validateScenePaints(scene: Scene, issues: string[]) {
  const paints = scene.paints ?? []
  add(issues, paints.length <= 64, `scene ${scene.id} has more than 64 paint resources`)
  const ids = new Set<string>()
  for (const resource of paints) {
    add(issues, ID.test(resource.id), `scene ${scene.id} has an invalid paint resource id`)
    add(issues, !ids.has(resource.id), `scene ${scene.id} has duplicate paint resource ${resource.id}`)
    ids.add(resource.id)
    const paint = resource.paint as unknown as Record<string, unknown> | undefined
    add(issues, paint !== undefined && (paint.type === "linear" || paint.type === "radial"), `paint resource ${resource.id} must be a linear or radial gradient`)
    if (paint?.spread !== undefined) add(issues, SPREADS.has(paint.spread as string), `paint resource ${resource.id} spread must be pad, repeat or reflect`)
    const stops = Array.isArray(paint?.stops) ? (paint.stops as unknown[]) : []
    add(issues, stops.length >= 2 && stops.length <= 8, `paint resource ${resource.id} needs 2-8 stops`)
  }
  for (const node of scene.nodes) {
    if (node.kind !== "rect" && node.kind !== "ellipse" && node.kind !== "path" && node.kind !== "button") continue
    const fill = node.fill as unknown
    if (fill && typeof fill === "object" && "paintRef" in (fill as Record<string, unknown>)) {
      const ref = (fill as { paintRef: unknown }).paintRef
      add(issues, typeof ref === "string" && ids.has(ref), `node ${node.id} references missing paint resource ${String(ref)}`)
    }
  }
}
