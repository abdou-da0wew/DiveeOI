import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { AgentTask } from "@/task/task"
import DESCRIPTION from "./status.txt"

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({
    description: "The task id, e.g. \"task_01M4YVP5F4JYVYHG8038VSXXZP\".",
  }),
})

type Metadata = {
  id: string
  status: string
}

export const TaskStatusTool = Tool.define<typeof Parameters, Metadata, AgentTask.Service>(
  "task_status",
  Effect.gen(function* () {
    const tasks = yield* AgentTask.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const task = yield* tasks.get(params.id)
          if (!task) {
            return {
              title: "Task not found",
              output: `No task with id "${params.id}". Use task_list to see the tasks.`,
              metadata: { id: params.id, status: "not_found" },
            }
          }

          const lines = [
            `id:        ${task.id}`,
            `status:    ${task.status}`,
            `prompt:    ${task.prompt}`,
            `agent:     ${task.agent ?? "build"}`,
            `model:     ${task.providerID}/${task.modelID}`,
            `directory: ${task.directory ?? "current project"}`,
            `schedule:  ${task.schedule ?? "none (runs once)"}`,
            `runs:      ${task.runCount ?? 0}`,
            `last run:  ${task.lastRunAt ? new Date(task.lastRunAt).toISOString() : "never"}`,
            `next run:  ${task.nextRunAt ? new Date(task.nextRunAt).toISOString() : "not scheduled"}`,
            `made by:   ${task.source ?? "user"}${task.creatorAgent ? ` (agent ${task.creatorAgent})` : ""}`,
            `session:   ${task.sessionID}`,
          ]
          if (task.bigPrompt) lines.push(`big prompt: ${task.bigPrompt.slice(0, 500)}`)
          if (task.smallPrompt) lines.push(`small prompt: ${task.smallPrompt.slice(0, 200)}`)
          if (task.error) lines.push(`error: ${task.error.slice(0, 1000)}`)

          return {
            title: `Task ${task.id}: ${task.status}`,
            output: lines.join("\n"),
            metadata: { id: task.id, status: task.status },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
