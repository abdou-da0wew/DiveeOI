// packages/server/src/task/generator.ts
// The task generator.
//
// A user says "watch the build every weekday morning" and means it. The
// generator agent takes that rough description and fills the task in: a
// concrete prompt, the schedule it should run on, the triggers and actions it
// should perform for itself, the agent that should run it, and the model pair.
//
// It is a one-shot: it runs once, writes the task, and stops. The task's own
// agent then runs the task at the schedule the generator picked.

import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { AppServices } from "@/app-services"
import { Context, Effect, Layer } from "effect"
import { AgentTask } from "./task"
import { SessionPrompt } from "@/session/prompt"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { EventV2Bridge } from "@/event-v2-bridge"

export interface Interface {
  /**
   * Expand a task's rough description into a complete task: a better prompt, a
   * schedule, triggers/actions, the agent to run, and the model pair.
   */
  readonly generate: (id: string) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/TaskGenerator") {}

const INSTRUCTIONS = `You are preparing an autonomous background task.

Given the user's request, design the task. Reply with ONE JSON object and nothing else:

{
  "bigPrompt": "the full instruction the task's agent runs, self-contained",
  "schedule": "<5 field cron expression, or null if the task should run once>",
  "agent": "<agent name to run, e.g. build>",
  "hooks": [{ "trigger": "on_complete|on_fail|on_timeout|on_output_match", "action": "run_command|notify|webhook|create_task", "payload": "<command, url or prompt>" }],
  "model": { "providerID": "...", "modelID": "..." },
  "smallModel": { "providerID": "...", "modelID": "..." }
}

Rules:
- The prompt must be complete and unambiguous: the agent that runs it later sees
  only this text, not the conversation.
- Use a schedule only when the request implies repetition. A cron expression is
  "minute hour day-of-month month day-of-week" in UTC.
- Only add hooks the request actually implies.
- Never invent a model: leave "model" and "smallModel" out unless you are sure.

User request:
`

type Generated = {
  bigPrompt?: string
  schedule?: string | null
  agent?: string
  hooks?: Array<{ trigger: string; action: string; payload?: string }>
  model?: { providerID: string; modelID: string }
  smallModel?: { providerID: string; modelID: string }
}

/** Pull the first JSON object out of a model reply. */
function parseSpec(text: string): Generated | undefined {
  const start = text.indexOf("{")
  if (start < 0) return undefined
  const end = text.lastIndexOf("}")
  if (end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1)) as Generated
  } catch {
    return undefined
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const tasks = yield* AgentTask.Service
    const prompt = yield* SessionPrompt.Service
    const store = yield* InstanceStore.Service
    const events = yield* EventV2Bridge.Service

    const generate = Effect.fn("TaskGenerator.generate")(function* (id: string) {
      const task = yield* tasks.get(id)
      if (!task) return

      const instruction = `${INSTRUCTIONS}${task.bigPrompt ?? task.prompt}`
      const parts = yield* prompt.resolvePromptParts(instruction)

      const reply = yield* (task.directory
        ? store.provide({ directory: task.directory }, Effect.scoped(prompt.prompt({
            sessionID: task.sessionID,
            parts,
            agent: task.agent ?? "build",
          })))
        : Effect.scoped(prompt.prompt({ sessionID: task.sessionID, parts, agent: task.agent ?? "build" })))

      const text = reply.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      const spec = parseSpec(text)
      if (!spec) {
        yield* tasks.recordHookEvent(id, "generate", "parse", task.prompt, "failed", "no JSON in reply")
        // The spec is not going to arrive on a retry either: drop the flag so the
        // runner does not ask for a generation on every tick.
        yield* tasks.update(id, { autoGenerate: false })
        return
      }

      const patch: Record<string, unknown> = {}
      if (spec.bigPrompt) patch.bigPrompt = spec.bigPrompt
      if (spec.agent) patch.agent = spec.agent
      if (typeof spec.schedule === "string" && spec.schedule.trim()) patch.schedule = spec.schedule.trim()
      if (spec.hooks?.length) {
        patch.eventHooks = JSON.stringify(
          spec.hooks.map((hook) => ({
            trigger: hook.trigger,
            action: hook.action,
            payload: hook.payload ?? "",
          })),
        )
      }
      if (spec.model) {
        patch.providerID = spec.model.providerID
        patch.modelID = spec.model.modelID
      }
      if (spec.smallModel) {
        patch.smallProviderID = spec.smallModel.providerID
        patch.smallModelID = spec.smallModel.modelID
      }
      // A generated task is made by the generator agent.
      patch.agent = patch.agent ?? task.agent
      // The spec is written: the task no longer needs the generator.
      patch.autoGenerate = false
      yield* tasks.update(id, patch as Parameters<typeof tasks.update>[1])
      yield* tasks.recordHookEvent(id, "generate", "agent", task.prompt, "dispatched", spec.bigPrompt?.slice(0, 200))
      yield* events.publish(AgentTask.Event.Updated, {
        taskID: id,
        status: task.status,
        sessionID: task.sessionID,
      })
    })

    return Service.of({ generate })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AgentTask.defaultLayer),
  Layer.provide(SessionPrompt.defaultLayer),
  Layer.provide(InstanceStore.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

export const node = LayerNode.make(layer, [
  AgentTask.node,
  // The prompt path reads further services at call time (the skill service, ripgrep, the
  // formatter, ...). A layer only sees the services it declares, so the workers depend on
  // the same application services the route handlers run with.
  ...AppServices.serviceNodes,
  InstanceStore.node,
  InstanceBootstrap.node,
  EventV2Bridge.node,
])

export * as TaskGenerator from "./generator"
