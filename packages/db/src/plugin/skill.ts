/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { Effect } from "effect"
import { PluginV2 } from "../plugin"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeDiveeoiContent from "./skill/customize-diveeoi.md" with { type: "text" }
import { BUNDLED_SKILLS } from "./skill/bundled"
import { ConfigMarkdown } from "../config/markdown"

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
            location: AbsolutePath.make("/builtin/customize-diveeoi/SKILL.md"),
            content: CustomizeDiveeoiContent,
            source: "embedded",
          }),
          files: { "SKILL.md": CustomizeDiveeoiContent },
        }),
      )

      for (const bundle of BUNDLED_SKILLS) {
        const document = ConfigMarkdown.parseOption(bundle.files["SKILL.md"])
        const frontmatter = document && SkillV2.parseFrontmatter(document.data)
        if (!document || !frontmatter?.name || frontmatter.name !== bundle.name) {
          throw new Error(`Invalid bundled skill frontmatter: ${bundle.name}`)
        }

        const metadata =
          frontmatter.metadata || bundle.sourceRepository || bundle.sourceRevision
            ? new SkillV2.Metadata({
                ...frontmatter.metadata,
                sourceRepository: frontmatter.metadata?.sourceRepository ?? bundle.sourceRepository,
                sourceRevision: frontmatter.metadata?.sourceRevision ?? bundle.sourceRevision,
              })
            : undefined

        editor.source(
          new SkillV2.EmbeddedSource({
            type: "embedded",
            skill: new SkillV2.Info({
              name: frontmatter.name,
              description: frontmatter.description,
              slash: frontmatter.slash,
              location: AbsolutePath.make(`/builtin/${bundle.name}/SKILL.md`),
              content: document.content,
              metadata,
              source: "embedded",
            }),
            files: bundle.files,
          }),
        )
      }
    })
  }),
})
