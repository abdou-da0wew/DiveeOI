import type { PhysicsSettings, Vec2 } from "../model/types"

export interface LivePhysicsPose {
  x: number
  y: number
  velocityX: number
  velocityY: number
}

export interface LiveCollisionEvent {
  a: string
  b: string
}

export interface LiveBodyGeometry {
  /** Node center coordinates (runtime x/y semantics). */
  x: number
  y: number
  width: number
  height: number
}

interface LiveBody {
  nodeId: string
  size: [number, number]
  invMass: number
  restitution: number
  isStatic: boolean
  /** Center position in stage coordinates. */
  position: [number, number]
  velocity: [number, number]
  /** Kinematic bodies follow drag targets and ignore gravity/collision impulses. */
  kinematic: boolean
  dragTarget?: Vec2
}

const MAX_VELOCITY = 4000
const MAX_DT = 0.1

function clampVelocity(velocity: [number, number]) {
  const speed = Math.hypot(velocity[0], velocity[1])
  if (speed <= MAX_VELOCITY) return
  const scale = MAX_VELOCITY / speed
  velocity[0] *= scale
  velocity[1] *= scale
}

/**
 * Live 2D physics world for the interactive player: bodies are simulated
 * frame-by-frame while the video plays, so clicks (impulse), drags (kinematic
 * throw) and collisions (interaction events) shape the motion in real time.
 *
 * Positions are stored as centers for correct collision math; poses() converts
 * back to the node top-left coordinates used by the renderers. Deterministic:
 * the caller drives fixed-dt steps, no internal randomness.
 */
export class LivePhysicsWorld {
  private readonly bodies = new Map<string, LiveBody>()
  private readonly gravity: [number, number]
  private readonly overlapping = new Set<string>()
  private readonly dragVelocity = new Map<string, Vec2>()

  constructor(settings: PhysicsSettings, geometry: Map<string, LiveBodyGeometry>) {
    this.gravity = (settings.gravity ?? [0, 980]) as [number, number]
    for (const spec of settings.bodies) {
      const node = geometry.get(spec.nodeId)
      const size = [spec.size?.[0] ?? node?.width ?? 40, spec.size?.[1] ?? node?.height ?? 40] as [number, number]
      const center = (spec.position ? [spec.position[0], spec.position[1]] : [node?.x ?? 0, node?.y ?? 0]) as [number, number]
      const mass = spec.isStatic || spec.mass <= 0 ? 0 : spec.mass
      this.bodies.set(spec.nodeId, {
        nodeId: spec.nodeId,
        size,
        invMass: mass === 0 ? 0 : 1 / mass,
        restitution: Math.max(0, Math.min(spec.restitution ?? 0.35, 1)),
        isStatic: spec.isStatic || mass === 0,
        position: center,
        velocity: [spec.velocity?.[0] ?? 0, spec.velocity?.[1] ?? 0] as [number, number],
        kinematic: false,
      })
    }
  }

  has(nodeId: string) {
    return this.bodies.has(nodeId)
  }

  applyImpulse(nodeId: string, vx: number, vy: number) {
    const body = this.bodies.get(nodeId)
    if (!body || body.isStatic || body.kinematic) return
    body.velocity[0] += vx
    body.velocity[1] += vy
    clampVelocity(body.velocity)
  }

  /** Begin dragging a body: it becomes kinematic and follows the pointer. */
  beginDrag(nodeId: string) {
    const body = this.bodies.get(nodeId)
    if (!body || body.isStatic) return
    body.kinematic = true
    body.dragTarget = undefined
    this.dragVelocity.set(nodeId, [0, 0] as [number, number])
  }

  /** Update the drag target (node center coordinates). */
  dragTo(nodeId: string, x: number, y: number) {
    const body = this.bodies.get(nodeId)
    if (!body?.kinematic) return
    body.dragTarget = [x, y] as [number, number]
  }

  /** End a drag: the body keeps the tracked fling velocity. */
  endDrag(nodeId: string) {
    const body = this.bodies.get(nodeId)
    if (!body?.kinematic) return
    body.kinematic = false
    body.dragTarget = undefined
    const velocity = this.dragVelocity.get(nodeId)
    if (velocity) {
      body.velocity = [velocity[0], velocity[1]] as [number, number]
      clampVelocity(body.velocity)
    }
    this.dragVelocity.delete(nodeId)
  }

  /** Advance the world by dt seconds; returns fresh collision pairs. */
  step(dt: number): LiveCollisionEvent[] {
    const stepDt = Math.max(0.0001, Math.min(dt, MAX_DT))
    for (const body of this.bodies.values()) {
      if (body.isStatic) continue
      if (body.kinematic && body.dragTarget) {
        const target = body.dragTarget
        body.velocity = [(target[0] - body.position[0]) / stepDt, (target[1] - body.position[1]) / stepDt]
        clampVelocity(body.velocity)
        body.position = [target[0], target[1]]
        this.dragVelocity.set(body.nodeId, [body.velocity[0], body.velocity[1]] as [number, number])
        continue
      }
      if (body.kinematic) continue
      body.velocity[0] += this.gravity[0] * stepDt
      body.velocity[1] += this.gravity[1] * stepDt
      clampVelocity(body.velocity)
      body.position[0] += body.velocity[0] * stepDt
      body.position[1] += body.velocity[1] * stepDt
    }
    return this.resolveCollisions()
  }

  /** Node center poses for bodies that moved (static bodies included when clean). */
  poses(): Map<string, LivePhysicsPose> {
    const output = new Map<string, LivePhysicsPose>()
    for (const body of this.bodies.values()) {
      output.set(body.nodeId, {
        x: body.position[0],
        y: body.position[1],
        velocityX: body.velocity[0],
        velocityY: body.velocity[1],
      })
    }
    return output
  }

  private pairKey(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`
  }

  private resolveCollisions(): LiveCollisionEvent[] {
    const list = [...this.bodies.values()]
    const events: LiveCollisionEvent[] = []
    const current = new Set<string>()
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        const collision = this.detect(a, b)
        const key = this.pairKey(a.nodeId, b.nodeId)
        if (!collision) continue
        current.add(key)
        if (!this.overlapping.has(key)) events.push({ a: a.nodeId, b: b.nodeId })
        this.separate(a, b, collision)
      }
    }
    this.overlapping.clear()
    for (const key of current) this.overlapping.add(key)
    return events
  }

  private detect(a: LiveBody, b: LiveBody) {
    const dx = b.position[0] - a.position[0]
    const dy = b.position[1] - a.position[1]
    const ra = Math.min(a.size[0], a.size[1]) / 2
    const rb = Math.min(b.size[0], b.size[1]) / 2
    const distance = Math.hypot(dx, dy)
    if (distance < ra + rb) {
      const length = Math.max(distance, 0.0001)
      return { nx: dx / length, ny: dy / length, overlap: ra + rb - distance }
    }
    const ox = (a.size[0] + b.size[0]) / 2 - Math.abs(dx)
    const oy = (a.size[1] + b.size[1]) / 2 - Math.abs(dy)
    if (ox > 0 && oy > 0) {
      return ox < oy
        ? { nx: Math.sign(dx || 1), ny: 0, overlap: ox }
        : { nx: 0, ny: Math.sign(dy || 1), overlap: oy }
    }
    return undefined
  }

  private separate(a: LiveBody, b: LiveBody, collision: { nx: number; ny: number; overlap: number }) {
    const invA = a.kinematic || a.isStatic ? 0 : a.invMass
    const invB = b.kinematic || b.isStatic ? 0 : b.invMass
    const total = invA + invB
    if (total > 0) {
      const correction = Math.max(0, collision.overlap - 0.01) / total
      a.position[0] -= collision.nx * correction * invA
      a.position[1] -= collision.ny * correction * invA
      b.position[0] += collision.nx * correction * invB
      b.position[1] += collision.ny * correction * invB
      const relative = (b.velocity[0] - a.velocity[0]) * collision.nx + (b.velocity[1] - a.velocity[1]) * collision.ny
      if (relative < 0) {
        const restitution = Math.min(a.kinematic ? 0.8 : a.restitution, b.kinematic ? 0.8 : b.restitution)
        const impulse = (-(1 + restitution) * relative) / total
        a.velocity[0] -= impulse * collision.nx * invA
        a.velocity[1] -= impulse * collision.ny * invA
        b.velocity[0] += impulse * collision.nx * invB
        b.velocity[1] += impulse * collision.ny * invB
        clampVelocity(a.velocity)
        clampVelocity(b.velocity)
      }
    }
  }
}
