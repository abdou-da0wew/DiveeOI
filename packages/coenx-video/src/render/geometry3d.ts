import type { Camera3D, Light3D, Mesh3DNode, Vec3 } from "../model/types"
import { add3, cross3, dot3, normalize3, rotateEuler3, scale3, sub3 } from "./math3d"
import { shadeMeshColor } from "./lighting3d"

export interface ProjectedFace {
  points: Array<readonly [number, number]>
  depth: number
  fill: string
  stroke?: string
}

interface WorldVertex {
  position: Vec3
  normal: Vec3
}

function morphVertices(node: Mesh3DNode): Vec3[] {
  return node.vertices.map((vertex, index) => {
    let result: Vec3 = vertex
    for (const target of node.morphTargets ?? []) {
      const weight = Math.max(-1, Math.min(1, node.morphWeights?.[target.name] ?? 0))
      const targetVertex = target.vertices[index]
      if (!targetVertex || weight === 0) continue
      result = add3(result, scale3(sub3(targetVertex, vertex), weight))
    }
    return result
  })
}

function buildWorldVertices(node: Mesh3DNode): WorldVertex[] {
  const rotation = node.rotation3d ?? [0, 0, 0]
  const scale = node.scale3d ?? [1, 1, 1]
  const position = node.position ?? [0, 0, 0]
  const vertices = morphVertices(node).map((vertex) =>
    add3(rotateEuler3([vertex[0] * scale[0], vertex[1] * scale[1], vertex[2] * scale[2]], rotation), position),
  )
  const normals = vertices.map((): Vec3 => [0, 0, 0])

  for (const [a, b, c] of node.triangles) {
    const face = cross3(sub3(vertices[b], vertices[a]), sub3(vertices[c], vertices[a]))
    normals[a] = add3(normals[a], face)
    normals[b] = add3(normals[b], face)
    normals[c] = add3(normals[c], face)
  }
  return vertices.map((vertex, index) => ({ position: vertex, normal: normalize3(normals[index]) }))
}

function interpolateVertex(a: WorldVertex, b: WorldVertex, c: WorldVertex, u: number, v: number): WorldVertex {
  const w = 1 - u - v
  return {
    position: add3(add3(scale3(a.position, w), scale3(b.position, u)), scale3(c.position, v)),
    normal: normalize3(add3(add3(scale3(a.normal, w), scale3(b.normal, u)), scale3(c.normal, v))),
  }
}

function tessellateTriangle(a: WorldVertex, b: WorldVertex, c: WorldVertex, steps: number) {
  const point = (i: number, j: number) => interpolateVertex(a, b, c, i / steps, j / steps)
  const result: Array<[WorldVertex, WorldVertex, WorldVertex]> = []
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps - i; j++) {
      result.push([point(i, j), point(i + 1, j), point(i, j + 1)])
      if (i + j + 1 < steps) result.push([point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)])
    }
  }
  return result
}

export function projectMesh3D(
  node: Mesh3DNode,
  camera: Camera3D | undefined,
  viewport: { width: number; height: number },
  lights: Light3D[] = [],
): ProjectedFace[] {
  const view = camera ?? { position: [0, 0, 6] as Vec3, target: [0, 0, 0] as Vec3, fov: 55 }
  const forward = normalize3(sub3(view.target, view.position))
  const right = normalize3(cross3(forward, [0, 1, 0]))
  const up = normalize3(cross3(right, forward))
  const fov = ((view.fov ?? 55) * Math.PI) / 180
  const focal = (Math.min(viewport.width, viewport.height) * 0.5) / Math.tan(fov * 0.5)
  const near = view.near ?? 0.01
  const far = view.far ?? Number.POSITIVE_INFINITY
  const world = buildWorldVertices(node)
  const projected = world.map(({ position }) => {
    const relative = sub3(position, view.position)
    const depth = dot3(relative, forward)
    if (depth <= near || depth >= far) return undefined
    return {
      x: node.width / 2 + (dot3(relative, right) * focal) / depth,
      y: node.height / 2 - (dot3(relative, up) * focal) / depth,
      depth,
    }
  })

  const smooth = node.material?.shading === "smooth"
  const wireframe = node.material?.wireframe === true
  const steps = smooth && !wireframe ? 2 : 1
  const faces: ProjectedFace[] = []
  for (const [aIndex, bIndex, cIndex] of node.triangles) {
    const a = world[aIndex]
    const b = world[bIndex]
    const c = world[cIndex]
    if (!a || !b || !c) continue
    const pa = projected[aIndex]
    const pb = projected[bIndex]
    const pc = projected[cIndex]
    if (!pa || !pb || !pc) continue
    const faceNormal = normalize3(cross3(sub3(b.position, a.position), sub3(c.position, a.position)))
    const faceCenter = scale3(add3(add3(a.position, b.position), c.position), 1 / 3)
    const facing = dot3(faceNormal, normalize3(sub3(view.position, faceCenter)))
    if (!node.material?.doubleSided && facing <= 0) continue
    const normalA = smooth ? a.normal : faceNormal
    const normalB = smooth ? b.normal : faceNormal
    const normalC = smooth ? c.normal : faceNormal
    for (const [va, vb, vc] of tessellateTriangle(
      { ...a, normal: normalA },
      { ...b, normal: normalB },
      { ...c, normal: normalC },
      steps,
    )) {
      const project = (vertex: WorldVertex) => {
        const relative = sub3(vertex.position, view.position)
        const depth = dot3(relative, forward)
        return depth <= near || depth >= far
          ? undefined
          : {
              x: node.width / 2 + (dot3(relative, right) * focal) / depth,
              y: node.height / 2 - (dot3(relative, up) * focal) / depth,
              depth,
            }
      }
      const points = [project(va), project(vb), project(vc)]
      if (points.some((point) => !point)) continue
      const center = scale3(add3(add3(va.position, vb.position), vc.position), 1 / 3)
      const normal = normalize3(add3(add3(va.normal, vb.normal), vc.normal))
      const point = points as Array<{ x: number; y: number; depth: number }>
      faces.push({
        points: point.map(({ x, y }) => [x, y] as const),
        depth: (point[0].depth + point[1].depth + point[2].depth) / 3,
        fill: shadeMeshColor(node, center, normal, view.position, lights),
        ...(wireframe ? { stroke: node.stroke ?? node.color ?? "#172033" } : {}),
      })
    }
  }
  return faces.sort((a, b) => b.depth - a.depth)
}

export function boxMesh(size: Vec3 = [1, 1, 1]) {
  const [x, y, z] = size.map((value) => value / 2)
  return {
    vertices: [
      [-x, -y, -z],
      [x, -y, -z],
      [x, y, -z],
      [-x, y, -z],
      [-x, -y, z],
      [x, -y, z],
      [x, y, z],
      [-x, y, z],
    ] as Vec3[],
    triangles: [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
    ] as Array<readonly [number, number, number]>,
  }
}
