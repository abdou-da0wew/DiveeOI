import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { filesystem } from "@diveeoi/db/effect/layer-node-platform"
import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { AbsolutePath } from "@diveeoi/db/schema"
import { Location } from "@diveeoi/db/location"
import { LocationServiceMap } from "@diveeoi/db/location-layer"
import { PluginBoot } from "@diveeoi/db/plugin/boot"
import { Reference } from "@diveeoi/db/reference"
import { Reminders } from "./reminders"
import { SessionID } from "./schema"
import { ContextBudget } from "./context-budget"
import { IdentityLoader } from "./identity-loader"
import { SkillMentions } from "./skill-mentions"
import { BtwCommand } from "./btw-command"
import { SessionMemoryIntegration } from "./memory"
import { MemoryError } from "@diveeoi/memory/schema"
import { PlatformError } from "effect/PlatformError"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface SystemAssembly {
  readonly parts: string[]
  readonly btwDetected: boolean
  readonly mentionedSkills: string[]
}

export interface Interface {
  readonly system: (
    model: Provider.Model,
    agent: Agent.Info,
    msgs: ReadonlyArray<{ info: { role: string }; parts?: ReadonlyArray<{ text?: string }> }>,
    sessionID: SessionID,
  ) => Effect.Effect<SystemAssembly, MemoryError | PlatformError, any>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const locations = yield* LocationServiceMap
    const reminderService = yield* Reminders.Service
    const identityLoader = yield* IdentityLoader.Service
    const contextBudget = yield* ContextBudget.Service
    const skillMentions = yield* SkillMentions.Service
    const memory = yield* SessionMemoryIntegration.Service

    return Service.of({
      system: Effect.fn("SystemPrompt.system")(function* (
        model: Provider.Model,
        agent: Agent.Info,
        msgs: ReadonlyArray<{ info: { role: string }; parts?: ReadonlyArray<{ text?: string }> }>,
        sessionID: SessionID,
      ) {
        const ctx = yield* InstanceState.context

        const budgetInfo = ContextBudget.compute({ model, currentTokenEstimate: 0 })
        const tier = budgetInfo.tier

        const lastUserMsg = [...msgs].reverse().find((m) => m.info.role === "user")
        const lastUserContent = lastUserMsg?.parts?.map((p) => p.text ?? "").join(" ") ?? ""

        const mentionResult = yield* skillMentions.parse(lastUserContent)
        const btwResult = BtwCommand.parse(lastUserContent)

        const identityContent = yield* identityLoader.load()
        const identityBlock = identityLoader.format({ identity: identityContent, tier })

        const reminders = yield* reminderService.list(sessionID)
        const remindersBlock = reminderService.format(reminders, tier)

        const references = yield* Effect.gen(function* () {
          yield* (yield* PluginBoot.Service).wait()
          return (yield* (yield* Reference.Service).list()).filter((reference) => reference.description !== undefined)
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))))

        // Load memory context
        const memoryContext = yield* memory.loadSessionContext(sessionID)

        const envParts: string[] = [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${"vcs" in ctx.project && ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
        ]

        if (references.length > 0) {
          envParts.push(
            [
              "Project references provide additional directories that can be accessed when relevant.",
              "<available_references>",
              ...references
                .toSorted((a, b) => a.name.localeCompare(b.name))
                .flatMap((reference) => [
                  "  <reference>",
                  `    <name>${reference.name}</name>`,
                  `    <path>${reference.path}</path>`,
                  ...(reference.description === undefined
                    ? []
                    : [`    <description>${reference.description}</description>`]),
                  "  </reference>",
                ]),
              "</available_references>",
            ].join("\n"),
          )
        }

        let skillsBlock: string | undefined
        if (!Permission.disabled(["skill"], agent.permission).has("skill")) {
          const mentionSkills = mentionResult.mentions.length > 0
            ? skillMentions.formatMentions(mentionResult.mentions)
            : undefined

          if (mentionSkills && (tier === "normal" || tier === "generous" || tier === "unlimited")) {
            skillsBlock = `<skills>\n${mentionSkills}\n</skills>`
          } else {
            const list = yield* skill.available(agent)
            const defaultSkills = Skill.fmt(list, { verbose: tier === "generous" || tier === "unlimited" })
            if (defaultSkills) {
              skillsBlock = defaultSkills
            }
          }
        }

        const budgetHint = `<budget:token_budget>${tier}:${budgetInfo.remainingTokens}</budget:token_budget>`

        const btwBlock = btwResult.found ? BtwCommand.formatForSystem(btwResult.command) : undefined

        const parts: string[] = [
          budgetHint,
          ...envParts,
          ...(identityBlock ? [identityBlock] : []),
          ...(remindersBlock ? [remindersBlock] : []),
          ...(skillsBlock ? [skillsBlock] : []),
          ...(btwBlock ? [btwBlock] : []),
          ...(memoryContext ? [memoryContext] : []),
        ]

        return {
          parts,
          btwDetected: btwResult.found,
          mentionedSkills: mentionResult.mentions.map((m) => m.name),
        }
      }),
    })
  }),
)

const locationServiceMapNode = LayerNode.make(LocationServiceMap.layer, [])
const contextBudgetNode = LayerNode.make(ContextBudget.layer, [])
const skillMentionsNode = LayerNode.make(SkillMentions.layer, [filesystem])

export const defaultLayer = layer.pipe(
  Layer.provide(Skill.defaultLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(Reminders.defaultLayer),
  Layer.provide(IdentityLoader.layer),
  Layer.provide(ContextBudget.layer),
  Layer.provide(SkillMentions.layer),
)

export const node = LayerNode.make(layer, [
  Skill.node,
  locationServiceMapNode,
  Reminders.node,
  IdentityLoader.node,
  contextBudgetNode,
  skillMentionsNode,
  SessionMemoryIntegration.node,
])

export * as SystemPrompt from "./system"
