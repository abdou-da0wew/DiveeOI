import type { PhysicsBody, PhysicsSettings, Vec2 } from "../model/types"

export interface PhysicsPose {
  nodeId: string
  x: number
  y: number
  velocityX: number
  velocityY: number
}

export interface PhysicsFrame {
  frame: number
  bodies: PhysicsPose[]
}

export interface PhysicsSimulationOptions {
  dt?: number
  preferNative?: boolean
  signal?: AbortSignal
}

function inverseMass(body: PhysicsBody) {
  return body.isStatic || body.mass <= 0 ? 0 : 1 / body.mass
}

function circleCollision(a: PhysicsBody, b: PhysicsBody, aPos: Vec2, bPos: Vec2) {
  const ra = Math.min(a.size[0], a.size[1]) / 2
  const rb = Math.min(b.size[0], b.size[1]) / 2
  const dx = bPos[0] - aPos[0]
  const dy = bPos[1] - aPos[1]
  const distance = Math.hypot(dx, dy)
  if (distance >= ra + rb) return undefined
  const length = Math.max(distance, 0.0001)
  return { nx: dx / length, ny: dy / length, overlap: ra + rb - distance }
}

function boxCollision(a: PhysicsBody, b: PhysicsBody, aPos: Vec2, bPos: Vec2) {
  const dx = bPos[0] - aPos[0]
  const dy = bPos[1] - aPos[1]
  const ox = (a.size[0] + b.size[0]) / 2 - Math.abs(dx)
  const oy = (a.size[1] + b.size[1]) / 2 - Math.abs(dy)
  if (ox <= 0 || oy <= 0) return undefined
  return ox < oy ? { nx: Math.sign(dx || 1), ny: 0, overlap: ox } : { nx: 0, ny: Math.sign(dy || 1), overlap: oy }
}

function resolvePair(a: PhysicsBody, b: PhysicsBody, positions: Map<string, Vec2>, velocities: Map<string, Vec2>) {
  const aPos = positions.get(a.nodeId)!
  const bPos = positions.get(b.nodeId)!
  const collision =
    a.collider === "circle" && b.collider === "circle"
      ? circleCollision(a, b, aPos, bPos)
      : boxCollision(a, b, aPos, bPos)
  if (!collision) return
  const invA = inverseMass(a)
  const invB = inverseMass(b)
  const total = invA + invB
  if (total === 0) return
  const correction = Math.max(0, collision.overlap - 0.001) / total
  positions.set(a.nodeId, [aPos[0] - collision.nx * correction * invA, aPos[1] - collision.ny * correction * invA])
  positions.set(b.nodeId, [bPos[0] + collision.nx * correction * invB, bPos[1] + collision.ny * correction * invB])
  const aVelocity = velocities.get(a.nodeId)!
  const bVelocity = velocities.get(b.nodeId)!
  const relative = (bVelocity[0] - aVelocity[0]) * collision.nx + (bVelocity[1] - aVelocity[1]) * collision.ny
  if (relative >= 0) return
  const restitution = Math.min(a.restitution ?? 0.2, b.restitution ?? 0.2)
  const impulse = (-(1 + restitution) * relative) / total
  velocities.set(a.nodeId, [aVelocity[0] - impulse * invA * collision.nx, aVelocity[1] - impulse * invA * collision.ny])
  velocities.set(b.nodeId, [bVelocity[0] + impulse * invB * collision.nx, bVelocity[1] + impulse * invB * collision.ny])
}

export function simulatePhysicsFallback(
  settings: PhysicsSettings,
  steps: number,
  dt = 1 / 30,
  signal?: AbortSignal,
): PhysicsFrame[] {
  const bodies = settings.bodies.map((body) => ({ ...body, velocity: [...body.velocity] as [number, number] }))
  const gravity = settings.gravity ?? [0, 980]
  const positions = new Map(bodies.map((body) => [body.nodeId, [...(body.position ?? [0, 0])] as [number, number]]))
  const velocities = new Map(bodies.map((body) => [body.nodeId, [...body.velocity] as [number, number]]))
  const output: PhysicsFrame[] = []

  for (let frame = 0; frame <= steps; frame++) {
    if (signal?.aborted) throw new Error("Physics simulation cancelled")
    output.push({
      frame,
      bodies: bodies.map((body) => {
        const [x, y] = positions.get(body.nodeId)!
        const [velocityX, velocityY] = velocities.get(body.nodeId)!
        return { nodeId: body.nodeId, x, y, velocityX, velocityY }
      }),
    })
    if (frame === steps) break
    for (const body of bodies) {
      if (body.isStatic) continue
      const velocity = velocities.get(body.nodeId)!
      velocity[0] += gravity[0] * dt
      velocity[1] += gravity[1] * dt
      const position = positions.get(body.nodeId)!
      position[0] += velocity[0] * dt
      position[1] += velocity[1] * dt
    }
    for (let left = 0; left < bodies.length; left++)
      for (let right = left + 1; right < bodies.length; right++)
        resolvePair(bodies[left], bodies[right], positions, velocities)
  }
  return output
}

export * as PhysicsWorld from "./world"
