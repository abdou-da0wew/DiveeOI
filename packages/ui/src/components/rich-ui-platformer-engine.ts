import type { ChatUIPlatformerComponent } from "@diveeoi/db/chat-ui"

export type PlatformerAction = "left" | "right" | "jump" | "jump-left" | "jump-right" | "dash" | "wait"

export type PlatformerGameState = {
  x: number
  y: number
  velocityY: number
  grounded: boolean
  doubleJumpReady: boolean
  dashReady: boolean
  facing: 1 | -1
  collected: string[]
  checkpointID?: string
  deaths: number
  won: boolean
  gameOver: boolean
}

type Rect = { x: number; y: number; width: number; height: number }

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y

const playerRect = (spec: ChatUIPlatformerComponent, state: PlatformerGameState): Rect => ({
  x: state.x,
  y: state.y,
  width: spec.player.width,
  height: spec.player.height,
})

const checkpointPosition = (spec: ChatUIPlatformerComponent, checkpointID?: string) => {
  const point = spec.checkpoints.find((item) => item.id === checkpointID)
  return point
    ? { x: point.x, y: point.y - spec.player.height }
    : { x: spec.player.x, y: spec.player.y }
}

export function createPlatformerState(spec: ChatUIPlatformerComponent): PlatformerGameState {
  const grounded = spec.platforms.some(
    (platform) =>
      spec.player.x + spec.player.width > platform.x &&
      spec.player.x < platform.x + platform.width &&
      Math.abs(spec.player.y + spec.player.height - platform.y) <= 2,
  )
  return {
    x: spec.player.x,
    y: spec.player.y,
    velocityY: 0,
    grounded,
    doubleJumpReady: false,
    dashReady: true,
    facing: 1,
    collected: [],
    deaths: 0,
    won: false,
    gameOver: false,
  }
}

export function simulatePlatformer(
  spec: ChatUIPlatformerComponent,
  previous: PlatformerGameState,
  action: PlatformerAction,
  frameCount: number,
): PlatformerGameState {
  if (previous.won || previous.gameOver) return previous

  let { x, y, velocityY, grounded, doubleJumpReady, dashReady, facing } = previous
  let collected = [...previous.collected]
  let checkpointID = previous.checkpointID
  let deaths = previous.deaths
  let won = false
  let dashFrames = 0

  if (action === "left" || action === "jump-left") facing = -1
  if (action === "right" || action === "jump-right") facing = 1

  if (action === "jump" || action === "jump-left" || action === "jump-right") {
    if (grounded) {
      velocityY = -spec.physics.jumpVelocity
      grounded = false
      doubleJumpReady = spec.physics.doubleJump
    } else if (doubleJumpReady) {
      velocityY = -spec.physics.jumpVelocity * 0.86
      doubleJumpReady = false
    }
  }

  if (action === "dash" && spec.physics.dash && dashReady) {
    dashFrames = 5
    dashReady = false
  }

  const steps = Math.max(1, Math.min(16, Math.floor(frameCount)))
  for (let frame = 0; frame < steps; frame++) {
    const oldBottom = y + spec.player.height
    const horizontalSpeed = dashFrames > 0 ? spec.physics.moveSpeed * 2.35 : spec.physics.moveSpeed
    const direction = action === "left" || action === "jump-left" ? -1 : action === "right" || action === "jump-right" ? 1 : 0
    const dx = dashFrames > 0 ? facing * horizontalSpeed : direction * horizontalSpeed
    x = Math.max(0, Math.min(spec.width - spec.player.width, x + dx))
    if (dashFrames > 0) dashFrames--

    velocityY = Math.min(18, velocityY + spec.physics.gravity)
    y += velocityY
    grounded = false

    if (velocityY >= 0) {
      for (const platform of spec.platforms) {
        const horizontalOverlap = x + spec.player.width > platform.x && x < platform.x + platform.width
        const crossedTop = oldBottom <= platform.y + 2 && y + spec.player.height >= platform.y
        if (horizontalOverlap && crossedTop) {
          y = platform.y - spec.player.height
          velocityY = 0
          grounded = true
          doubleJumpReady = false
          dashReady = true
          break
        }
      }
    }

    const currentPlayer = playerRect(spec, { ...previous, x, y })
    const hitHazard = spec.hazards.some((hazard) => intersects(currentPlayer, hazard))
    const fell = y > spec.height + 80
    if (hitHazard || fell) {
      deaths++
      if (deaths >= spec.physics.maxLives) {
        return { ...previous, deaths, gameOver: true }
      }
      const spawn = checkpointPosition(spec, checkpointID)
      return {
        ...previous,
        x: spawn.x,
        y: spawn.y,
        velocityY: 0,
        grounded: false,
        doubleJumpReady: false,
        dashReady: true,
        facing,
        collected,
        checkpointID,
        deaths,
      }
    }

    for (const collectible of spec.collectibles) {
      if (collected.includes(collectible.id)) continue
      const centerX = x + spec.player.width / 2
      const centerY = y + spec.player.height / 2
      if (Math.hypot(centerX - collectible.x, centerY - collectible.y) < 20) {
        collected.push(collectible.id)
      }
    }

    for (const checkpoint of spec.checkpoints) {
      const marker: Rect = { x: checkpoint.x - 7, y: checkpoint.y - 18, width: 28, height: 36 }
      if (intersects(currentPlayer, marker)) checkpointID = checkpoint.id
    }

    if (intersects(currentPlayer, spec.goal)) {
      won = true
      break
    }
  }

  return {
    ...previous,
    x,
    y,
    velocityY,
    grounded,
    doubleJumpReady,
    dashReady,
    facing,
    collected,
    checkpointID,
    deaths,
    won,
    gameOver: false,
  }
}
