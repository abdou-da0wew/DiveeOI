import type { PathCommand, PathFillRule, PathNode, Scene, VisualNode } from "../model/types"

export interface ResolvedPath {
  commands: PathCommand[]
  fillRule: PathFillRule
}

function point(value: readonly number[], width: number, height: number) {
  return [value[0] - width / 2, value[1] - height / 2] as const
}

function scaleCommands(commands: PathCommand[], scaleX: number, scaleY: number): PathCommand[] {
  const scalePoint = (value: readonly number[]) => [value[0] * scaleX, value[1] * scaleY] as const
  return commands.map((command) => {
    switch (command.type) {
      case "moveTo":
      case "lineTo":
        return { ...command, point: scalePoint(command.point) }
      case "quadraticTo":
        return { ...command, control: scalePoint(command.control), to: scalePoint(command.to) }
      case "cubicTo":
        return {
          ...command,
          control1: scalePoint(command.control1),
          control2: scalePoint(command.control2),
          to: scalePoint(command.to),
        }
      case "close":
        return command
    }
  })
}

export function resolveNodePath(node: PathNode, scene: Scene): ResolvedPath {
  if (node.commands) {
    return { commands: node.commands, fillRule: node.fillRule ?? "nonzero" }
  }
  if (!node.pathRef) throw new Error(`Path node ${node.id} has neither commands nor a path reference`)
  const definition = scene.pathDefinitions?.find((item) => item.id === node.pathRef)
  if (!definition) throw new Error(`Path node ${node.id} references missing path ${node.pathRef}`)
  return {
    commands: scaleCommands(definition.commands, node.width / definition.width, node.height / definition.height),
    fillRule: node.fillRule ?? definition.fillRule ?? "nonzero",
  }
}

export function resolveClipPath(node: VisualNode, scene: Scene): ResolvedPath | undefined {
  if (!node.clipPathId) return undefined
  const clip = scene.clipPaths?.find((item) => item.id === node.clipPathId)
  if (!clip) throw new Error(`Node ${node.id} references missing clip path ${node.clipPathId}`)
  const definition = scene.pathDefinitions?.find((item) => item.id === clip.pathId)
  if (!definition) throw new Error(`Clip path ${clip.id} references missing path ${clip.pathId}`)
  return {
    commands: scaleCommands(definition.commands, node.width / definition.width, node.height / definition.height),
    fillRule: clip.fillRule ?? definition.fillRule ?? "nonzero",
  }
}

export function pathCommandsToSvgD(commands: PathCommand[], width: number, height: number) {
  return commands
    .map((command) => {
      switch (command.type) {
        case "moveTo": {
          const [x, y] = point(command.point, width, height)
          return `M ${x} ${y}`
        }
        case "lineTo": {
          const [x, y] = point(command.point, width, height)
          return `L ${x} ${y}`
        }
        case "quadraticTo": {
          const [cx, cy] = point(command.control, width, height)
          const [x, y] = point(command.to, width, height)
          return `Q ${cx} ${cy} ${x} ${y}`
        }
        case "cubicTo": {
          const [c1x, c1y] = point(command.control1, width, height)
          const [c2x, c2y] = point(command.control2, width, height)
          const [x, y] = point(command.to, width, height)
          return `C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`
        }
        case "close":
          return "Z"
      }
    })
    .join(" ")
}
