import { describe, expect, test } from "bun:test"
import type { ChatUIPlatformerComponent } from "@diveeoi/db/chat-ui"
import { createPlatformerState, simulatePlatformer } from "./rich-ui-platformer-engine"

function makeLevel(overrides: Partial<ChatUIPlatformerComponent> = {}): ChatUIPlatformerComponent {
  return {
    type: "platformer",
    title: "Test level",
    theme: "neon",
    width: 800,
    height: 450,
    player: { x: 20, y: 328, width: 24, height: 32 },
    platforms: [{ id: "ground", x: 0, y: 360, width: 800, height: 90 }],
    hazards: [],
    collectibles: [],
    checkpoints: [],
    goal: { x: 740, y: 300, width: 24, height: 60 },
    physics: {
      moveSpeed: 5.2,
      gravity: 0.82,
      jumpVelocity: 14.5,
      maxLives: 3,
      doubleJump: true,
      dash: true,
    },
    ...overrides,
  }
}

describe("Rich UI platformer engine", () => {
  test("moves, lands, and collects crystals", () => {
    const spec = makeLevel({ collectibles: [{ id: "crystal", x: 70, y: 344 }] })
    const start = createPlatformerState(spec)
    expect(start.grounded).toBe(true)

    const moved = simulatePlatformer(spec, start, "right", 8)
    expect(moved.x).toBeGreaterThan(start.x)
    expect(moved.grounded).toBe(true)
    expect(moved.collected).toEqual(["crystal"])
  })

  test("supports a double jump and a directional dash", () => {
    const spec = makeLevel()
    const start = createPlatformerState(spec)
    const firstJump = simulatePlatformer(spec, start, "jump", 1)
    expect(firstJump.grounded).toBe(false)
    expect(firstJump.doubleJumpReady).toBe(true)

    const secondJump = simulatePlatformer(spec, firstJump, "jump", 1)
    expect(secondJump.doubleJumpReady).toBe(false)
    expect(secondJump.velocityY).toBeLessThan(0)

    const dash = simulatePlatformer(spec, firstJump, "dash", 5)
    expect(dash.x - start.x).toBeGreaterThan(spec.physics.moveSpeed * 5)
    expect(dash.dashReady).toBe(false)
  })

  test("activates a checkpoint and respawns there after a hazard collision", () => {
    const spec = makeLevel({
      checkpoints: [{ id: "midpoint", x: 120, y: 360 }],
      hazards: [{ id: "spikes", x: 150, y: 330, width: 36, height: 30 }],
    })
    const start = createPlatformerState(spec)
    const checkpointReached = simulatePlatformer(spec, start, "right", 16)
    expect(checkpointReached.checkpointID).toBe("midpoint")

    const respawned = simulatePlatformer(spec, checkpointReached, "right", 16)
    expect(respawned.deaths).toBe(1)
    expect(respawned.x).toBe(120)
    expect(respawned.y).toBe(328)
    expect(respawned.gameOver).toBe(false)
  })

  test("ends the level when the player reaches the goal and stops after game over", () => {
    const spec = makeLevel({ goal: { x: 180, y: 300, width: 30, height: 60 } })
    let game = createPlatformerState(spec)
    game = simulatePlatformer(spec, game, "right", 16)
    game = simulatePlatformer(spec, game, "right", 16)
    expect(game.won).toBe(true)
    expect(simulatePlatformer(spec, game, "left", 8)).toBe(game)

    const dangerous = makeLevel({
      physics: { ...spec.physics, maxLives: 1 },
      hazards: [{ id: "spikes", x: 40, y: 330, width: 30, height: 30 }],
    })
    const failed = simulatePlatformer(dangerous, createPlatformerState(dangerous), "right", 8)
    expect(failed.gameOver).toBe(true)
    expect(failed.deaths).toBe(1)
    expect(simulatePlatformer(dangerous, failed, "right", 8)).toBe(failed)
  })
})
