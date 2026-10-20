import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { AgentTask } from "@/task/task"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import DESCRIPTION from "./create.txt"

const Hook = Schema.Struct({
  trigger: Schema.Literals(["on_complete", "on_fail", "on_timeout", "on_output_match"]).annotate({
    description: "When the hook fires.",
  }),
  action: Schema.Literals(["run_command", "notify", "webhook", "create_task"]).annotate({
    description: "What the hook does.",
  }),
  payload: Schema.optional(Schema.String).annotate({
    description: "The hook's payload: the command to run, the webhook URL, or the text to notify with.",
  }),
  pattern: Schema.optional(Schema.String).annotate({
    description: "For the on_output_match trigger: the pattern the task's output has to match.",
  }),
})

export const Parameters = Schema.Struct({
  prompt: Schema.String.annotate({
    description: "Short label for the task, a few words. This is what the task shows up under.",
  }),
  bigPrompt: Schema.optional(Schema.String).annotate({
    description:
      "The instructions the task actually runs. Self-contained: the task runs later, without this conversation, so spell out the steps, the tools to use and what to report.",
  }),
  smallPrompt: Schema.optional(Schema.String).annotate({
    description: "The cheap side prompt, used for the task's summaries and short follow-ups.",
  }),
  schedule: Schema.optional(Schema.String).annotate({
    description:
      'Cron expression for when the task re-runs, e.g. "0 8 * * 1-5" (weekdays at 08:00), "*/15 * * * *" (every 15 minutes), "0 3 * * *" (03:00 daily). Without one the task runs once.',
  }),
  agent: Schema.optional(Schema.String).annotate({
    description: "Which agent runs the task, e.g. \"build\" or \"general\". Defaults to \"build\".",
  }),
  model: Schema.optional(Schema.String).annotate({
    description:
      'The model the task runs on, as "provider/model" — e.g. "divee/composer", a router that picks the best reachable free model on every run. Defaults to the composer.',
  }),
  smallModel: Schema.optional(Schema.String).annotate({
    description: 'The cheap model of the pair, as "provider/model".',
  }),
  directory: Schema.optional(Schema.String).annotate({
    description: "The project folder the task runs in. Defaults to the current project.",
  }),
  hooks: Schema.optional(Schema.Array(Hook)).annotate({
    description: "What to do when the task completes or fails.",
  }),
  autoRun: Schema.optional(Schema.Boolean).annotate({
    description: "Start the task right away. Without it the task waits until it is resumed.",
  }),
  autoGenerate: Schema.optional(Schema.Boolean).annotate({
    description:
      "Let the task generator agent write the full spec — prompt, schedule, agent, models — from the request, and then run it.",
  }),
  source: Schema.optional(Schema.Literals(["user", "agent"])).annotate({
    description: 'Who made the task: "agent" when you create it here, "user" when the user made it in the Tasks tab.',
  }),
  creatorAgent: Schema.optional(Schema.String).annotate({
    description: "The agent that made the task, when you are the one making it.",
  }),
})

type Metadata = {
  id: string
  status: string
  schedule?: string
}

/** "provider/model" -> { providerID, modelID }. The model id may itself contain slashes. */
function splitModel(value: string): { providerID: string; modelID: string } | undefined {
  const trimmed = value.trim()
  const slash = trimmed.indexOf("/")
  if (slash <= 0 || slash === trimmed.length - 1) return undefined
  return { providerID: trimmed.slice(0, slash), modelID: trimmed.slice(slash + 1) }
}

export const TaskCreateTool = Tool.define<typeof Parameters, Metadata, AgentTask.Service | Provider.Service | Session.Service>(
  "task_create",
  Effect.gen(function* () {
    const tasks = yield* AgentTask.Service
    const provider = yield* Provider.Service
    // The task service asks for the session service when it creates a task; the
    // tool holds on to it so the call stays self-contained.
    const sessions = yield* Session.Service

    const resolveModel = (value: string | undefined, label: string) =>
      Effect.gen(function* () {
        if (!value) return {} as { model?: { providerID: string; modelID: string }; error?: string }
        const parsed = splitModel(value)
        if (!parsed) {
          return {
            error: `${label} must look like "provider/model", e.g. "divee/composer" - got "${value}"`,
          }
        }
        // A model that does not exist is worth catching here: the task would otherwise
        // fail on every run, long after the user asked for it.
        const exists = yield* provider
          .getModel(parsed.providerID as never, parsed.modelID as never)
          .pipe(Effect.asSome, Effect.catch(() => Effect.succeed(undefined)))
        if (!exists) {
          return { error: `No model "${value}" is available on this server.` }
        }
        return { model: parsed }
      })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "task",
            patterns: [params.prompt],
            always: ["*"],
            metadata: {},
          })

          const model = yield* resolveModel(params.model, "model")
          if (model.error) {
            return {
              title: "Model not usable",
              output: model.error,
              metadata: { id: "", status: "invalid" },
            }
          }
          const smallModel = yield* resolveModel(params.smallModel, "smallModel")
          if (smallModel.error) {
            return {
              title: "Model not usable",
              output: smallModel.error,
              metadata: { id: "", status: "invalid" },
            }
          }

          const info = yield* tasks
            .create({
              prompt: params.prompt,
              bigPrompt: params.bigPrompt,
              smallPrompt: params.smallPrompt,
              schedule: params.schedule,
              agent: params.agent,
              model: model.model,
              smallModel: smallModel.model,
              directory: params.directory,
              hooks: params.hooks
                ? params.hooks.map((hook) => ({
                    trigger: hook.trigger,
                    action: hook.action,
                    payload: hook.payload,
                    pattern: hook.pattern,
                  }))
                : undefined,
              autoRun: params.autoRun,
              autoGenerate: params.autoGenerate,
              source: params.source ?? "agent",
              creatorAgent: params.creatorAgent ?? ctx.agent,
              parentSessionID: ctx.sessionID,
            })
            .pipe(Effect.provideService(Session.Service, sessions))

          return {
            title: `Task created: ${info.prompt.slice(0, 60)}`,
            output: [
              `Created task ${info.id}.`,
              `status: ${info.status}`,
              info.schedule ? `schedule: ${info.schedule}` : "schedule: none (runs once)",
              `agent: ${info.agent ?? "build"}`,
              `model: ${info.providerID}/${info.modelID}`,
              `directory: ${info.directory ?? "current project"}`,
              info.nextRunAt ? `next run: ${new Date(info.nextRunAt).toISOString()}` : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            metadata: {
              id: info.id,
              status: info.status,
              schedule: info.schedule,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
