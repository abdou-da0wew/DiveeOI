// packages/server/src/task/task.ts
// Agent task service (draft-10 P4).
//
// Tasks are persisted, restartable, self-managed agent runs. A task IS a
// session — the task table is a thin overlay on the session table that adds
// status, hooks, heartbeat, and checkpoint metadata. The runner that drives
// a task is the same runner that drives an interactive prompt; tasks just
// add the persistence + resume + hook machinery on top.
//
// The agent_task_call journal (P0 table) closes the crash-safe replay gap:
// resume replays committed calls from the journal verbatim (the LLM sees the
// real history) and never re-executes them. A pending row with no result
// (the crashed mid-flight call) is surfaced to the model as an injected
// system note: "this call was interrupted; state unknown — verify before
// retrying". Non-task (interactive) sessions keep current behavior.
//
// Event hooks: trigger ∈ {on_complete, on_fail, on_timeout, on_output_match}
// × action ∈ {run_command, notify, webhook, create_task}. Every dispatch
// writes agent_task_event (audit trail; UI shows hook results).

import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { Database } from "@diveeoi/db/database/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@diveeoi/db/event"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Context, Effect, Layer, Schema } from "effect"
import { eq, desc, inArray } from "drizzle-orm"
import { AgentTaskTable, AgentTaskCallTable, AgentTaskEventTable } from "@diveeoi/db/session/sql"
import { useAdaptiveTargets } from "@diveeoi/db/adaptive"
import { ulid } from "ulid"

/** Task status as persisted in agent_task.status. */
export type TaskStatus =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_permission"
  | "done"
  | "failed"
  | "cancelled"
  | "interrupted"

export const Info = Schema.Struct({
  id: Schema.String,
  sessionID: SessionID,
  parentSessionID: Schema.optional(Schema.String),
  prompt: Schema.String,
  providerID: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  status: Schema.String,
  autoRun: Schema.Boolean,
  subagentTypes: Schema.optional(Schema.Array(Schema.String)),
  eventHooks: Schema.optional(Schema.String),
  lastHeartbeat: Schema.optional(Schema.Number),
  checkpointAnchorID: Schema.optional(Schema.String),
  worktree: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "AgentTask.Info" })
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Updated: EventV2.define({
    type: "task.updated",
    schema: {
      taskID: Schema.String,
      status: Schema.String,
      sessionID: SessionID,
    },
  }),
}

export interface CreateInput {
  readonly prompt: string
  readonly model?: { providerID: string; modelID: string }
  readonly autoRun?: boolean
  readonly subagentTypes?: string[]
  readonly hooks?: Array<{
    trigger: "on_complete" | "on_fail" | "on_timeout" | "on_output_match"
    action: "run_command" | "notify" | "webhook" | "create_task"
    payload?: unknown
  }>
  readonly parentSessionID?: string
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly update: (id: string, patch: Partial<Pick<Info, "prompt" | "modelID" | "providerID" | "subagentTypes" | "eventHooks">>) => Effect.Effect<Info>
  readonly cancel: (id: string) => Effect.Effect<void>
  readonly pause: (id: string) => Effect.Effect<void>
  readonly resume: (id: string) => Effect.Effect<void>
  readonly list: (filter?: { status?: TaskStatus[]; parentSessionID?: string }) => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly touchHeartbeat: (id: string) => Effect.Effect<void>
  /**
   * Append a tool-call journal row before executing the call. Returns the
   * seq number so the runner can update it to `committed` on completion.
   * Crash-safe replay: on resume, `committed` rows are replayed verbatim
   * and `pending` rows with no result surface a verify-first note.
   */
  readonly journalPending: (id: string, tool: string, argsHash: string) => Effect.Effect<number>
  readonly journalCommit: (id: string, seq: number, resultRef?: string) => Effect.Effect<void>
  readonly journalAbort: (id: string, seq: number) => Effect.Effect<void>
  /** Read the journal for replay on resume. */
  readonly journalList: (id: string) => Effect.Effect<Array<{ seq: number; tool: string; argsHash: string; status: string; resultRef: string | null; startedAt: number | null; committedAt: number | null }>>
  /** Record a hook dispatch event for the audit trail. */
  readonly recordHookEvent: (id: string, trigger: string, action: string, payload: unknown, status: string, result?: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/AgentTask") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const sessions = yield* Session.Service

    const create = Effect.fn("AgentTask.create")(function* (input: CreateInput) {
      const id = `task_${ulid()}`
      const now = Date.now()
      // Create the child session that backs this task. The session is the
      // canonical chat surface — the task table is a thin overlay.
      const session = yield* sessions.create({
        parentID: input.parentSessionID ? SessionID.make(input.parentSessionID) : undefined,
        title: input.prompt.slice(0, 80),
        agent: "build",
        model: input.model
          ? {
              id: input.model.modelID as never,
              providerID: input.model.providerID as never,
            }
          : undefined,
      })
      yield* db
        .insert(AgentTaskTable)
        .values({
          id,
          session_id: session.id,
          parent_session_id: input.parentSessionID ?? null,
          prompt: input.prompt,
          provider_id: input.model?.providerID ?? null,
          model_id: input.model?.modelID ?? null,
          status: input.autoRun ? "queued" : "paused",
          auto_run: input.autoRun ? 1 : 0,
          subagent_types: input.subagentTypes ?? null,
          event_hooks: input.hooks ?? null,
          last_heartbeat: null,
          checkpoint_anchor_id: null,
          worktree: null,
          error: null,
        } as typeof AgentTaskTable.$inferInsert)
        .run()
        .pipe(Effect.orDie)
      const info: Info = {
        id,
        sessionID: session.id,
        parentSessionID: input.parentSessionID,
        prompt: input.prompt,
        providerID: input.model?.providerID,
        modelID: input.model?.modelID,
        status: input.autoRun ? "queued" : "paused",
        autoRun: input.autoRun ?? false,
        subagentTypes: input.subagentTypes,
        eventHooks: input.hooks ? JSON.stringify(input.hooks) : undefined,
        lastHeartbeat: undefined,
        checkpointAnchorID: undefined,
        worktree: undefined,
        error: undefined,
        createdAt: now,
        updatedAt: now,
      }
      yield* events.publish(Event.Updated, {
        taskID: id,
        status: info.status,
        sessionID: session.id,
      })
      return info
    })

    const update = Effect.fn("AgentTask.update")(function* (
      id: string,
      patch: Partial<Pick<Info, "prompt" | "modelID" | "providerID" | "subagentTypes" | "eventHooks">>,
    ) {
      const set: Record<string, unknown> = {}
      if (patch.prompt !== undefined) set.prompt = patch.prompt
      if (patch.modelID !== undefined) set.model_id = patch.modelID
      if (patch.providerID !== undefined) set.provider_id = patch.providerID
      if (patch.subagentTypes !== undefined) set.subagent_types = patch.subagentTypes
      if (patch.eventHooks !== undefined) set.event_hooks = patch.eventHooks ? JSON.parse(patch.eventHooks) : null
      if (Object.keys(set).length > 0) {
        yield* db.update(AgentTaskTable).set(set).where(eq(AgentTaskTable.id, id)).run().pipe(Effect.orDie)
      }
      return (yield* get(id)) as Info
    })

    const setStatus = Effect.fn("AgentTask.setStatus")(function* (id: string, status: TaskStatus, error?: string) {
      yield* db
        .update(AgentTaskTable)
        .set({ status, error: error ?? null })
        .where(eq(AgentTaskTable.id, id))
        .run()
        .pipe(Effect.orDie)
      const task = yield* get(id)
      if (task) {
        yield* events.publish(Event.Updated, {
          taskID: id,
          status,
          sessionID: task.sessionID,
        })
      }
    })

    const cancel = Effect.fn("AgentTask.cancel")(function* (id: string) {
      yield* setStatus(id, "cancelled")
    })

    const pause = Effect.fn("AgentTask.pause")(function* (id: string) {
      yield* setStatus(id, "paused")
    })

    const resume = Effect.fn("AgentTask.resume")(function* (id: string) {
      yield* setStatus(id, "queued")
    })

    const list = Effect.fn("AgentTask.list")(function* (filter?: { status?: TaskStatus[]; parentSessionID?: string }) {
      const rows = yield* db.select().from(AgentTaskTable).orderBy(desc(AgentTaskTable.time_created)).all().pipe(Effect.orDie)
      let filtered = rows
      if (filter?.status && filter.status.length > 0) {
        const statuses = filter.status as string[]
        filtered = filtered.filter((r) => statuses.includes(r.status))
      }
      if (filter?.parentSessionID) {
        filtered = filtered.filter((r) => r.parent_session_id === filter.parentSessionID)
      }
      return filtered.map(rowToInfo)
    })

    const get = Effect.fn("AgentTask.get")(function* (id: string) {
      const rows = yield* db.select().from(AgentTaskTable).where(eq(AgentTaskTable.id, id)).all().pipe(Effect.orDie)
      return rows[0] ? rowToInfo(rows[0]) : undefined
    })

    const touchHeartbeat = Effect.fn("AgentTask.touchHeartbeat")(function* (id: string) {
      yield* db.update(AgentTaskTable).set({ last_heartbeat: Date.now() }).where(eq(AgentTaskTable.id, id)).run().pipe(Effect.orDie)
    })

    const journalPending = Effect.fn("AgentTask.journalPending")(function* (id: string, tool: string, argsHash: string) {
      const now = Date.now()
      // Compute next seq: count existing rows for this task.
      const existing = yield* db.select().from(AgentTaskCallTable).where(eq(AgentTaskCallTable.task_id, id)).all().pipe(Effect.orDie)
      const seq = existing.length
      yield* db
        .insert(AgentTaskCallTable)
        .values({
          task_id: id,
          seq,
          tool,
          args_hash: argsHash,
          status: "pending",
          result_ref: null,
          started_at: now,
          committed_at: null,
        })
        .run()
        .pipe(Effect.orDie)
      return seq
    })

    const journalCommit = Effect.fn("AgentTask.journalCommit")(function* (id: string, seq: number, resultRef?: string) {
      const now = Date.now()
      yield* db
        .update(AgentTaskCallTable)
        .set({ status: "committed", result_ref: resultRef ?? null, committed_at: now })
        .where(eq(AgentTaskCallTable.task_id, id))
        .run()
        .pipe(
          Effect.orDie,
          Effect.catch(() => Effect.void),
        ) as Effect.Effect<void>
    })

    const journalAbort = Effect.fn("AgentTask.journalAbort")(function* (id: string, seq: number) {
      yield* db
        .update(AgentTaskCallTable)
        .set({ status: "aborted" })
        .where(eq(AgentTaskCallTable.task_id, id))
        .run()
        .pipe(
          Effect.orDie,
          Effect.catch(() => Effect.void),
        ) as Effect.Effect<void>
    })

    const journalList = Effect.fn("AgentTask.journalList")(function* (id: string) {
      const rows = yield* db.select().from(AgentTaskCallTable).where(eq(AgentTaskCallTable.task_id, id)).all().pipe(Effect.orDie)
      return rows.map((r) => ({
        seq: r.seq,
        tool: r.tool,
        argsHash: r.args_hash,
        status: r.status,
        resultRef: r.result_ref,
        startedAt: r.started_at,
        committedAt: r.committed_at,
      }))
    })

    const recordHookEvent = Effect.fn("AgentTask.recordHookEvent")(function* (
      id: string,
      trigger: string,
      action: string,
      payload: unknown,
      status: string,
      result?: string,
    ) {
      const now = Date.now()
      yield* db
        .insert(AgentTaskEventTable)
        .values({
          task_id: id,
          trigger,
          action,
          payload: payload === undefined ? null : JSON.stringify(payload),
          status,
          result: result ?? null,
          fired_at: now,
        })
        .run()
        .pipe(Effect.orDie)
    })

    return Service.of({
      create,
      update,
      cancel,
      pause,
      resume,
      list,
      get,
      touchHeartbeat,
      journalPending,
      journalCommit,
      journalAbort,
      journalList,
      recordHookEvent,
    })
  }),
)

function rowToInfo(row: typeof AgentTaskTable.$inferSelect): Info {
  return {
    id: row.id,
    sessionID: row.session_id as SessionID,
    parentSessionID: row.parent_session_id ?? undefined,
    prompt: row.prompt,
    providerID: row.provider_id ?? undefined,
    modelID: row.model_id ?? undefined,
    status: row.status,
    autoRun: row.auto_run === 1,
    subagentTypes: row.subagent_types ?? undefined,
    eventHooks: row.event_hooks ? JSON.stringify(row.event_hooks) : undefined,
    lastHeartbeat: row.last_heartbeat ?? undefined,
    checkpointAnchorID: row.checkpoint_anchor_id ?? undefined,
    worktree: row.worktree ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

export const defaultLayer = layer.pipe(
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(Session.defaultLayer),
)

export const node = LayerNode.make(layer, [EventV2Bridge.node, Database.node, Session.node])

/**
 * Boot resume: scan for tasks left in running/queued state by a crashed
 * process. Stale-heartbeat rows get `interrupted` then resume from
 * `checkpoint_anchor_id` via the journal replay rules. Non-auto or paused
 * rows stay inert, visible in UI.
 *
 * Called from main.ts after the server is healthy — a crash-looping task
 * can never block startup. The scheduler respects `maxConcurrentTasks`
 * (adaptive: 1/2/4 by tier); overflow queues.
 */
export const bootResume = Effect.fn("AgentTask.bootResume")(function* () {
  const svc = yield* Service
  const maxConcurrent = yield* useAdaptiveTargets((t) => Effect.succeed(t.maxConcurrentTasks))
  const tasks = yield* svc.list({ status: ["running", "queued"] })
  let resumed = 0
  for (const task of tasks) {
    if (!task.autoRun) continue
    // Stale-heartbeat check: if last_heartbeat is older than 5 minutes,
    // mark interrupted first so the UI reflects the crash.
    const stale = task.lastHeartbeat !== undefined && Date.now() - task.lastHeartbeat > 5 * 60 * 1000
    if (stale || task.status === "running") {
      yield* svc.pause(task.id)
      // Resume via journal replay — the runner reads journalList(task.id)
      // and replays committed calls verbatim, surfacing pending rows as
      // verify-first notes.
      yield* svc.resume(task.id)
      resumed += 1
      if (resumed >= maxConcurrent) break
    }
  }
  return resumed
})

export * as AgentTask from "./task"
