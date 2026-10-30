import path from "path"
import { pathToFileURL } from "url"
import { Effect, Schema } from "effect"
import { Ripgrep } from "@diveeoi/db/ripgrep"
import { Global } from "@diveeoi/db/global"
import { FSUtil } from "@diveeoi/db/fs-util"
import { SkillV2 } from "@diveeoi/db/skill"
import { Skill } from "../skill"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const ripgrep = yield* Ripgrep.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* skill
            .require(params.name)
            .pipe(Effect.catchTag("Skill.NotFoundError", (error) => Effect.die(new Error(error.message))))

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })

          const embeddedResources = info.source === "embedded" ? yield* skill.resources(info.name) : undefined
          const dir =
            info.source === "embedded"
              ? SkillV2.embeddedDirectory(
                  global.cache,
                  info.name,
                  info.metadata?.sourceRevision ?? info.metadata?.version,
                )
              : path.dirname(info.location)
          if (embeddedResources) {
            yield* SkillV2.materialize(fs, dir, {
              "SKILL.md": info.content,
              ...embeddedResources,
            })
          }
          const base = pathToFileURL(dir).href
          const files = yield* ripgrep.find({
            cwd: dir,
            pattern: "!**/SKILL.md",
            hidden: true,
            follow: false,
            signal: ctx.abort,
            limit: 10,
          })

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${info.name}">`,
              `# Skill: ${info.name}`,
              "",
              info.content.trim(),
              "",
              `Base directory for this skill: ${base}`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files.map((file) => `<file>${path.resolve(dir, file.path)}</file>`).join("\n"),
              "</skill_files>",
              "</skill_content>",
            ].join("\n"),
            metadata: {
              name: info.name,
              dir,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
