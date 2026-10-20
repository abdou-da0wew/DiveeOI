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
  agent: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  creatorAgent: Schema.optional(Schema.String),
  bigPrompt: Schema.optional(Schema.String),
  smallPrompt: Schema.optional(Schema.String),
  smallProviderID: Schema.optional(Schema.String),
  smallModelID: Schema.optional(Schema.String),
  schedule: Schema.optional(Schema.String),
  nextRunAt: Schema.optional(Schema.Number),
  lastRunAt: Schema.optional(Schema.Number),
  runCount: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "AgentTask.Info" })
export type TaskInfo = Schema.Schema.Type<typeof TaskInfo>

/** A trigger/action pair a task performs for itself. */
export const TaskHook = Schema.Struct({
  trigger: Schema.Literals(["on_complete", "on_fail", "on_timeout", "on_output_match"] as const),
  action: Schema.Literals(["run_command", "notify", "webhook", "create_task"] as const),
  payload: Schema.optional(Schema.String),
  pattern: Schema.optional(Schema.String),
}).annotate({ identifier: "AgentTask.Hook" })

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
  /** The project directory the task runs in. */
  directory: Schema.optional(Schema.String),
  /** Who made the task: "user" or "agent". */
  source: Schema.optional(Schema.Literals(["user", "agent"] as const)),
  /** The agent that made the task, when it was made by an agent. */
  creatorAgent: Schema.optional(Schema.String),
  /** Let the task generator agent fill the task in before it runs. */
  autoGenerate: Schema.optional(Schema.Boolean),
  /** Which agent runs the task. */
  agent: Schema.optional(Schema.String),
  /** The long prompt the task runs. Falls back to `prompt`. */
  bigPrompt: Schema.optional(Schema.String),
  /** The cheap prompt used for the task's side-channel work. */
  smallPrompt: Schema.optional(Schema.String),
  /** The small model of the pair (summaries, cheap follow-ups). */
  smallModel: Schema.optional(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }),
  ),
  /** Cron expression - the task re-runs on its own. */
  schedule: Schema.optional(Schema.String),
  /** Triggers and actions the task performs for itself. */
  hooks: Schema.optional(Schema.Array(TaskHook)),
}).annotate({ identifier: "AgentTask.CreateBody" })

export const TaskUpdateBody = Schema.Struct({
  prompt: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  providerID: Schema.optional(Schema.String),
  subagentTypes: Schema.optional(Schema.Array(Schema.String)),
  agent: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  creatorAgent: Schema.optional(Schema.String),
  bigPrompt: Schema.optional(Schema.String),
  smallPrompt: Schema.optional(Schema.String),
  smallProviderID: Schema.optional(Schema.String),
  smallModelID: Schema.optional(Schema.String),
  schedule: Schema.optional(Schema.String),
  eventHooks: Schema.optional(Schema.Array(TaskHook)),
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
    HttpApiEndpoint.post("task.run", "/api/v1/tasks/:id/run", {
      params: { id: Schema.String },
      success: Schema.Struct({ ok: Schema.Boolean }),
      error: TaskNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.task.run",
        summary: "Run a task now",
        description: "Runs the task immediately, whatever its schedule says.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("task.generate", "/api/v1/tasks/:id/generate", {
      params: { id: Schema.String },
      success: Schema.Struct({ ok: Schema.Boolean }),
      error: TaskNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.task.generate",
        summary: "Let the generator agent build the task",
        description:
          "Runs the task generator once: it expands the request into a complete task (prompt, schedule, triggers, agent, models) and then stops.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("task.events", "/api/v1/tasks/:id/events", {
      params: { id: Schema.String },
      success: Schema.Struct({
        data: Schema.Array(
          Schema.Struct({
            id: Schema.Number,
            trigger: Schema.String,
            action: Schema.String,
            payload: Schema.optional(Schema.String),
            status: Schema.optional(Schema.String),
            result: Schema.optional(Schema.String),
            firedAt: Schema.Number,
          }),
        ),
      }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.task.events",
        summary: "The hook audit trail of a task",
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
