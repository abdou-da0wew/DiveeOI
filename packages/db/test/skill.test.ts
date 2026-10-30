import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@diveeoi/db/agent"
import { FSUtil } from "@diveeoi/db/fs-util"
import { AbsolutePath } from "@diveeoi/db/schema"
import { SkillV2 } from "@diveeoi/db/skill"
import { SkillDiscovery } from "@diveeoi/db/skill/discovery"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const urls = new Map<string, AbsolutePath[]>()
let pulls = 0
const discovery = Layer.succeed(
  SkillDiscovery.Service,
  SkillDiscovery.Service.of({
    pull: (url) => {
      pulls++
      return Effect.succeed(urls.get(url) ?? [])
    },
  }),
)
const it = testEffect(
  SkillV2.layer.pipe(
    Layer.provide(discovery),
    Layer.provideMerge(FSUtil.defaultLayer),
    Layer.provideMerge(AgentV2.locationLayer),
  ),
)

function write(directory: string, name: string, description: string) {
  return fs.writeFile(
    path.join(directory, name, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---
# ${name}`,
  )
}

describe("SkillV2", () => {
  it.live("registers sources and resolves later source precedence", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const first = path.join(tmp.path, "first")
          const second = path.join(tmp.path, "second")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(first, "review"), { recursive: true })
            await fs.mkdir(path.join(second, "review"), { recursive: true })
            await write(first, "review", "First")
            await write(second, "review", "Second")
            await fs.writeFile(path.join(first, "foo.md"), "---\nslash: true\n---\n# foo")
          })

          const skill = yield* SkillV2.Service
          const register = yield* skill.transform()
          yield* register((editor) => {
            editor.source({ type: "directory", path: AbsolutePath.make(first) })
            editor.source({ type: "directory", path: AbsolutePath.make(first) })
            editor.source({ type: "directory", path: AbsolutePath.make(second) })
            expect(editor.list()).toEqual([
              { type: "directory", path: AbsolutePath.make(first) },
              { type: "directory", path: AbsolutePath.make(second) },
            ])
          })

          expect(yield* skill.sources()).toEqual([
            { type: "directory", path: AbsolutePath.make(first) },
            { type: "directory", path: AbsolutePath.make(second) },
          ])
          expect(yield* skill.list()).toEqual([
            new SkillV2.Info({
              name: "foo",
              slash: true,
              location: AbsolutePath.make(path.join(first, "foo.md")),
              content: "# foo",
              source: "directory",
            }),
            {
              name: "review",
              description: "Second",
              location: AbsolutePath.make(path.join(second, "review", "SKILL.md")),
              content: "# review",
              source: "directory",
            },
          ])
        }),
      ),
    ),
  )

  it.live("loads URL sources and filters skills for agents", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "deploy"), { recursive: true })
            await write(tmp.path, "deploy", "Deploy production")
          })
          pulls = 0
          urls.set("https://example.test/skills/", [AbsolutePath.make(tmp.path)])

          const agents = yield* AgentV2.Service
          yield* agents.update((editor) =>
            editor.update(AgentV2.ID.make("reviewer"), (agent) => {
              agent.permissions.push({ action: "skill", resource: "deploy", effect: "deny" })
            }),
          )

          const skill = yield* SkillV2.Service
          const register = yield* skill.transform()
          yield* register((editor) => editor.source({ type: "url", url: "https://example.test/skills/" }))

          expect((yield* skill.list()).map((item) => item.name)).toEqual(["deploy"])
          expect((yield* skill.list()).map((item) => item.name)).toEqual(["deploy"])
          expect(pulls).toBe(1)
          expect(SkillV2.available(yield* skill.list(), (yield* agents.get(AgentV2.ID.make("reviewer")))!)).toEqual([])
        }),
      ),
    ),
  )

  it.effect("parses standard, kebab-case, nested, and extension metadata", () =>
    Effect.sync(() => {
      const frontmatter = SkillV2.parseFrontmatter({
        name: "metadata-skill",
        description: "Metadata test",
        "argument-hint": "Describe the topic",
        "allowed-tools": "websearch webfetch",
        "disable-model-invocation": "true",
        customRoot: { flag: true },
        metadata: {
          category: "Research",
          tags: ["sources", "analysis"],
          triggers: ["compare evidence"],
          version: "2.1.0",
          author: "Test Author",
          license: "MIT",
          compatibility: "DiveeOI",
          homepage: "https://example.test/skill",
          repository: "https://github.com/example/skill",
          "user-invocable": false,
          openclaw: { requires: { bins: ["rg"], env: ["API_TOKEN"] } },
          vendorField: { rank: 3 },
        },
      })

      expect(frontmatter?.name).toBe("metadata-skill")
      expect(frontmatter?.description).toBe("Metadata test")
      expect(frontmatter?.metadata).toMatchObject({
        category: "Research",
        tags: ["sources", "analysis"],
        triggers: ["compare evidence"],
        version: "2.1.0",
        author: "Test Author",
        license: "MIT",
        compatibility: "DiveeOI",
        homepage: "https://example.test/skill",
        repository: "https://github.com/example/skill",
        requirements: { bins: ["rg"], env: ["API_TOKEN"] },
        allowedTools: ["websearch", "webfetch"],
        argumentHint: "Describe the topic",
        userInvocable: false,
        disableModelInvocation: true,
        attributes: {
          customRoot: { flag: true },
          vendorField: { rank: 3 },
          openclaw: { requires: { bins: ["rg"], env: ["API_TOKEN"] } },
        },
      })
    }),
  )

  it.effect("filters non-invocable skills from user-facing slash commands", () =>
    Effect.sync(() => {
      const make = (name: string, userInvocable?: boolean) =>
        new SkillV2.Info({
          name,
          location: AbsolutePath.make(`/builtin/${name}/SKILL.md`),
          content: "# skill",
          metadata: userInvocable === undefined ? undefined : new SkillV2.Metadata({ userInvocable }),
        })
      expect(SkillV2.slashCommands([make("default"), make("hidden", false)]).map((item) => item.name)).toEqual([
        "default",
      ])
    }),
  )

  it.live("materializes embedded skill resources and rejects unsafe paths", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const directory = path.join(tmp.path, "cache", "skills", "embedded", "demo", "1.0.0")
          const fsys = yield* FSUtil.Service
          const written = yield* SkillV2.materialize(fsys, directory, {
            "SKILL.md": "# Demo",
            "references/guide.md": "Reference text",
            "../escape.txt": "must not escape",
            "%2e%2e/encoded.txt": "must not escape",
            "C:/drive.txt": "must not escape",
          })

          expect(written).toHaveLength(2)
          expect(written).toContain(path.join(directory, "SKILL.md"))
          expect(written).toContain(path.join(directory, "references", "guide.md"))
          expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "SKILL.md"), "utf8"))).toBe("# Demo")
          expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "references", "guide.md"), "utf8"))).toBe(
            "Reference text",
          )
          expect(
            yield* Effect.promise(() =>
              fs
                .readFile(path.join(tmp.path, "cache", "skills", "embedded", "demo", "escape.txt"), "utf8")
                .catch(() => undefined),
            ),
          ).toBeUndefined()
          expect(SkillV2.embeddedResourcePath(directory, "../../outside.md")).toBeUndefined()
          expect(SkillV2.embeddedResourcePath(directory, "/absolute.md")).toBeUndefined()
          expect(SkillV2.embeddedResourcePath(directory, "references/ok.md")).toBe(
            path.join(directory, "references", "ok.md"),
          )
        }),
      ),
    ),
  )
})
