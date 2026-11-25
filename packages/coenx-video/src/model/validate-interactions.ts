import type { Expression, InteractionAction, Scene, SceneInteraction } from "./types"

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/

function add(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message)
}

function validateExpression(expression: Expression, issues: string[], depth = 0) {
  if (depth > 16) {
    issues.push("interaction expression exceeds 16 levels")
    return
  }
  if (expression.op === "literal" || expression.op === "state" || expression.op === "event") return
  if (expression.op === "not") {
    validateExpression(expression.value, issues, depth + 1)
    return
  }
  if (expression.op === "and" || expression.op === "or") {
    add(issues, expression.items.length > 0 && expression.items.length <= 24, "logical expressions need 1–24 operands")
    expression.items.forEach((item) => validateExpression(item, issues, depth + 1))
    return
  }
  if (expression.op === "contains") {
    validateExpression(expression.value, issues, depth + 1)
    validateExpression(expression.search, issues, depth + 1)
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
) {
  add(issues, actions.length <= 24, "an interaction can contain at most 24 actions")
  for (const action of actions) {
    if (action.type === "goto")
      add(issues, scenes.has(action.sceneId), `interaction references missing scene ${action.sceneId}`)
    if (action.type === "show" || action.type === "hide")
      add(issues, ids.has(action.targetId), `interaction references missing node ${action.targetId}`)
    if (action.type === "playAudio")
      add(issues, audio.has(action.trackId), `interaction references missing audio track ${action.trackId}`)
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
  validateActions(interaction.actions, ids, scenes, audio, issues)
}

export function validateActionsExport(actions: InteractionAction[], ids: Set<string>, scenes: Set<string>, audio: Set<string>, issues: string[]) {
  validateActions(actions, ids, scenes, audio, issues)
}
