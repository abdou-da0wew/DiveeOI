export * as SkillV2 from "./skill"

import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { castDraft } from "immer"
import { AgentV2 } from "./agent"
import { ConfigMarkdown } from "./config/markdown"
import { FSUtil } from "./fs-util"
import { PermissionV2 } from "./permission"
import { AbsolutePath, withStatics } from "./schema"
import { SkillDiscovery } from "./skill/discovery"
import { State } from "./state"

export class DirectorySource extends Schema.Class<DirectorySource>("SkillV2.DirectorySource")({
  type: Schema.Literal("directory"),
  path: AbsolutePath,
}) {}

export class UrlSource extends Schema.Class<UrlSource>("SkillV2.UrlSource")({
  type: Schema.Literal("url"),
  url: Schema.String,
}) {}

export class EmbeddedSource extends Schema.Class<EmbeddedSource>("SkillV2.EmbeddedSource")({
  type: Schema.Literal("embedded"),
  skill: Schema.suspend(() => Info),
  files: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
}) {}

export const Origin = Schema.Literals(["embedded", "directory", "url"])
export type Origin = typeof Origin.Type

export class Metadata extends Schema.Class<Metadata>("SkillV2.Metadata")({
  category: Schema.String.pipe(Schema.optional),
  tags: Schema.Array(Schema.String).pipe(Schema.optional),
  version: Schema.String.pipe(Schema.optional),
  author: Schema.String.pipe(Schema.optional),
  license: Schema.String.pipe(Schema.optional),
  compatibility: Schema.String.pipe(Schema.optional),
  homepage: Schema.String.pipe(Schema.optional),
  repository: Schema.String.pipe(Schema.optional),
  sourceRepository: Schema.String.pipe(Schema.optional),
  sourceRevision: Schema.String.pipe(Schema.optional),
  triggers: Schema.Array(Schema.String).pipe(Schema.optional),
  requirements: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  allowedTools: Schema.Array(Schema.String).pipe(Schema.optional),
  argumentHint: Schema.String.pipe(Schema.optional),
  userInvocable: Schema.Boolean.pipe(Schema.optional),
  disableModelInvocation: Schema.Boolean.pipe(Schema.optional),
  attributes: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
}) {}

export const Source = Schema.Union([DirectorySource, UrlSource, EmbeddedSource]).pipe(
  Schema.toTaggedUnion("type"),
  withStatics(() => ({
    equals: (a: DirectorySource | UrlSource | EmbeddedSource, b: DirectorySource | UrlSource | EmbeddedSource) => {
      if (a.type !== b.type) return false
      if (a.type === "directory" && b.type === "directory") return a.path === b.path
      if (a.type === "url" && b.type === "url") return a.url === b.url
      if (a.type === "embedded" && b.type === "embedded")
        return (
          a.skill.name === b.skill.name &&
          (a.skill.metadata?.sourceRevision ?? a.skill.metadata?.version) ===
            (b.skill.metadata?.sourceRevision ?? b.skill.metadata?.version)
        )
      return false
    },
    key: (source: DirectorySource | UrlSource | EmbeddedSource) =>
      source.type === "directory"
        ? `directory:${source.path}`
        : source.type === "url"
          ? `url:${source.url}`
          : `embedded:${source.skill.name}:${source.skill.metadata?.sourceRevision ?? source.skill.metadata?.version ?? "unversioned"}`,
  })),
)
export type Source = typeof Source.Type

export class Info extends Schema.Class<Info>("SkillV2.Info")({
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  slash: Schema.Boolean.pipe(Schema.optional),
  location: AbsolutePath,
  content: Schema.String,
  metadata: Metadata.pipe(Schema.optional),
  source: Origin.pipe(Schema.optional),
}) {}

export const available = (skills: ReadonlyArray<Info>, agent: AgentV2.Info) =>
  skills.filter(
    (skill) =>
      !skill.metadata?.disableModelInvocation &&
      PermissionV2.evaluate("skill", skill.name, agent.permissions).effect !== "deny",
  )

export const slashCommands = (skills: ReadonlyArray<Info>) =>
  skills.filter((skill) => skill.slash !== false && skill.metadata?.userInvocable !== false)

export interface Frontmatter {
  readonly name?: string
  readonly description?: string
  readonly slash?: boolean
  readonly metadata?: Metadata
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stringValue = (...values: unknown[]) =>
  values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim()

const stringList = (...values: unknown[]): string[] | undefined => {
  for (const value of values) {
    const items =
      typeof value === "string"
        ? value.split(/[\s,]+/)
        : Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : []
    const result = items.map((item) => item.trim()).filter(Boolean)
    if (result.length) return result
  }
  return undefined
}

const booleanValue = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "boolean") return value
    if (typeof value !== "string") continue
    if (value.toLowerCase() === "true") return true
    if (value.toLowerCase() === "false") return false
  }
  return undefined
}

const metadataKeys = new Set([
  "category",
  "tags",
  "version",
  "author",
  "license",
  "compatibility",
  "homepage",
  "repository",
  "sourceRepository",
  "source-repository",
  "sourceRevision",
  "source-revision",
  "requires",
  "triggers",
  "requirements",
  "allowedTools",
  "allowed-tools",
  "argumentHint",
  "argument-hint",
  "userInvocable",
  "user-invocable",
  "disableModelInvocation",
  "disable-model-invocation",
])

export function parseFrontmatter(value: unknown): Frontmatter | undefined {
  if (!isRecord(value)) return undefined
  const raw = isRecord(value.metadata) ? value.metadata : {}
  const nested = [raw.clawdbot, raw.openclaw, raw.opencode].filter(isRecord)
  const requirements = [
    value.requirements,
    value.requires,
    raw.requirements,
    raw.requires,
    ...nested.map((item) => item.requires),
  ].find(isRecord)
  const rootKeys = new Set([
    ...metadataKeys,
    "name",
    "description",
    "slash",
    "metadata",
    "requires",
    "clawdbot",
    "openclaw",
    "opencode",
  ])
  const attributes = Object.fromEntries([
    ...Object.entries(value).filter(([key]) => !rootKeys.has(key)),
    ...Object.entries(raw).filter(([key]) => !metadataKeys.has(key)),
  ])
  const metadata = new Metadata({
    category: stringValue(value.category, raw.category),
    tags: stringList(value.tags, raw.tags),
    version: stringValue(value.version, raw.version),
    author: stringValue(value.author, raw.author),
    license: stringValue(value.license, raw.license),
    compatibility: stringValue(value.compatibility, raw.compatibility),
    homepage: stringValue(value.homepage, raw.homepage),
    repository: stringValue(value.repository, raw.repository),
    sourceRepository: stringValue(
      value.sourceRepository,
      value["source-repository"],
      raw.sourceRepository,
      raw["source-repository"],
    ),
    sourceRevision: stringValue(
      value.sourceRevision,
      value["source-revision"],
      raw.sourceRevision,
      raw["source-revision"],
    ),
    triggers: stringList(value.triggers, raw.triggers),
    requirements,
    allowedTools: stringList(value["allowed-tools"], value.allowedTools, raw["allowed-tools"], raw.allowedTools),
    argumentHint: stringValue(value["argument-hint"], value.argumentHint, raw["argument-hint"], raw.argumentHint),
    userInvocable: booleanValue(value["user-invocable"], value.userInvocable, raw["user-invocable"], raw.userInvocable),
    disableModelInvocation: booleanValue(
      value["disable-model-invocation"],
      value.disableModelInvocation,
      raw["disable-model-invocation"],
      raw.disableModelInvocation,
    ),
    attributes: Object.keys(attributes).length ? attributes : undefined,
  })
  const hasMetadata = Object.values(metadata).some((item) => item !== undefined)
  const name = stringValue(value.name)
  const description = stringValue(value.description)
  return {
    name,
    description,
    slash: booleanValue(value.slash),
    metadata: hasMetadata ? metadata : undefined,
  }
}

export type Data = {
  sources: Source[]
}

export type Editor = {
  source: (source: Source) => void
  list: () => readonly Source[]
}

export interface Interface {
  readonly transform: State.Interface<Data, Editor>["transform"]
  readonly sources: () => Effect.Effect<Source[]>
  readonly list: () => Effect.Effect<Info[]>
  readonly resources: (name: string) => Effect.Effect<Record<string, string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Skill") {}

type Loaded = {
  skills: Info[]
  files: Map<string, Record<string, string>>
}

export function embeddedDirectory(cacheRoot: string, name: string, revision?: string) {
  const segment = (value: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) || value === "." || value === "..")
      throw new Error(`Invalid embedded skill path segment: ${value}`)
    return value
  }
  return path.join(cacheRoot, "skills", "embedded", segment(name), segment(revision ?? "unversioned"))
}

export function embeddedResourcePath(directory: string, relative: string) {
  if (
    !relative ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    relative.includes("?") ||
    relative.includes("#") ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    URL.canParse(relative)
  )
    return undefined

  const parts = relative.split("/")
  if (
    parts.some((part) => {
      if (!part || part.includes(":")) return true
      try {
        const decoded = decodeURIComponent(part)
        return (
          decoded === "." ||
          decoded === ".." ||
          decoded.includes(":") ||
          decoded.includes("/") ||
          decoded.includes("\\") ||
          decoded.includes("\0")
        )
      } catch {
        return true
      }
    })
  )
    return undefined

  const root = path.resolve(directory)
  const destination = path.resolve(root, ...parts)
  if (destination === root || !FSUtil.contains(root, destination)) return undefined
  return destination
}

export const materialize = Effect.fnUntraced(function* (
  fs: FSUtil.Interface,
  directory: string,
  files: Readonly<Record<string, string>>,
) {
  const written: string[] = []
  for (const [relative, content] of Object.entries(files).toSorted(([a], [b]) => a.localeCompare(b))) {
    const destination = embeddedResourcePath(directory, relative)
    if (!destination) continue
    yield* fs.writeWithDirs(destination, content)
    written.push(destination)
  }
  return written
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service

    const state = State.create<Data, Editor>({
      initial: () => ({ sources: [] }),
      editor: (draft) => ({
        source: (source) => {
          if (draft.sources.some((item) => Source.equals(item, source))) return
          draft.sources.push(castDraft(source))
        },
        list: () => draft.sources as Source[],
      }),
    })

    const load = Effect.fn("SkillV2.load")(function* (source: Source) {
      if (source.type === "embedded") {
        const skill = new Info({ ...source.skill, source: "embedded" })
        return { skills: [skill], files: new Map([[skill.name, source.files ?? {}]]) }
      }

      const skills: Info[] = []
      const files = new Map<string, Record<string, string>>()
      const directories = source.type === "directory" ? [source.path] : yield* discovery.pull(source.url)
      for (const directory of directories) {
        const paths = yield* fs
          .glob("{*.md,**/SKILL.md}", { cwd: directory, absolute: true, include: "file", symlink: true, dot: true })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
        for (const filepath of paths.toSorted()) {
          const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!content) continue
          const markdown = ConfigMarkdown.parseOption(content)
          if (!markdown) continue
          const frontmatter = parseFrontmatter(markdown.data)
          if (!frontmatter) continue
          const name =
            frontmatter.name !== undefined
              ? frontmatter.name
              : path.dirname(filepath) === directory
                ? path.basename(filepath, ".md")
                : undefined
          if (!name) continue
          skills.push(
            new Info({
              name,
              location: AbsolutePath.make(filepath),
              content: markdown.content,
              source: source.type,
              ...(frontmatter.description !== undefined ? { description: frontmatter.description } : {}),
              ...(frontmatter.slash !== undefined ? { slash: frontmatter.slash } : {}),
              ...(frontmatter.metadata !== undefined ? { metadata: frontmatter.metadata } : {}),
            }),
          )
          files.set(name, {})
        }
      }
      return { skills, files }
    })

    // Local skill sources are cached for the lifetime of this service.
    const cache = new Map<string, Loaded>()
    const resolve = Effect.fn("SkillV2.resolve")(function* () {
      const skills = new Map<string, Info>()
      const files = new Map<string, Record<string, string>>()
      for (const source of state.get().sources) {
        const key = Source.key(source)
        const loaded = cache.get(key) ?? (yield* load(source))
        cache.set(key, loaded)
        for (const skill of loaded.skills) {
          skills.set(skill.name, skill)
          files.set(skill.name, loaded.files.get(skill.name) ?? {})
        }
      }
      return { skills: Array.from(skills.values()), files }
    })

    const list = Effect.fn("SkillV2.list")(function* () {
      return (yield* resolve()).skills
    })

    return Service.of({
      transform: state.transform,
      sources: Effect.fn("SkillV2.sources")(function* () {
        return state.get().sources
      }),
      list,
      resources: Effect.fn("SkillV2.resources")(function* (name: string) {
        return (yield* resolve()).files.get(name) ?? {}
      }),
    })
  }),
)

export const locationLayer = layer.pipe(Layer.provide(SkillDiscovery.defaultLayer))
