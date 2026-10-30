import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@diveeoi/db/agent"
import { FSUtil } from "@diveeoi/db/fs-util"
import { SkillPlugin } from "@diveeoi/db/plugin/skill"
import { SkillV2 } from "@diveeoi/db/skill"
import { SkillDiscovery } from "@diveeoi/db/skill/discovery"
import { testEffect } from "../lib/effect"

const it = testEffect(
  SkillV2.layer.pipe(
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(SkillDiscovery.defaultLayer),
    Layer.provideMerge(AgentV2.locationLayer),
  ),
)

describe("SkillPlugin.Plugin", () => {
  it.effect("registers the DiveeOI and curated bundled skills with embedded resources", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* SkillPlugin.Plugin.effect.pipe(Effect.provideService(SkillV2.Service, skill))

      const registered = yield* skill.list()
      expect(registered).toContainEqual(
        expect.objectContaining({
          name: "customize-diveeoi",
          description: expect.stringContaining("DiveeOI's own configuration"),
          source: "embedded",
        }),
      )
      expect(registered.map((item) => item.name)).toContain("coding-agent")
      expect(registered.map((item) => item.name)).toContain("research-explorer")
      expect(registered.map((item) => item.name)).toContain("xlsx")

      const coding = registered.find((item) => item.name === "coding-agent")
      expect(coding?.metadata?.sourceRepository).toBe("https://github.com/abdou-da0wew/zcode-skills")
      expect(coding?.metadata?.sourceRevision).toBe("67bcca5e0467bda037dfe18d691d91f3386191f9")
      expect(yield* skill.resources("coding-agent")).toHaveProperty("criteria.md")
      expect(yield* skill.resources("skill-creator")).toHaveProperty("LICENSE.txt")
    }),
  )
})
