import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

/**
 * Agent task schema (draft-10 P4). Mirrors the server-side AgentTask.Info.
 */
export const TaskInfo = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  parentSessionID: Schema.optional(Schema.String),
  prompt: Schema.String,
  providerID: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  status: Schema.String,
  autoRun: Schema.Boolean,
  subagentTypes: Schema.optional(Schema.Array(Schema.String)),
  lastHeartbeat: Schema.optional(Schema.Number),
  checkpointAnchorID: Schema.optional(Schema.String),
  worktree: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "AgentTask.Info" })
export type TaskInfo = Schema.Schema.Type<typeof TaskInfo>

export const TaskCreateBody = Schema.Struct({
  prompt: Schema.String,
  model: Schema.optional(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }),
  ),
  autoRun: Schema.optional(Schema.Boolean),
  subagentTypes: Schema.optional(Schema.Array(Schema.String)),
  parentSessionID: Schema.optional(Schema.String),
}).annotate({ identifier: "AgentTask.CreateBody" })

export const TaskUpdateBody = Schema.Struct({
  prompt: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  providerID: Schema.optional(Schema.String),
  subagentTypes: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "AgentTask.UpdateBody" })

export class TaskNotFoundError extends Schema.TaggedErrorClass<TaskNotFoundError>()("TaskNotFoundError", {
  id: Schema.String,
}) {
  override get message() {
    return `Task not found: ${this.id}`
  }
}

/**
 * Task API group (draft-10 P4). The curl surface for autonomous task
 * management.
 */
export const TaskGroup = HttpApiGroup.make("server.task")
  .add(
    HttpApiEndpoint.post("task.create", "/api/v1/tasks", {
      payload: TaskCreateBody,
      success: Schema.Struct({ data: TaskInfo }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.task.create",
        summary: "Create an autonomous task",
        description:
          "Creates a child session + agent_task row. When autoRun is true the task starts immediately; otherwise it stays paused until resumed.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("task.list", "/api/v1/tasks", {
      success: Schema.Struct({ data: Schema.Array(TaskInfo) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.task.list",
        summary: "List tasks",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("task.get", "/api/v1/tasks/:id", {
      params: { id: Schema.String },
      success: Schema.Struct({ data: TaskInfo }),
      error: TaskNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.task.get",
        summary: "Get a task by id",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("task.update", "/api/v1/tasks/:id", {
      params: { id: Schema.String },
      payload: TaskUpdateBody,
      success: Schema.Struct({ data: TaskInfo }),
      error: TaskNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.task.update",
        summary: "Update a task's prompt/model/subagentTypes",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("task.cancel", "/api/v1/tasks/:id", {
      params: { id: Schema.String },
      success: Schema.Struct({ ok: Schema.Boolean }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.task.cancel",
        summary: "Cancel a task",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("task.pause", "/api/v1/tasks/:id/pause", {
      params: { id: Schema.String },
      success: Schema.Struct({ ok: Schema.Boolean }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.task.pause",
        summary: "Pause a running task",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("task.resume", "/api/v1/tasks/:id/resume", {
      params: { id: Schema.String },
      success: Schema.Struct({ ok: Schema.Boolean }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.task.resume",
        summary: "Resume a paused task",
      }),
    ),
  )
