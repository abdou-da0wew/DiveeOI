import { FileSystem } from "effect/FileSystem"
import { Context, Effect, Layer } from "effect"
import { PlatformError } from "effect/PlatformError"
import path from "path"

import { InstanceState } from "@/effect/instance-state"

export interface SkillManifest {
  name: string
  description: string
  whenToUse: string
  body: string
}

export interface SkillMention {
  name: string
  manifest: SkillManifest
}

export interface ParserOutput {
  mentions: SkillMention[]
  unknown: string[]
  formatted: string
}

export interface Interface {
  readonly parse: (text: string) => Effect.Effect<ParserOutput, PlatformError, any>
  readonly getManifest: (name: string) => Effect.Effect<SkillManifest | null, PlatformError, any>
  readonly listAvailable: () => Effect.Effect<SkillManifest[], PlatformError, any>
  readonly formatMentions: (mentions: SkillMention[]) => string
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/SkillMentions") {}

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("---")) return null

  const end = trimmed.indexOf("---", 3)
  if (end === -1) return null

  const frontmatter = trimmed.slice(3, end).trim()
  const body = trimmed.slice(end + 3).trim()

  const data: Record<string, string> = {}
  for (const line of frontmatter.split("\n")) {
    const colon = line.indexOf(":")
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (key && value) data[key] = value
  }

  return { data, body }
}

function toManifest(name: string, parsed: { data: Record<string, string>; body: string }): SkillManifest {
  return {
    name: parsed.data.name ?? name,
    description: parsed.data.description ?? "",
    whenToUse: parsed.data.when_to_use ?? "",
    body: parsed.body,
  }
}

const MENTION_RE = /(?:^|\s)@([a-zA-Z0-9_-]+)/g

function formatMentions(mentions: SkillMention[]): string {
  return mentions
    .map((m) => [
      `<skill name="${m.name}">`,
      m.manifest.description,
      m.manifest.body,
      "</skill>",
    ].join("\n"))
    .join("\n\n")
}

const loadManifest = Effect.fnUntraced(function* (fs: FileSystem, projectDir: string, name: string) {
  const skillPath = path.join(projectDir, "skills", name, "SKILL.md")
  const exists = yield* fs.exists(skillPath)
  if (!exists) return null as SkillManifest | null

  const raw = yield* fs.readFileString(skillPath)
  const parsed = parseFrontmatter(raw)
  if (!parsed) return null

  return toManifest(name, parsed)
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem

    const state = yield* InstanceState.make(
      Effect.fn("SkillMentions.state")(() =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          return ctx.worktree
        }),
      ),
    )

    const parse = Effect.fn("SkillMentions.parse")(function* (text: string) {
      const projectDir = yield* InstanceState.get(state)

      const names = Array.from(text.matchAll(MENTION_RE), (m) => m[1])
      const unique = [...new Set(names)]

      const results = yield* Effect.forEach(unique, (name) =>
        Effect.map(loadManifest(fs, projectDir, name), (manifest) => ({ name, manifest } as const)),
      )

      const mentions: SkillMention[] = []
      const unknown: string[] = []

      for (const { name, manifest } of results) {
        if (manifest) {
          mentions.push({ name, manifest })
        } else {
          unknown.push(name)
        }
      }

      const formatted = formatMentions(mentions)

      return { mentions, unknown, formatted } satisfies ParserOutput
    })

    const getManifest = Effect.fn("SkillMentions.getManifest")(function* (name: string) {
      const projectDir = yield* InstanceState.get(state)
      return yield* loadManifest(fs, projectDir, name)
    })

    const listAvailable = Effect.fn("SkillMentions.listAvailable")(function* () {
      const projectDir = yield* InstanceState.get(state)
      const skillsDir = path.join(projectDir, "skills")

      const skillsDirExists = yield* fs.exists(skillsDir)
      if (!skillsDirExists) return []

      const entries = yield* fs.readDirectory(skillsDir)

      const manifests = yield* Effect.forEach(entries, (entry) =>
        Effect.gen(function* () {
          const skillPath = path.join(skillsDir, entry, "SKILL.md")
          const exists = yield* fs.exists(skillPath)
          if (!exists) return null

          const raw = yield* fs.readFileString(skillPath)
          const parsed = parseFrontmatter(raw)
          if (!parsed) return null

          return toManifest(entry, parsed)
        }),
      )

      return manifests.filter((m): m is SkillManifest => m !== null)
    })

    return Service.of({ parse, getManifest, listAvailable, formatMentions })
  }),
)

export * as SkillMentions from "./skill-mentions"
