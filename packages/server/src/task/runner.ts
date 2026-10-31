// packages/server/src/task/runner.ts
// The task runner.
//
// Until now a task was a row and a session: created, listed, paused - and
// never executed. This is the piece that makes a task a task: it picks up
// queued work, runs it through the same prompt path an interactive session
// uses, tracks the outcome, fires the task's hooks and keeps a schedule
// alive.
//
// Two loops share one service:
//   - the queue loop runs tasks that are `queued` (auto-run tasks) or whose
//     cron schedule is due;
//   - the schedule loop recomputes `next_run_at` after every fired run, so a
//     task that says "every weekday at 08:00" keeps doing that on its own.
//
// Everything is best-effort: a task that fails records the error and fires
// `on_fail`; it never takes the server down.

import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { AppServices } from "@/app-services"
import { Cause, Context, Effect, Layer, Scope } from "effect"
import { AgentTask } from "./task"
import { TaskGenerator } from "./generator"
import { TaskSchedule } from "./schedule"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Config } from "@/config/config"
import {
  sharedAdaptive,
  AdaptiveResourceService,
  defaultLayer as AdaptiveResourceDefaultLayer,
  node as AdaptiveResourceNode,
} from "@diveeoi/db/adaptive"

export interface Interface {
  /** Run a task now, in the project it belongs to. */
  readonly run: (id: string) => Effect.Effect<void, unknown>
  /** One pass of the queue + schedule loops. */
  readonly tick: () => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/TaskRunner") {}

const QUEUE_INTERVAL = "2 seconds"
const SCHEDULE_INTERVAL = "30 seconds"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const tasks = yield* AgentTask.Service
    const generator = yield* TaskGenerator.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const store = yield* InstanceStore.Service
    const events = yield* EventV2Bridge.Service
    // Captured at construction so the runner does not carry a per-call
    // requirement for the adaptive service.
    const adaptive = yield* sharedAdaptive
    // The instance bootstrap reads the global config while it loads; outside a
    // request that service is not in the context, so hand it over explicitly.
    const configService = yield* Config.Service
    const scope = yield* Scope.Scope

    /** The hooks a task declared, as typed records. */
    const hooksOf = (task: AgentTask.Info) => {
      if (!task.eventHooks) return [] as Array<{
        trigger: string
        action: string
        payload: string
        pattern?: string
      }>
      try {
        const parsed = JSON.parse(task.eventHooks)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }

    /**
     * Fire the hooks of a task for one trigger. Every dispatch is written to
     * the task's event log, so the UI can show what a task did on its own.
     */
    const dispatch = Effect.fnUntraced(function* (task: AgentTask.Info, trigger: string, detail?: string) {
      for (const hook of hooksOf(task)) {
        if (hook.trigger !== trigger) continue
        const payload = typeof hook.payload === "string" ? hook.payload : (hook.payload ? JSON.stringify(hook.payload) : "")
        const status = yield* Effect.suspend(() =>
          Effect.gen(function* () {
            switch (hook.action) {
              case "create_task": {
                // A task that spawns another task: the payload is the child's prompt.
                const child = yield* tasks
                  .create({
                    prompt: payload,
                    parentSessionID: task.sessionID,
                    agent: task.agent,
                    bigPrompt: task.bigPrompt,
                    smallPrompt: task.smallPrompt,
                    autoRun: true,
                  })
                  .pipe(Effect.provideService(Session.Service, sessions))
                return `created task ${child.id}`
              }
              case "webhook": {
                if (!payload) return "no webhook url"
                const response = yield* Effect.promise(() =>
                  fetch(payload, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ taskID: task.id, trigger, detail }),
                  }).then((res) => res.text()),
                ).pipe(Effect.catch((err) => Effect.succeed(String(err))))
                return response.slice(0, 500)
              }
              case "run_command": {
                if (!payload) return "no command"
                // The command runs through the agent, so it goes through the
                // same permission rules as anything else the agent does.
                const parts = yield* prompt.resolvePromptParts(
                  `Run this command and report the result: ${payload}`,
                )
                const result = yield* prompt.prompt({
                  sessionID: task.sessionID,
                  parts,
                  agent: task.agent,
                })
                return result.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join(" ")
                  .slice(0, 500)
              }
              case "notify":
              default: {
                yield* events.publish(AgentTask.Event.Updated, {
                  taskID: task.id,
                  status: task.status,
                  sessionID: task.sessionID,
                })
                return `notified: ${payload || detail || trigger}`
              }
            }
          }),
        )
        yield* tasks.recordHookEvent(task.id, trigger, hook.action, payload, "dispatched", String(status ?? ""))
      }
    })

    const run = Effect.fn("TaskRunner.run")(function* (id: string) {
      const task = yield* tasks.get(id)
      if (!task) return
      if (task.status === "running") return
      if (task.status === "paused" || task.status === "cancelled") return

      yield* tasks.setStatus(id, "running")
      yield* tasks.touchHeartbeat(id)
      yield* tasks.markRun(id)

      // The task's session lives in a project; the prompt path needs that
      // instance context, so the run happens inside it.
      const session = yield* sessions.get(task.sessionID as SessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const directory = task.directory ?? session?.directory

      const parts = yield* prompt.resolvePromptParts(task.bigPrompt ?? task.prompt)
      const execute = Effect.gen(function* () {
        return yield* prompt.prompt({
          sessionID: task.sessionID,
          parts,
          agent: task.agent,
          model:
            task.providerID && task.modelID
              ? { providerID: task.providerID as never, modelID: task.modelID as never }
              : undefined,
        })
      })

      // The prompt path runs a session scope, so give it one.
      const outcome = yield* (directory
        ? store.provide({ directory }, Effect.scoped(execute))
        : Effect.scoped(execute)).pipe(
          Effect.provideService(Config.Service, configService),
          Effect.exit,
        )

      if (outcome._tag === "Success") {
        yield* tasks.setStatus(id, "done")
        const refreshed = yield* tasks.get(id)
        if (refreshed) yield* dispatch(refreshed, "on_complete")
      } else {
        // Keep enough of the cause to be actionable: a 500 char slice hides the frames
        // that say which service was missing.
        const message = outcome._tag === "Failure" ? Cause.pretty(outcome.cause).slice(0, 4000) : "task failed"
        yield* tasks.setStatus(id, "failed", message)
        const refreshed = yield* tasks.get(id)
        if (refreshed) yield* dispatch(refreshed, "on_fail", message)
      }

      // A scheduled task schedules its next run.
      const refreshed = yield* tasks.get(id)
      if (refreshed?.schedule) {
        yield* tasks.setNextRun(id, TaskSchedule.nextRun(refreshed.schedule)?.getTime())
      }
    })

    const tick = Effect.fn("TaskRunner.tick")(function* () {
      const now = Date.now()

      // A task can ask the generator agent to write its own spec. The generator runs
      // here rather than at creation time, so a task made from outside a request
      // (by an agent, through the task tools) gets its spec too. A task waiting to
      // be started counts as waiting: "paused" is where a task sits until it runs.
      for (const task of yield* tasks.list({})) {
        if (!task.autoGenerate) continue
        if (task.status === "cancelled" || task.status === "running") continue
        yield* generator
          .generate(task.id)
          .pipe(Effect.catchCause((cause) => Effect.logWarning("task generation failed", { id: task.id, cause })))
      }

      // Scheduled work that is due.
      for (const task of yield* tasks.due(now)) {
        if (task.status === "paused" || task.status === "cancelled") continue
        yield* tasks.setNextRun(task.id, undefined)
        yield* run(task.id)
      }

      // Queued work (auto-run tasks waiting for a runner).
      const queued = yield* tasks.list({ status: ["queued"] })
      const targets = yield* adaptive.getCurrentTargets()
      const running = yield* tasks.list({ status: ["running"] })
      const capacity = Math.max(1, targets.maxConcurrentTasks - running.length)
      for (const task of queued.slice(0, capacity)) {
        yield* run(task.id)
      }
    })

    // The loop starts with the layer and lives as long as the scope that built
    // it. For the server that scope is the app scope, so the runner runs for
    // the lifetime of the process.
    yield* Effect.forever(
      Effect.gen(function* () {
        yield* Effect.sleep(QUEUE_INTERVAL)
        yield* tick().pipe(Effect.catchCause((cause) => Effect.logWarning("task runner tick failed", { cause })))
      }),
    ).pipe(Effect.forkIn(scope))

    return Service.of({ run, tick })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AgentTask.defaultLayer),
  Layer.provide(SessionPrompt.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(InstanceStore.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(AdaptiveResourceDefaultLayer),
)

export const node = LayerNode.make(layer, [
  AgentTask.node,
  // The prompt path reads further services at call time (the skill service, ripgrep, the
  // formatter, ...). A layer only sees the services it declares, so the workers depend on
  // the same application services the route handlers run with.
  ...AppServices.serviceNodes,
  // The generator writes the spec of a task that asked for one.
  TaskGenerator.node,
  Session.node,
  InstanceStore.node,
  InstanceBootstrap.node,
  Config.node,
  EventV2Bridge.node,
  AdaptiveResourceNode,
])

export * as TaskRunner from "./runner"
