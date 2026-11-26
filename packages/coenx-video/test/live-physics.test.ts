import { describe, expect, it } from "bun:test"
import { LivePhysicsWorld } from "../src/physics/live"
import type { PhysicsSettings } from "../src/model/types"

// Node coordinates are centers (runtime x/y semantics).
const GEOMETRY = new Map([
  ["ball", { x: 100, y: 70, width: 40, height: 40 }],
  ["floor", { x: 320, y: 340, width: 640, height: 40 }],
  ["box", { x: 400, y: 200, width: 60, height: 60 }],
])

const SETTINGS: PhysicsSettings = {
  gravity: [0, 500],
  bodies: [
    { nodeId: "ball", mass: 1, velocity: [0, 0], size: [40, 40], restitution: 0.5 },
    { nodeId: "floor", mass: 0, velocity: [0, 0], size: [640, 40], isStatic: true },
    { nodeId: "box", mass: 2, velocity: [0, 0], size: [60, 60] },
  ],
}

describe("live physics world", () => {
  it("falls under gravity and lands on a static floor with restitution", () => {
    const world = new LivePhysicsWorld(SETTINGS, GEOMETRY)
    // Ball center starts at (100, 70); floor center (320, 340) -> floor top edge at y=320.
    let landedFrame = -1
    let maxY = 0
    for (let frame = 0; frame < 900; frame++) {
      world.step(1 / 30)
      const pose = world.poses().get("ball")!
      if (pose.y + 20 >= 320 && landedFrame < 0) landedFrame = frame
      if (landedFrame >= 0) maxY = Math.max(maxY, pose.y)
    }
    expect(landedFrame).toBeGreaterThan(0)
    // The ball bounces but never falls through the floor (its center cannot pass 300).
    expect(maxY).toBeLessThanOrEqual(300.5)
    const pose = world.poses().get("ball")!
    expect(pose.y + 20).toBeGreaterThanOrEqual(319.9)
  })

  it("applies impulses that change the trajectory", () => {
    const world = new LivePhysicsWorld(SETTINGS, GEOMETRY)
    const before = world.poses().get("ball")!
    world.applyImpulse("ball", 300, -200)
    world.step(0.5)
    const after = world.poses().get("ball")!
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.velocityX).toBeGreaterThan(0)
    // Static bodies ignore impulses.
    world.applyImpulse("floor", 999, 999)
    const floor = world.poses().get("floor")!
    expect(floor.x).toBe(320)
    expect(floor.y).toBe(340)
  })

  it("emits collision events once per overlap and not repeatedly", () => {
    const world = new LivePhysicsWorld(
      {
        gravity: [0, 0],
        bodies: [
          { nodeId: "ball", mass: 1, velocity: [80, 0], size: [40, 40], position: [100, 100] },
          { nodeId: "box", mass: 1, velocity: [0, 0], size: [60, 60], position: [300, 100] },
        ],
      },
      GEOMETRY,
    )
    const events: string[] = []
    for (let frame = 0; frame < 200; frame++) {
      for (const event of world.step(1 / 30)) events.push(`${event.a}:${event.b}`)
    }
    expect(events.filter((event) => event === "ball:box").length).toBe(1)
    const ball = world.poses().get("ball")!
    const box = world.poses().get("box")!
    // The impact pushed both bodies: the box was pushed ahead of the ball.
    expect(box.x).toBeGreaterThan(300)
    expect(ball.x).toBeGreaterThan(100)
    expect(box.x).toBeGreaterThan(ball.x)
  })

  it("supports kinematic drag with fling velocity on release", () => {
    const world = new LivePhysicsWorld(
      {
        gravity: [0, 0],
        bodies: [{ nodeId: "ball", mass: 1, velocity: [0, 0], size: [40, 40] }],
      },
      GEOMETRY,
    )
    world.beginDrag("ball")
    const centers: Array<[number, number]> = [
      [100, 100],
      [140, 100],
      [180, 100],
      [220, 100],
    ]
    for (const [x, y] of centers) {
      world.dragTo("ball", x, y)
      world.step(1 / 30)
    }
    world.endDrag("ball")
    const pose = world.poses().get("ball")!
    expect(pose.x).toBe(220)
    // Fling velocity continues the motion in the same direction.
    world.step(0.1)
    const after = world.poses().get("ball")!
    expect(after.x).toBeGreaterThan(220)
    expect(after.velocityX).toBeGreaterThan(0)
  })

  it("keeps kinematic bodies from being pushed by gravity while dragged", () => {
    const world = new LivePhysicsWorld(SETTINGS, GEOMETRY)
    world.beginDrag("ball")
    world.dragTo("ball", 100, 100)
    world.step(1)
    const pose = world.poses().get("ball")!
    expect(pose.x).toBe(100)
    expect(pose.y).toBe(100)
  })

  it("resolves overlaps between two dynamic bodies without NaN", () => {
    const world = new LivePhysicsWorld(
      {
        gravity: [0, 0],
        bodies: [
          { nodeId: "ball", mass: 1, velocity: [50, 0], size: [40, 40], position: [100, 100] },
          { nodeId: "box", mass: 1, velocity: [-50, 0], size: [60, 60], position: [130, 100] },
        ],
      },
      GEOMETRY,
    )
    for (let frame = 0; frame < 60; frame++) world.step(1 / 30)
    const ball = world.poses().get("ball")!
    const box = world.poses().get("box")!
    expect(Number.isFinite(ball.x)).toBe(true)
    expect(Number.isFinite(box.x)).toBe(true)
    expect(ball.x).toBeLessThan(box.x)
  })
})
