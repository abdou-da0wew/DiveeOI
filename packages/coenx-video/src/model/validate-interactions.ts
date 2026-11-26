import type { Expression, InteractionAction, Scene, SceneInteraction } from "./types"

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/
const MAX_ACTION_DEPTH = 8

function add(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message)
}

function validateExpression(expression: Expression, issues: string[], depth = 0) {
  if (depth > 16) {
    issues.push("interaction expression exceeds 16 levels")
    return
  }
  if (expression.op === "literal" || expression.op === "state" || expression.op === "event") return
  if (expression.op === "not" || expression.op === "abs" || expression.op === "round" || expression.op === "floor" || expression.op === "ceil") {
    validateExpression(expression.value, issues, depth + 1)
    return
  }
  if (expression.op === "contains") {
    validateExpression(expression.value, issues, depth + 1)
    validateExpression(expression.search, issues, depth + 1)
    return
  }
  if (expression.op === "clamp") {
    validateExpression(expression.value, issues, depth + 1)
    validateExpression(expression.min, issues, depth + 1)
    validateExpression(expression.max, issues, depth + 1)
    return
  }
  if (expression.op === "random") {
    validateExpression(expression.min, issues, depth + 1)
    validateExpression(expression.max, issues, depth + 1)
    return
  }
  if (expression.op === "if") {
    validateExpression(expression.cond, issues, depth + 1)
    validateExpression(expression.trueValue, issues, depth + 1)
    validateExpression(expression.falseValue, issues, depth + 1)
    return
  }
  if ("items" in expression) {
    add(issues, expression.items.length > 0 && expression.items.length <= 24, "list expressions need 1–24 operands")
    expression.items.forEach((item) => validateExpression(item, issues, depth + 1))
    return
  }
  if ("left" in expression && "right" in expression) {
    validateExpression(expression.left, issues, depth + 1)
    validateExpression(expression.right, issues, depth + 1)
  }
}

function validateActions(
  actions: InteractionAction[],
  ids: Set<string>,
  scenes: Set<string>,
  audio: Set<string>,
  issues: string[],
  scene?: Scene,
  depth = 0,
) {
  add(issues, actions.length <= 24, "an interaction can contain at most 24 actions")
  add(issues, depth <= MAX_ACTION_DEPTH, "nested run actions exceed the maximum depth")
  for (const action of actions) {
    if (action.type === "goto")
      add(issues, scenes.has(action.sceneId), `interaction references missing scene ${action.sceneId}`)
    if (action.type === "gotoFrame")
      add(
        issues,
        Number.isFinite(action.frame) && action.frame >= 0 && (!scene || action.frame <= scene.durationFrames),
        "gotoFrame must be a frame number within the scene",
      )
    if (action.type === "show" || action.type === "hide" || action.type === "setNode" || action.type === "impulse")
      add(issues, ids.has(action.targetId), `interaction references missing node ${action.targetId}`)
    if (action.type === "playAudio")
      add(issues, audio.has(action.trackId), `interaction references missing audio track ${action.trackId}`)
    if (action.type === "run") validateActions(action.actions, ids, scenes, audio, issues, scene, depth + 1)
  }
}

export function validateSceneInteractions(
  interaction: SceneInteraction,
  ids: Set<string>,
  scenes: Set<string>,
  audio: Set<string>,
  issues: string[],
  scene: Scene,
) {
  add(issues, ID.test(interaction.id), `scene ${scene.id} has invalid interaction id ${interaction.id}`)
  const target = "targetId" in interaction.trigger ? interaction.trigger.targetId : undefined
  if (target) add(issues, ids.has(target), `interaction ${interaction.id} references missing node ${target}`)
  if (interaction.trigger.type === "timer")
    add(
      issues,
      interaction.trigger.frame >= 0 && interaction.trigger.frame <= scene.durationFrames,
      `timer ${interaction.id} is outside its scene`,
    )
  if (interaction.when) validateExpression(interaction.when, issues)
  validateActions(interaction.actions, ids, scenes, audio, issues, scene)
}

export function validateActionsExport(actions: InteractionAction[], ids: Set<string>, scenes: Set<string>, audio: Set<string>, issues: string[]) {
  validateActions(actions, ids, scenes, audio, issues)
}
