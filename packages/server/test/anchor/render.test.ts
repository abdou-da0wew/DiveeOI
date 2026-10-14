import { describe, expect, test } from "bun:test"
import { render, type AnchorTree } from "@/anchor/anchor"

const tree = (overrides: Partial<AnchorTree> = {}): AnchorTree => ({
  objective: { ref: "msg:1", label: "ship the console login" },
  decisions: [{ ref: "msg:2", label: "keep the device code server-side" }],
  files: [{ ref: "msg:3", label: "packages/server/src/account/device-login.ts" }],
  open_questions: [{ ref: "msg:4", label: "is the free tier per-account or per-model?" }],
  status: { ref: "msg:5", label: "server done, frontend wired" },
  ...overrides,
})

describe("anchor render", () => {
  test("leads with the objective so the block starts in a stable position", () => {
    const out = render(tree())
    expect(out.startsWith("# Working memory (anchor)")).toBe(true)
    expect(out.indexOf("## Objective")).toBeLessThan(out.indexOf("## Status"))
    expect(out.indexOf("## Status")).toBeLessThan(out.indexOf("## Decisions"))
  })

  test("states that the originals are still reachable, and how", () => {
    const out = render(tree())
    expect(out).toContain("search_memory")
    expect(out).toContain("recall_context")
  })

  test("carries the ref for every entry so a ref can be recalled", () => {
    const out = render(tree())
    expect(out).toContain("ref msg:1")
    expect(out).toContain("ref msg:2")
    expect(out).toContain("ref msg:4")
    // The ref must sit next to its label, not merely somewhere in the block.
    expect(out).toContain("keep the device code server-side (ref msg:2)")
  })

  test("omits sections that are empty rather than rendering empty headings", () => {
    const out = render(
      tree({ decisions: [], files: [], open_questions: [], open_todos: undefined }),
    )
    expect(out).not.toContain("## Decisions")
    expect(out).not.toContain("## Files")
    expect(out).not.toContain("## Open questions")
    expect(out).not.toContain("## Open todos")
    // Objective and status are always present - they are the two things the agent must never lose.
    expect(out).toContain("## Objective")
    expect(out).toContain("## Status")
  })

  test("tolerates missing objective and status labels", () => {
    const out = render(tree({ objective: { ref: "msg:1" }, status: { ref: "msg:5" } }))
    expect(out).toContain("## Objective\n")
    expect(out).toContain("ref msg:1")
    expect(out).not.toContain("undefined")
  })

  test("renders open todos without refs, since they are not yet backed by a message", () => {
    const out = render(tree({ open_todos: [{ content: "write the settings sign-out button" }] }))
    expect(out).toContain("## Open todos")
    expect(out).toContain("- write the settings sign-out button")
  })
})
