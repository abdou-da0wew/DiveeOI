import type { ChatUIPlatformerComponent, ParseResult } from "./chat-ui"

type Parsed<T> = ParseResult<T>
type RecordValue = Record<string, unknown>

const object = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined

const text = (value: unknown, field: string, max = 240): Parsed<string> =>
  typeof value === "string" && value.trim() && value.length <= max
    ? { ok: true, value: value.trim() }
    : { ok: false, error: `${field} must be a non-empty string of at most ${max} characters` }

const number = (value: unknown, field: string, min: number, max: number): Parsed<number> =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? { ok: true, value }
    : { ok: false, error: `${field} must be a finite number between ${min} and ${max}` }

const identifier = (value: unknown, field: string): Parsed<string> => {
  const parsed = text(value, field, 48)
  if (!parsed.ok) return parsed
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(parsed.value)
    ? parsed
    : { ok: false, error: `${field} must be a valid identifier` }
}

type Rect = { id: string; x: number; y: number; width: number; height: number }
type Point = { id: string; x: number; y: number }

function parseRect(raw: unknown, field: string, width: number, height: number): Parsed<Rect> {
  const input = object(raw)
  if (!input) return { ok: false, error: `${field} must be an object` }
  const id = identifier(input.id, `${field}.id`)
  const x = number(input.x, `${field}.x`, 0, width)
  const y = number(input.y, `${field}.y`, 0, height)
  const rectWidth = number(input.width, `${field}.width`, 1, width)
  const rectHeight = number(input.height, `${field}.height`, 1, height)
  if (!id.ok) return id
  if (!x.ok) return x
  if (!y.ok) return y
  if (!rectWidth.ok) return rectWidth
  if (!rectHeight.ok) return rectHeight
  if (x.value + rectWidth.value > width || y.value + rectHeight.value > height) {
    return { ok: false, error: `${field} must fit inside the world bounds` }
  }
  return {
    ok: true,
    value: { id: id.value, x: x.value, y: y.value, width: rectWidth.value, height: rectHeight.value },
  }
}

function parsePoint(raw: unknown, field: string, width: number, height: number): Parsed<Point> {
  const input = object(raw)
  if (!input) return { ok: false, error: `${field} must be an object` }
  const id = identifier(input.id, `${field}.id`)
  const x = number(input.x, `${field}.x`, 0, width)
  const y = number(input.y, `${field}.y`, 0, height)
  if (!id.ok) return id
  if (!x.ok) return x
  if (!y.ok) return y
  return { ok: true, value: { id: id.value, x: x.value, y: y.value } }
}

export function parseChatUIPlatformer(value: RecordValue): Parsed<ChatUIPlatformerComponent> | undefined {
  if (value.type !== "platformer") return undefined

  const title = text(value.title, "platformer.title", 120)
  const description =
    value.description === undefined || value.description === ""
      ? { ok: true as const, value: undefined }
      : text(value.description, "platformer.description", 400)
  const width = number(value.width, "platformer.width", 320, 1400)
  const height = number(value.height, "platformer.height", 240, 900)
  const theme = value.theme === undefined ? "neon" : value.theme

  if (!title.ok) return title
  if (!description.ok) return description
  if (!width.ok) return width
  if (!height.ok) return height
  if (!["neon", "sky", "forest"].includes(String(theme))) {
    return { ok: false, error: "Platformer theme must be neon, sky, or forest" }
  }

  const rawPlayer = object(value.player)
  if (!rawPlayer) return { ok: false, error: "platformer.player must be an object" }
  const playerX = number(rawPlayer.x, "platformer.player.x", 0, width.value)
  const playerY = number(rawPlayer.y, "platformer.player.y", 0, height.value)
  const playerWidth = number(rawPlayer.width, "platformer.player.width", 12, 64)
  const playerHeight = number(rawPlayer.height, "platformer.player.height", 16, 80)
  if (!playerX.ok) return playerX
  if (!playerY.ok) return playerY
  if (!playerWidth.ok) return playerWidth
  if (!playerHeight.ok) return playerHeight
  if (playerX.value + playerWidth.value > width.value || playerY.value + playerHeight.value > height.value) {
    return { ok: false, error: "platformer.player must fit inside the world bounds" }
  }

  const parseCollection = <T>(
    input: unknown,
    field: string,
    min: number,
    max: number,
    parser: (raw: unknown, field: string, width: number, height: number) => Parsed<T>,
  ): Parsed<T[]> => {
    if (!Array.isArray(input) || input.length < min || input.length > max) {
      return { ok: false, error: `${field} must contain between ${min} and ${max} items` }
    }
    const items: T[] = []
    for (const [index, raw] of input.entries()) {
      const result = parser(raw, `${field}[${index}]`, width.value, height.value)
      if (!result.ok) return result
      items.push(result.value)
    }
    return { ok: true, value: items }
  }

  const platforms = parseCollection(value.platforms, "platformer.platforms", 1, 20, parseRect)
  const hazards = parseCollection(value.hazards ?? [], "platformer.hazards", 0, 12, parseRect)
  const collectibles = parseCollection(value.collectibles ?? [], "platformer.collectibles", 0, 20, parsePoint)
  const checkpoints = parseCollection(value.checkpoints ?? [], "platformer.checkpoints", 0, 5, parsePoint)
  if (!platforms.ok) return platforms
  if (!hazards.ok) return hazards
  if (!collectibles.ok) return collectibles
  if (!checkpoints.ok) return checkpoints
  for (const checkpoint of checkpoints.value) {
    if (checkpoint.x + playerWidth.value > width.value || checkpoint.y < playerHeight.value) {
      return { ok: false, error: `Checkpoint ${checkpoint.id} must provide a valid player respawn position` }
    }
  }

  const ids = [
    ...platforms.value.map((item) => item.id),
    ...hazards.value.map((item) => item.id),
    ...collectibles.value.map((item) => item.id),
    ...checkpoints.value.map((item) => item.id),
  ]
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "Platformer entity IDs must be unique" }
  }

  const goalInput = object(value.goal)
  if (!goalInput) return { ok: false, error: "platformer.goal must be an object" }
  const goalX = number(goalInput.x, "platformer.goal.x", 0, width.value)
  const goalY = number(goalInput.y, "platformer.goal.y", 0, height.value)
  const goalWidth = number(goalInput.width, "platformer.goal.width", 8, width.value)
  const goalHeight = number(goalInput.height, "platformer.goal.height", 8, height.value)
  if (!goalX.ok) return goalX
  if (!goalY.ok) return goalY
  if (!goalWidth.ok) return goalWidth
  if (!goalHeight.ok) return goalHeight
  if (goalX.value + goalWidth.value > width.value || goalY.value + goalHeight.value > height.value) {
    return { ok: false, error: "platformer.goal must fit inside the world bounds" }
  }

  if (value.physics !== undefined && !object(value.physics)) {
    return { ok: false, error: "platformer.physics must be an object" }
  }
  const rawPhysics = object(value.physics) ?? {}
  const moveSpeed = rawPhysics.moveSpeed === undefined ? 5.2 : number(rawPhysics.moveSpeed, "platformer.physics.moveSpeed", 1, 12)
  const gravity = rawPhysics.gravity === undefined ? 0.82 : number(rawPhysics.gravity, "platformer.physics.gravity", 0.1, 2.5)
  const jumpVelocity = rawPhysics.jumpVelocity === undefined ? 14.5 : number(rawPhysics.jumpVelocity, "platformer.physics.jumpVelocity", 5, 24)
  const maxLives = rawPhysics.maxLives === undefined ? 3 : number(rawPhysics.maxLives, "platformer.physics.maxLives", 1, 9)
  const doubleJump = rawPhysics.doubleJump === undefined ? true : rawPhysics.doubleJump
  const dash = rawPhysics.dash === undefined ? true : rawPhysics.dash
  if (typeof moveSpeed !== "number" && !moveSpeed.ok) return moveSpeed
  if (typeof gravity !== "number" && !gravity.ok) return gravity
  if (typeof jumpVelocity !== "number" && !jumpVelocity.ok) return jumpVelocity
  if (typeof maxLives !== "number" && !maxLives.ok) return maxLives
  if (typeof doubleJump !== "boolean" || typeof dash !== "boolean") {
    return { ok: false, error: "Platformer physics doubleJump and dash options must be booleans" }
  }
  const livesValue = typeof maxLives === "number" ? maxLives : maxLives.value
  if (!Number.isInteger(livesValue)) {
    return { ok: false, error: "platformer.physics.maxLives must be an integer" }
  }

  return {
    ok: true,
    value: {
      type: "platformer",
      title: title.value,
      ...(description.value ? { description: description.value } : {}),
      theme: theme as "neon" | "sky" | "forest",
      width: width.value,
      height: height.value,
      player: { x: playerX.value, y: playerY.value, width: playerWidth.value, height: playerHeight.value },
      platforms: platforms.value,
      hazards: hazards.value,
      collectibles: collectibles.value,
      checkpoints: checkpoints.value,
      goal: { x: goalX.value, y: goalY.value, width: goalWidth.value, height: goalHeight.value },
      physics: {
        moveSpeed: typeof moveSpeed === "number" ? moveSpeed : moveSpeed.value,
        gravity: typeof gravity === "number" ? gravity : gravity.value,
        jumpVelocity: typeof jumpVelocity === "number" ? jumpVelocity : jumpVelocity.value,
        maxLives: typeof maxLives === "number" ? maxLives : maxLives.value,
        doubleJump,
        dash,
      },
    },
  }
}
