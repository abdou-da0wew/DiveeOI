import { describe, expect, it } from "bun:test"
import { SkillV2 } from "@diveeoi/db/skill"
import { Command } from "../../src/command"
import { Skill } from "../../src/skill"

const skill = (input: Partial<Skill.Info> & Pick<Skill.Info, "name">): Skill.Info => ({
  name: input.name,
  description: input.description,
  slash: input.slash,
  location: input.location ?? `/skills/${input.name}/SKILL.md`,
  content: input.content ?? `# ${input.name}`,
  metadata: input.metadata,
  source: input.source,
})

describe("Command.fromSkill", () => {
  it("keeps user-invocable skills and exposes argument hints", () => {
    const command = Command.fromSkill(
      skill({
        name: "interview-prep",
        description: "Prepare for an interview.",
        metadata: new SkillV2.Metadata({ userInvocable: true, argumentHint: "Share the role and job description" }),
      }),
    )

    expect(command).toMatchObject({
      name: "interview-prep",
      description: "Prepare for an interview.",
      source: "skill",
      template: "# interview-prep",
      argumentHint: "Share the role and job description",
      hints: [],
    })
  })

  it("hides skills that opt out of slash-command invocation", () => {
    expect(Command.fromSkill(skill({ name: "hidden", metadata: new SkillV2.Metadata({ userInvocable: false }) }))).toBe(
      undefined,
    )
    expect(Command.fromSkill(skill({ name: "no-slash", slash: false }))).toBe(undefined)
  })
})
