import { FileSystem } from "effect/FileSystem"
import { Context, Effect, Layer } from "effect"
import path from "path"
import os from "os"

import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { filesystem } from "@diveeoi/db/effect/layer-node-platform"
import { InstanceState } from "@/effect/instance-state"
import type { BudgetTier } from "./context-budget"

export interface IdentityContent {
  identity: string
  userProfile: string
  mistakes: string[]
  globalLessons: string[]
  projectLessons: string
  sessionContext: string
}

export interface Interface {
  readonly load: () => Effect.Effect<IdentityContent>
  readonly format: (input: { identity: IdentityContent; tier: BudgetTier }) => string
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/IdentityLoader") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem

    const state = yield* InstanceState.make(
      Effect.fn("IdentityLoader.state")((): Effect.Effect<IdentityContent> =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const home = os.homedir()
          const projectDir = ctx.worktree

          const readSafe = (filepath: string): Effect.Effect<string, never, never> =>
            Effect.catch(fs.readFileString(filepath), () => Effect.succeed(""))

          const [identity, userProfile, mistakesStr, globalLessonsStr, projectLessons, sessionContext] = yield* Effect.all(
            [
              readSafe(path.join(home, ".config", "opencode", "identity", "soul.md")),
              readSafe(path.join(home, ".config", "opencode", "identity", "user.md")),
              readSafe(path.join(home, ".config", "opencode", "identity", "mistakes.md")),
              readSafe(path.join(home, ".config", "opencode", "docs", "lessons.md")),
              readSafe(path.join(projectDir, "PROJECT_LESSONS.md")),
              readSafe(path.join(projectDir, "SESSION_CONTEXT.md")),
            ],
          )

          const parseBulletList = (text: string): string[] =>
            text
              .split("\n")
              .map((l) => l.replace(/^[-*]\s+/, "").trim())
              .filter((l) => l.length > 0 && !l.startsWith("#"))

          return {
            identity,
            userProfile,
            mistakes: parseBulletList(mistakesStr),
            globalLessons: parseBulletList(globalLessonsStr),
            projectLessons,
            sessionContext,
          } as IdentityContent
        }),
      ),
    )

    const load = Effect.fn("IdentityLoader.load")((): Effect.Effect<IdentityContent> =>
      Effect.gen(function* () {
        return yield* InstanceState.get(state)
      }),
    )

    const format = (input: { identity: IdentityContent; tier: BudgetTier }): string => {
      const { identity, tier } = input

      switch (tier) {
        case "critically-limited":
          return ""
        case "tight": {
          const parts = [
            identity.identity ? `Agent: ${identity.identity}` : "",
            identity.userProfile ? `User: ${identity.userProfile}` : "",
            identity.projectLessons ? `Project: ${identity.projectLessons}` : "",
          ]
          return parts.filter(Boolean).join(". ") + "."
        }
        case "normal":
          return [identity.identity, identity.userProfile].filter(Boolean).join("\n\n")
        default: {
          const sections: string[] = []
          if (identity.identity) sections.push(identity.identity)
          if (identity.userProfile) sections.push(identity.userProfile)
          if (identity.mistakes.length > 0) {
            sections.push("## Mistakes to Avoid\n" + identity.mistakes.map((m) => `- ${m}`).join("\n"))
          }
          if (identity.globalLessons.length > 0) {
            sections.push("## Global Lessons\n" + identity.globalLessons.map((l) => `- ${l}`).join("\n"))
          }
          if (identity.projectLessons) sections.push("## Project Lessons\n" + identity.projectLessons)
          if (identity.sessionContext) sections.push("## Session Context\n" + identity.sessionContext)
          return sections.join("\n\n")
        }
      }
    }

    return Service.of({ load, format })
  }),
)

export const node = LayerNode.make(layer, [filesystem])

export * as IdentityLoader from "./identity-loader"
