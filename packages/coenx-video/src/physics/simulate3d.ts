import type { Physics3DSettings, PhysicsBody3D, Vec3 } from "../model/types"
import { add3, clamp, dot3, normalize3, scale3, sub3 } from "../render/math3d"

const COMPONENTS_PER_BODY = 6
const ZERO: Vec3 = [0, 0, 0]

interface BodyState {
  definition: PhysicsBody3D
  position: Vec3
  velocity: Vec3
  rotation: Vec3
  angularVelocity: Vec3
  halfSize: Vec3
}

export interface Physics3DSimulation {
  frameCount: number
  bodyIndexes: Map<string, number>
  poses: Float32Array
}

export interface Physics3DSimulationOptions {
  dt?: number
  signal?: AbortSignal
}

function inverseMass(body: PhysicsBody3D) {
  return body.isStatic || body.mass <= 0 ? 0 : 1 / body.mass
}

function colliderExtents(state: BodyState): Vec3 {
  if (state.definition.collider !== "sphere") return state.halfSize
  const radius = Math.min(...state.definition.size) / 2
  return [radius, radius, radius]
}

function sphereBoxCollision(sphere: BodyState, box: BodyState, sphereIsA: boolean) {
  const delta = sub3(sphere.position, box.position)
  const closest: Vec3 = [
    clamp(sphere.position[0], box.position[0] - box.halfSize[0], box.position[0] + box.halfSize[0]),
    clamp(sphere.position[1], box.position[1] - box.halfSize[1], box.position[1] + box.halfSize[1]),
    clamp(sphere.position[2], box.position[2] - box.halfSize[2], box.position[2] + box.halfSize[2]),
  ]
  const toBox = sub3(closest, sphere.position)
  const distance = Math.hypot(...toBox)
  const radius = Math.min(...sphere.definition.size) / 2
  if (distance >= radius) return undefined

  let normal: Vec3
  let overlap: number
  if (distance > 1e-8) {
    const sphereToBox = scale3(toBox, 1 / distance)
    normal = sphereIsA ? sphereToBox : scale3(sphereToBox, -1)
    overlap = radius - distance
  } else {
    const faceDistances = [
      box.halfSize[0] - Math.abs(delta[0]),
      box.halfSize[1] - Math.abs(delta[1]),
      box.halfSize[2] - Math.abs(delta[2]),
    ]
    const axis =
      faceDistances[0] <= faceDistances[1] && faceDistances[0] <= faceDistances[2]
        ? 0
        : faceDistances[1] <= faceDistances[2]
          ? 1
          : 2
    const outward: [number, number, number] = [0, 0, 0]
    outward[axis] = Math.sign(delta[axis] || 1)
    normal = sphereIsA ? scale3(outward, -1) : outward
    overlap = radius + Math.max(0, faceDistances[axis])
  }
  return { normal, overlap }
}

function collisionNormal(a: BodyState, b: BodyState) {
  const delta = sub3(b.position, a.position)
  if (a.definition.collider === "sphere" && b.definition.collider === "sphere") {
    const radiusA = Math.min(...a.definition.size) / 2
    const radiusB = Math.min(...b.definition.size) / 2
    const distance = Math.hypot(...delta)
    const overlap = radiusA + radiusB - distance
    return overlap > 0
      ? { normal: distance > 1e-8 ? scale3(delta, 1 / distance) : ([1, 0, 0] as Vec3), overlap }
      : undefined
  }
  if (a.definition.collider === "sphere") return sphereBoxCollision(a, b, true)
  if (b.definition.collider === "sphere") return sphereBoxCollision(b, a, false)

  const overlap: Vec3 = [
    a.halfSize[0] + b.halfSize[0] - Math.abs(delta[0]),
    a.halfSize[1] + b.halfSize[1] - Math.abs(delta[1]),
    a.halfSize[2] + b.halfSize[2] - Math.abs(delta[2]),
  ]
  if (overlap.some((value) => value <= 0)) return undefined
  const axis = overlap[0] <= overlap[1] && overlap[0] <= overlap[2] ? 0 : overlap[1] <= overlap[2] ? 1 : 2
  const normal: [number, number, number] = [0, 0, 0]
  normal[axis] = Math.sign(delta[axis] || 1)
  return { normal, overlap: overlap[axis] }
}

function resolvePair(a: BodyState, b: BodyState) {
  const collision = collisionNormal(a, b)
  if (!collision) return
  const invA = inverseMass(a.definition)
  const invB = inverseMass(b.definition)
  const totalInverseMass = invA + invB
  if (totalInverseMass === 0) return

  const correction = Math.max(0, collision.overlap - 0.0005) / totalInverseMass
  a.position = sub3(a.position, scale3(collision.normal, correction * invA))
  b.position = add3(b.position, scale3(collision.normal, correction * invB))

  const relative = sub3(b.velocity, a.velocity)
  const normalSpeed = dot3(relative, collision.normal)
  if (normalSpeed >= 0) return
  const restitution = Math.min(a.definition.restitution ?? 0.35, b.definition.restitution ?? 0.35)
  const impulseMagnitude = (-(1 + restitution) * normalSpeed) / totalInverseMass
  const impulse = scale3(collision.normal, impulseMagnitude)
  a.velocity = sub3(a.velocity, scale3(impulse, invA))
  b.velocity = add3(b.velocity, scale3(impulse, invB))

  const afterImpulse = sub3(b.velocity, a.velocity)
  const tangentRaw = sub3(afterImpulse, scale3(collision.normal, dot3(afterImpulse, collision.normal)))
  const tangentLength = Math.hypot(...tangentRaw)
  if (tangentLength <= 1e-8) return
  const tangent = normalize3(tangentRaw)
  const friction = Math.sqrt((a.definition.friction ?? 0.18) * (b.definition.friction ?? 0.18))
  const frictionImpulse = clamp(
    -dot3(afterImpulse, tangent) / totalInverseMass,
    -impulseMagnitude * friction,
    impulseMagnitude * friction,
  )
  a.velocity = sub3(a.velocity, scale3(tangent, frictionImpulse * invA))
  b.velocity = add3(b.velocity, scale3(tangent, frictionImpulse * invB))
}

function applyBounds(state: BodyState, bounds: NonNullable<Physics3DSettings["bounds"]>) {
  if (inverseMass(state.definition) === 0) return
  const restitution = clamp(state.definition.restitution ?? 0.35, 0, 1)
  for (let axis = 0; axis < 3; axis++) {
    const extents = colliderExtents(state)
    const min = bounds.min[axis] + extents[axis]
    const max = bounds.max[axis] - extents[axis]
    if (state.position[axis] < min) {
      const position = [...state.position] as [number, number, number]
      const velocity = [...state.velocity] as [number, number, number]
      position[axis] = min
      velocity[axis] = Math.abs(velocity[axis]) * restitution
      state.position = position
      state.velocity = velocity
    } else if (state.position[axis] > max) {
      const position = [...state.position] as [number, number, number]
      const velocity = [...state.velocity] as [number, number, number]
      position[axis] = max
      velocity[axis] = -Math.abs(velocity[axis]) * restitution
      state.position = position
      state.velocity = velocity
    }
  }
}

function writeFrame(output: Float32Array, frame: number, states: BodyState[]) {
  states.forEach((state, index) => {
    const offset = (frame * states.length + index) * COMPONENTS_PER_BODY
    output.set(state.position, offset)
    output.set(state.rotation, offset + 3)
  })
}

export function simulatePhysics3D(
  settings: Physics3DSettings,
  frameCount: number,
  options: Physics3DSimulationOptions = {},
): Physics3DSimulation {
  if (!Number.isInteger(frameCount) || frameCount < 0 || frameCount > 36_000) {
    throw new Error("3D physics frame count must be between 0 and 36000")
  }
  const dt = options.dt ?? 1 / 30
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) throw new Error("3D physics dt must be in (0, 0.25]")
  const substeps = clamp(Math.floor(settings.substeps ?? 2), 1, 8)
  const gravity = settings.gravity ?? [0, -9.81, 0]
  const states = settings.bodies.map(
    (definition): BodyState => ({
      definition,
      position: definition.position ?? ZERO,
      velocity: definition.velocity,
      rotation: definition.rotation ?? ZERO,
      angularVelocity: definition.angularVelocity ?? ZERO,
      halfSize: scale3(definition.size, 0.5),
    }),
  )
  const bodyIndexes = new Map(states.map((state, index) => [state.definition.nodeId, index]))
  const poses = new Float32Array((frameCount + 1) * states.length * COMPONENTS_PER_BODY)
  writeFrame(poses, 0, states)
  const step = dt / substeps

  for (let frame = 1; frame <= frameCount; frame++) {
    if (options.signal?.aborted) throw new Error("3D physics simulation was cancelled")
    for (let substep = 0; substep < substeps; substep++) {
      for (const state of states) {
        if (inverseMass(state.definition) === 0) continue
        state.velocity = add3(state.velocity, scale3(gravity, step))
        state.position = add3(state.position, scale3(state.velocity, step))
        state.rotation = add3(state.rotation, scale3(state.angularVelocity, step))
        if (settings.bounds) applyBounds(state, settings.bounds)
      }
      const ordered = states
        .map((state) => ({
          state,
          minX: state.position[0] - colliderExtents(state)[0],
          maxX: state.position[0] + colliderExtents(state)[0],
        }))
        .sort((a, b) => a.minX - b.minX)
      for (let a = 0; a < ordered.length; a++) {
        for (let b = a + 1; b < ordered.length && ordered[b].minX <= ordered[a].maxX; b++) {
          resolvePair(ordered[a].state, ordered[b].state)
        }
      }
    }
    writeFrame(poses, frame, states)
  }
  return { frameCount, bodyIndexes, poses }
}

export function physics3DPoseAt(simulation: Physics3DSimulation, nodeId: string, frame: number) {
  const bodyIndex = simulation.bodyIndexes.get(nodeId)
  if (bodyIndex === undefined) return undefined
  const safeFrame = Math.max(0, Math.min(simulation.frameCount, Math.floor(frame)))
  const offset = (safeFrame * simulation.bodyIndexes.size + bodyIndex) * COMPONENTS_PER_BODY
  const values = simulation.poses
  return {
    position: [values[offset], values[offset + 1], values[offset + 2]] as Vec3,
    rotation: [values[offset + 3], values[offset + 4], values[offset + 5]] as Vec3,
  }
}
