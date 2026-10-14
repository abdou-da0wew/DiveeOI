import { Account } from "@/account/account"
import { AccountDeviceLogin } from "@/account/device-login"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"
import { Effect, Option } from "effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  ConsoleApiError,
  ConsoleLoginPayload,
  ConsoleLogoutPayload,
  ConsolePollPayload,
  ConsoleSwitchPayload,
  ConsoleCancelPayload,
  SessionListQuery,
  ToolListQuery,
  WorktreeApiError,
} from "../groups/experimental"

function mapWorktreeError<A, R>(self: Effect.Effect<A, Worktree.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => new WorktreeApiError({ name: error._tag, data: { message: error.message } })),
  )
}

export const experimentalHandlers = HttpApiBuilder.group(InstanceHttpApi, "experimental", (handlers) =>
  Effect.gen(function* () {
    const account = yield* Account.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const project = yield* Project.Service
    const registry = yield* ToolRegistry.Service
    const worktreeSvc = yield* Worktree.Service
    const sessions = yield* Session.Service
    const background = yield* BackgroundJob.Service
    const flags = yield* RuntimeFlags.Service

    const capabilities = Effect.fn("ExperimentalHttpApi.capabilities")(function* () {
      return { backgroundSubagents: flags.experimentalBackgroundSubagents }
    })

    const getConsole = Effect.fn("ExperimentalHttpApi.console")(function* () {
      const [state, groups] = yield* Effect.all(
        [
          config.getConsoleState(),
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      return {
        consoleManagedProviders: state.consoleManagedProviders,
        ...(state.activeOrgName ? { activeOrgName: state.activeOrgName } : {}),
        switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
      }
    })

    const listConsoleOrgs = Effect.fn("ExperimentalHttpApi.consoleOrgs")(function* () {
      const [groups, active] = yield* Effect.all(
        [
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
          account.active().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      const info = Option.getOrUndefined(active)
      return {
        orgs: groups.flatMap((group) =>
          group.orgs.map((org) => ({
            accountID: group.account.id,
            accountEmail: group.account.email,
            accountUrl: group.account.url,
            orgID: org.id,
            orgName: org.name,
            active: !!info && info.id === group.account.id && info.active_org_id === org.id,
          })),
        ),
      }
    })

    const switchConsole = Effect.fn("ExperimentalHttpApi.consoleSwitch")(function* (ctx: {
      payload: typeof ConsoleSwitchPayload.Type
    }) {
      yield* account
        .use(ctx.payload.accountID, Option.some(ctx.payload.orgID))
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      // The active org's remote config is folded into the per-instance state at load time, so
      // switching orgs has to rebuild it or the previous org's providers linger.
      yield* config.refresh()
      return true
    })

    /** Console origin used when the client does not name one. */
    const defaultConsoleServer = "https://opencode.ai/console"

    const fail = (error: unknown) =>
      new ConsoleApiError({
        name: "ConsoleApiError",
        data: { message: error instanceof Error ? error.message : String(error) },
      })

    const consoleLogin = Effect.fn("ExperimentalHttpApi.consoleLogin")(function* (ctx: {
      payload: typeof ConsoleLoginPayload.Type | void
    }) {
      const server = ctx.payload?.server?.trim() || defaultConsoleServer
      const login = yield* account.login(server).pipe(Effect.mapError(fail))
      const attempt = yield* AccountDeviceLogin.start(login)
      return {
        attemptID: attempt.id,
        userCode: login.user,
        // The console returns a relative `verification_uri_complete`; `Account.login` already
        // resolved it against the server, so this is the full URL to open.
        verificationURL: login.url,
        server: login.server,
        intervalMs: attempt.interval,
        expiresInMs: Math.max(0, attempt.deadline - (yield* Effect.clockWith((c) => c.currentTimeMillis))),
      }
    })

    const consolePoll = Effect.fn("ExperimentalHttpApi.consolePoll")(function* (ctx: {
      payload: typeof ConsolePollPayload.Type
    }) {
      const attempt = yield* AccountDeviceLogin.get(ctx.payload.attemptID)
      if (!attempt) {
        // Gone means either cancelled or past the console's deadline; both are terminal and the
        // client should stop, so report expiry rather than a generic failure.
        return { status: "expired" as const, nextPollMs: 0 }
      }

      const result = yield* account.poll(attempt.login).pipe(Effect.mapError(fail))
      const outcome = AccountDeviceLogin.interpret(attempt, result)
      const nextPollMs = AccountDeviceLogin.nextDelay(attempt, outcome)

      if (AccountDeviceLogin.isTerminal(outcome)) AccountDeviceLogin.forget(attempt.id)

      if (outcome.status === "success") {
        // The account is persisted and active now; rebuild the instance state so the providers
        // its remote config manages become available to this session.
        yield* config.refresh().pipe(Effect.catch((err) => Effect.logWarning("console config refresh failed", err)))
      }

      return {
        status: outcome.status,
        ...(outcome.status === "success" ? { email: outcome.email } : {}),
        ...(outcome.status === "error" ? { message: outcome.message } : {}),
        nextPollMs: outcome.status === "success" ? 0 : nextPollMs,
      }
    })

    const consoleCancel = Effect.fn("ExperimentalHttpApi.consoleCancel")(function* (ctx: {
      payload: typeof ConsoleCancelPayload.Type
    }) {
      AccountDeviceLogin.forget(ctx.payload.attemptID)
      return true
    })

    const consoleLogout = Effect.fn("ExperimentalHttpApi.consoleLogout")(function* (ctx: {
      payload: typeof ConsoleLogoutPayload.Type
    }) {
      yield* account.remove(ctx.payload.accountID).pipe(Effect.mapError(fail))
      yield* config.refresh().pipe(Effect.catch((err) => Effect.logWarning("console config refresh failed", err)))
      return true
    })

    const tool = Effect.fn("ExperimentalHttpApi.tool")(function* (ctx: { query: typeof ToolListQuery.Type }) {
      const list = yield* registry.tools({
        providerID: ctx.query.provider,
        modelID: ctx.query.model,
        agent: yield* agents.defaultInfo(),
      })
      return list.map((item) => ({
        id: item.id,
        description: item.description,
        parameters: ToolJsonSchema.fromTool(item),
      }))
    })

    const toolIDs = Effect.fn("ExperimentalHttpApi.toolIDs")(function* () {
      return yield* registry.ids()
    })

    const worktree = Effect.fn("ExperimentalHttpApi.worktree")(function* () {
      const ctx = yield* InstanceState.context
      return yield* project.sandboxes(ctx.project.id)
    })

    const worktreeCreate = Effect.fn("ExperimentalHttpApi.worktreeCreate")(function* (ctx: {
      payload: typeof Worktree.CreateInput.Type | void
    }) {
      return yield* mapWorktreeError(worktreeSvc.create(ctx.payload ?? undefined))
    })

    const worktreeRemove = Effect.fn("ExperimentalHttpApi.worktreeRemove")(function* (input: {
      payload: Worktree.RemoveInput
    }) {
      const ctx = yield* InstanceState.context
      yield* mapWorktreeError(worktreeSvc.remove(input.payload))
      yield* project.removeSandbox(ctx.project.id, input.payload.directory)
      return true
    })

    const worktreeReset = Effect.fn("ExperimentalHttpApi.worktreeReset")(function* (ctx: {
      payload: Worktree.ResetInput
    }) {
      yield* mapWorktreeError(worktreeSvc.reset(ctx.payload))
      return true
    })

    const session = Effect.fn("ExperimentalHttpApi.session")(function* (ctx: { query: typeof SessionListQuery.Type }) {
      const limit = ctx.query.limit ?? 100
      const all = yield* sessions.listGlobal({
        directory: ctx.query.directory,
        roots: ctx.query.roots,
        start: ctx.query.start,
        cursor: ctx.query.cursor,
        search: ctx.query.search,
        limit: limit + 1,
        archived: ctx.query.archived,
      })
      const list = all.length > limit ? all.slice(0, limit) : all
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          all.length > limit && list.length > 0
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const sessionBackground = Effect.fn("ExperimentalHttpApi.sessionBackground")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      if (!flags.experimentalBackgroundSubagents) return false
      const jobs = (yield* background.list()).filter(
        (job) =>
          job.type === "task" &&
          job.status === "running" &&
          job.metadata?.parentSessionId === ctx.params.sessionID &&
          job.metadata.background !== true,
      )
      const promoted = yield* Effect.forEach(jobs, (job) => background.promote(job.id), { concurrency: "unbounded" })
      return promoted.some((job) => job !== undefined)
    })

    const resource = Effect.fn("ExperimentalHttpApi.resource")(function* () {
      return yield* mcp.resources()
    })

    return handlers
      .handle("capabilities", capabilities)
      .handle("console", getConsole)
      .handle("consoleOrgs", listConsoleOrgs)
      .handle("consoleSwitch", switchConsole)
      .handle("consoleLogin", consoleLogin)
      .handle("consolePoll", consolePoll)
      .handle("consoleCancel", consoleCancel)
      .handle("consoleLogout", consoleLogout)
      .handle("tool", tool)
      .handle("toolIDs", toolIDs)
      .handle("worktree", worktree)
      .handle("worktreeCreate", worktreeCreate)
      .handle("worktreeRemove", worktreeRemove)
      .handle("worktreeReset", worktreeReset)
      .handle("session", session)
      .handle("sessionBackground", sessionBackground)
      .handle("resource", resource)
  }),
)
