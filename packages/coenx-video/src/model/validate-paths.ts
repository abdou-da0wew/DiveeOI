import type { Scene } from "./types"

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/
const FILL_RULES = new Set(["nonzero", "evenodd"])

function add(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message)
}

export function validatePathCommands(resourceId: string, value: unknown, issues: string[]) {
  const commands = Array.isArray(value) ? value : []
  add(issues, commands.length >= 2 && commands.length <= 256, `path ${resourceId} needs 2–256 commands`)
  const validPoint = (point: unknown) =>
    Array.isArray(point) &&
    point.length === 2 &&
    point.every(
      (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate) && Math.abs(coordinate) <= 16_384,
    )

  let started = false
  for (const raw of commands) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      add(issues, false, `path ${resourceId} contains an invalid command`)
      continue
    }
    const command = raw as Record<string, unknown>
    switch (command.type) {
      case "moveTo":
        add(issues, validPoint(command.point), `path ${resourceId} has an invalid move point`)
        started = true
        break
      case "lineTo":
        add(issues, started && validPoint(command.point), `path ${resourceId} has an invalid line point`)
        break
      case "quadraticTo":
        add(
          issues,
          started && validPoint(command.control) && validPoint(command.to),
          `path ${resourceId} has an invalid quadratic curve`,
        )
        break
      case "cubicTo":
        add(
          issues,
          started && validPoint(command.control1) && validPoint(command.control2) && validPoint(command.to),
          `path ${resourceId} has an invalid cubic curve`,
        )
        break
      case "close":
        add(issues, started, `path ${resourceId} closes before its first move`)
        break
      default:
        add(issues, false, `path ${resourceId} uses an unsupported command`)
    }
  }
  add(
    issues,
    commands[0] && (commands[0] as Record<string, unknown>).type === "moveTo",
    `path ${resourceId} must begin with moveTo`,
  )
}

export function validateScenePaths(scene: Scene, issues: string[]) {
  const definitions = scene.pathDefinitions ?? []
  const clips = scene.clipPaths ?? []
  add(issues, definitions.length <= 256, `scene ${scene.id} has more than 256 path definitions`)
  add(issues, clips.length <= 256, `scene ${scene.id} has more than 256 clip paths`)

  const pathIds = new Set<string>()
  let commandCount = 0
  for (const definition of definitions) {
    add(issues, ID.test(definition.id), `scene ${scene.id} has an invalid path definition id`)
    add(issues, !pathIds.has(definition.id), `scene ${scene.id} has duplicate path definition ${definition.id}`)
    pathIds.add(definition.id)
    add(
      issues,
      Number.isFinite(definition.width) && definition.width > 0 && definition.width <= 16_384,
      `path definition ${definition.id} has an invalid view-box width`,
    )
    add(
      issues,
      Number.isFinite(definition.height) && definition.height > 0 && definition.height <= 16_384,
      `path definition ${definition.id} has an invalid view-box height`,
    )
    if (definition.fillRule !== undefined) {
      add(issues, FILL_RULES.has(definition.fillRule), `path definition ${definition.id} has an invalid fill rule`)
    }
    commandCount += Array.isArray(definition.commands) ? definition.commands.length : 0
    validatePathCommands(definition.id, definition.commands, issues)
  }
  const clipIds = new Set<string>()
  for (const clip of clips) {
    add(issues, ID.test(clip.id), `scene ${scene.id} has an invalid clip path id`)
    add(issues, !clipIds.has(clip.id), `scene ${scene.id} has duplicate clip path ${clip.id}`)
    clipIds.add(clip.id)
    add(issues, pathIds.has(clip.pathId), `clip path ${clip.id} references missing path ${clip.pathId}`)
    if (clip.fillRule !== undefined) {
      add(issues, FILL_RULES.has(clip.fillRule), `clip path ${clip.id} has an invalid fill rule`)
    }
  }

  for (const node of scene.nodes) {
    if (node.kind === "path") {
      const hasCommands = node.commands !== undefined
      const hasReference = node.pathRef !== undefined
      add(issues, hasCommands !== hasReference, `path node ${node.id} must define commands or pathRef, but not both`)
      if (hasCommands) {
        commandCount += Array.isArray(node.commands) ? node.commands.length : 0
        validatePathCommands(node.id, node.commands, issues)
      }
      if (hasReference)
        add(issues, pathIds.has(node.pathRef!), `path node ${node.id} references missing path ${node.pathRef}`)
      if (node.fillRule !== undefined) {
        add(issues, FILL_RULES.has(node.fillRule), `path node ${node.id} has an invalid fill rule`)
      }
    }
    if (node.clipPathId !== undefined) {
      add(issues, clipIds.has(node.clipPathId), `node ${node.id} references missing clip path ${node.clipPathId}`)
      add(issues, node.kind !== "mesh3d", `3D mesh node ${node.id} cannot use a 2D clip path`)
    }
  }
  add(issues, commandCount <= 16_384, `scene ${scene.id} has too many path commands`)
}
