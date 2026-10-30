import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@diveeoi/db/fs-util"
import { Global } from "@diveeoi/db/global"
import { PermissionV2 } from "@diveeoi/db/permission"
import { PluginBoot } from "@diveeoi/db/plugin/boot"
import { AbsolutePath } from "@diveeoi/db/schema"
import { SessionV2 } from "@diveeoi/db/session"
import { SkillV2 } from "@diveeoi/db/skill"
import { SkillTool } from "@diveeoi/db/tool/skill"
import { ToolRegistry } from "@diveeoi/db/tool/registry"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_skill_tool_test")

describe("SkillTool", () => {
  it.live("lists available skills, authorizes the selected name, and loads model-facing content", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const directory = path.join(tmp.path, "effect")
          const location = path.join(directory, "SKILL.md")
          const reference = path.join(directory, "reference.md")
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
          yield* Effect.promise(() =>
            Promise.all([fs.writeFile(location, "unused"), fs.writeFile(reference, "reference")]),
          )

          const info: SkillV2.Info = {
            name: "effect",
            description: "Use Effect",
            location: AbsolutePath.make(location),
            content: "# Effect\n\nGuidance",
          }
          let current = [info]
          let embeddedFiles: Record<string, string> = {}
          const assertions: PermissionV2.AssertInput[] = []
          let deny = false
          let bootWaited = false
          const boot = Layer.succeed(
            PluginBoot.Service,
            PluginBoot.Service.of({
              wait: () =>
                Effect.sync(() => {
                  bootWaited = true
                }),
            }),
          )
          const permission = Layer.succeed(
            PermissionV2.Service,
            PermissionV2.Service.of({
              assert: (input) =>
                Effect.sync(() => assertions.push(input)).pipe(
                  Effect.andThen(deny ? Effect.fail(new PermissionV2.DeniedError({ rules: [] })) : Effect.void),
                ),
              ask: () => Effect.die("unused"),
              reply: () => Effect.die("unused"),
              get: () => Effect.die("unused"),
              forSession: () => Effect.die("unused"),
              list: () => Effect.die("unused"),
            }),
          )
          const skills = Layer.succeed(
            SkillV2.Service,
            SkillV2.Service.of({
              transform: () => Effect.die("unused"),
              sources: () => Effect.die("unused"),
              list: () => Effect.succeed(current),
              resources: () => Effect.succeed(embeddedFiles),
            }),
          )
          const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
          const tool = SkillTool.layer.pipe(
            Layer.provide(registry),
            Layer.provide(permission),
            Layer.provide(FSUtil.defaultLayer),
            Layer.provide(Global.layerWith({ cache: tmp.path })),
            Layer.provide(boot),
            Layer.provide(skills),
          )
          const layer = Layer.mergeAll(permission, skills, registry, boot, tool)

          return yield* Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            expect(bootWaited).toBe(true)
            expect((yield* toolDefinitions(registry))[0]).toMatchObject({
              name: "skill",
              description: SkillTool.description,
            })
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-skill", name: "skill", input: { name: "effect" } },
              }),
            ).toEqual({
              type: "text",
              value: SkillTool.toModelOutput(info, [reference]),
            })
            expect(SkillTool.toModelOutput(info, [reference])).toContain(
              `Base directory for this skill: ${pathToFileURL(directory).href}`,
            )
            expect(
              yield* settleTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-skill-overflow", name: "skill", input: { name: "effect" } },
              }),
            ).toMatchObject({
              result: { type: "text", value: SkillTool.toModelOutput(info, [reference]) },
              output: { structured: { name: "effect" } },
            })
            expect(assertions).toMatchObject([
              { sessionID, action: "skill", resources: ["effect"], save: ["effect"] },
              { sessionID, action: "skill", resources: ["effect"], save: ["effect"] },
            ])
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-missing-skill", name: "skill", input: { name: "missing" } },
              }),
            ).toEqual({ type: "error", value: "Unable to load skill missing" })
            deny = true
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-denied-skill", name: "skill", input: { name: "effect" } },
              }),
            ).toEqual({ type: "error", value: "Unable to load skill effect" })
            deny = false
            const flat = new SkillV2.Info({
              name: "public",
              description: "Public guidance",
              location: AbsolutePath.make(path.join(tmp.path, "public.md")),
              content: "Public",
            })
            yield* Effect.promise(() =>
              Promise.all([
                fs.writeFile(flat.location, "public"),
                fs.writeFile(path.join(tmp.path, "secret.md"), "secret"),
              ]),
            )
            current = [flat]
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-flat-skill", name: "skill", input: { name: "public" } },
              }),
            ).toEqual({ type: "text", value: SkillTool.toModelOutput(flat, []) })

            const embedded = new SkillV2.Info({
              name: "embedded",
              location: AbsolutePath.make("/builtin/embedded/SKILL.md"),
              content: "# Embedded skill",
              source: "embedded",
              metadata: new SkillV2.Metadata({ version: "1.0.0" }),
            })
            current = [embedded]
            embeddedFiles = {
              "SKILL.md": "---\nname: embedded\n---\n\n# Embedded skill",
              "references/guide.md": "Bundled guide text",
            }
            const embeddedDirectory = SkillV2.embeddedDirectory(tmp.path, "embedded", "1.0.0")
            const loaded = yield* executeTool(registry, {
              sessionID,
              ...toolIdentity,
              call: { type: "tool-call", id: "call-embedded-skill", name: "skill", input: { name: "embedded" } },
            })
            expect(loaded.type).toBe("text")
            if (loaded.type === "text") {
              expect(loaded.value).toContain(`Base directory for this skill: ${pathToFileURL(embeddedDirectory).href}`)
              expect(loaded.value).toContain(`<file>${path.join(embeddedDirectory, "references", "guide.md")}</file>`)
            }
            expect(
              yield* Effect.promise(() => fs.readFile(path.join(embeddedDirectory, "references", "guide.md"), "utf8")),
            ).toBe("Bundled guide text")
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )
})
