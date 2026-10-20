/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { Effect } from "effect"
import { PluginV2 } from "../plugin"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeDiveeoiContent from "./skill/customize-diveeoi.md" with { type: "text" }

export const CustomizeDiveeoiContent = customizeDiveeoiContent

export const Plugin = PluginV2.define({
  id: PluginV2.ID.make("skill"),
  effect: Effect.gen(function* () {
    const skill = yield* SkillV2.Service
    const transform = yield* skill.transform()

    yield* transform((editor) => {
      editor.source(
        new SkillV2.EmbeddedSource({
          type: "embedded",
          skill: new SkillV2.Info({
            name: "customize-diveeoi",
            description:
              "Use ONLY when the user is editing or creating DiveeOI's own configuration: diveeoi.json, diveeoi.jsonc, opencode.json, files under .opencode/, or files under ~/.config/diveeoi/. Also use when creating or fixing DiveeOI agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring DiveeOI itself.",
            location: AbsolutePath.make("/builtin/customize-diveeoi.md"),
            content: CustomizeDiveeoiContent,
          }),
        }),
      )
    })
  }),
})
