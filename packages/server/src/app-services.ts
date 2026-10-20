// packages/server/src/app-services.ts
//
// The application service set of the server.
//
// A layer only ever sees the services it declares as dependencies. Route handlers run with
// the whole application context, so they never miss a service. Workers that live inside the
// server - the task runner and the task generator - are layers of their own, so they only
// see what they declare. The session prompt path reads further services at call time (the
// skill service, ripgrep, the formatter, the snapshot store, the anchor store, ...), and a
// missing one kills the run with "Service not found: @opencode/Skill".
//
// To give the workers the same context the routes have, the application services are
// defined once here and both the HTTP application graph and the workers depend on them.

import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { httpClient } from "@diveeoi/db/effect/layer-node-platform"
import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { Anchor } from "@/anchor/anchor"
import { Auth } from "@/auth"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { Workspace } from "@/control-plane/workspace"
import { Env } from "@/env"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Features } from "@/features"
import { Format } from "@/format"
import { Git } from "@/git"
import { Installation } from "@/installation"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { Provider } from "@/provider/provider"
import { ProviderAuth } from "@/provider/auth"
import { ProviderUserAgent } from "@/provider/user-agent"
import { Question } from "@/question"
import { SessionCompaction } from "@/session/compaction"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { SessionMemoryIntegration } from "@/session/memory"
import { MemoryScheduler } from "@/session/memory-scheduler"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { SessionShare } from "@/share/session"
import { ShareNext } from "@/share/share-next"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { ToolRegistry } from "@/tool/registry"
import { LocalFS } from "@/tool/local-fs"
import { Truncate } from "@/tool/truncate"
import { Worktree } from "@/worktree"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@diveeoi/db/database/database"
import { EventV2 } from "@diveeoi/db/event"
import { ModelsDev } from "@diveeoi/db/models-dev"
import { Npm } from "@diveeoi/db/npm"
import { ProjectV2 } from "@diveeoi/db/project"
import { ProjectCopy } from "@diveeoi/db/project/copy"
import { PtyTicket } from "@diveeoi/db/pty/ticket"
import { Ripgrep } from "@diveeoi/db/ripgrep"
import { SessionProjector } from "@diveeoi/db/session/projector"
import { FSUtil } from "@diveeoi/db/fs-util"
import { Memory } from "@diveeoi/memory"

/**
 * The anchor services are behind a feature flag - the anchor tools only exist when it is
 * on. Kept as its own list so every graph that wants the application services wires the
 * same set.
 */
export const anchorNodes = Features.flags.anchor ? ([Anchor.node] as const) : ([] as const)

/**
 * The application services, in the order they are wired into the HTTP application graph.
 */
export const serviceNodes = [
  Npm.node,
  FSUtil.node,
  Database.node,
  Auth.node,
  Account.node,
  Config.node,
  Env.node,
  Git.node,
  Ripgrep.node,
  Storage.node,
  Snapshot.node,
  Plugin.node,
  ModelsDev.node,
  Provider.node,
  ProviderAuth.node,
  Agent.node,
  Skill.node,
  Discovery.node,
  Question.node,
  Permission.node,
  Todo.node,
  Session.node,
  SessionProjector.node,
  SessionStatus.node,
  BackgroundJob.node,
  RuntimeFlags.node,
  EventV2Bridge.node,
  SessionRunState.node,
  SessionProcessor.node,
  SessionCompaction.node,
  // Explicit rather than inherited from SessionCompaction: the anchor route reads the service
  // with Effect.serviceOption, and relying on transitive hoisting would silently yield an empty
  // list if that graph ever changes.
  ...anchorNodes,
  SessionRevert.node,
  SessionSummary.node,
  SessionPrompt.node,
  ToolRegistry.node,
  // The memory services are behind a feature flag; their nodes already encode that.
  Memory.node,
  SessionMemoryIntegration.node,
  MemoryScheduler.node,
  LocalFS.node,
  ProviderUserAgent.node,
  Instruction.node,
  LLM.node,
  LSP.node,
  MCP.node,
  McpAuth.node,
  Command.node,
  Truncate.node,
  Format.node,
  Project.node,
  Vcs.node,
  Workspace.node,
  Worktree.node,
  Installation.node,
  ShareNext.node,
  SessionShare.node,
  InstanceStore.node,
  httpClient,
  EventV2.node,
  ProjectV2.node,
  ProjectCopy.node,
  PtyTicket.node,
] as const

/**
 * The application services as a group.
 */
export const services = LayerNode.group(serviceNodes)

export * as AppServices from "./app-services"
