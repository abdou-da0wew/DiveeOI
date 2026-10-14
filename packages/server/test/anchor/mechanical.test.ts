import { describe, expect, test } from "bun:test"
import { mechanicalTree, NO_REF, type AnchorTree } from "@/anchor/anchor"
import type { SessionV1 } from "@diveeoi/db/v1/session"
import { MessageID, PartID, SessionID } from "@/session/schema"

const sid = SessionID.make("ses_m")

const user = (n: string, text: string) =>
  message({
    id: `msg_${n}`,
    role: "user",
    parts: [{ id: `prt_${n}`, type: "text", text }],
  })

const assistant = (n: string, text: string) =>
  message({
    id: `msg_${n}`,
    role: "assistant",
    parts: [{ id: `prt_${n}`, type: "text", text }],
  })

function message(input: { id: string; role: "user" | "assistant"; parts: { id: string; type: "text"; text: string }[] }) {
  const id = MessageID.make(input.id)
  return {
    info: { id, role: input.role, sessionID: sid },
    parts: input.parts.map((part) => ({
      id: PartID.make(part.id),
      sessionID: sid,
      messageID: id,
      type: "text" as const,
      text: part.text,
      time: {},
    })),
  } as unknown as SessionV1.WithParts
}

const shape = (tree: AnchorTree) => ({
  objective: tree.objective.ref,
  status: tree.status.ref,
  decisions: tree.decisions.length,
  files: tree.files.length,
  open_questions: tree.open_questions.length,
})

describe("mechanicalTree", () => {
  test("anchors the first user message and the last assistant message", () => {
    const tree = mechanicalTree([
      user("a", "please do the thing"),
      assistant("b", "starting"),
      assistant("c", "done, and here is why"),
    ])
    expect(tree).toBeDefined()
    expect(shape(tree!)).toEqual({
      objective: "msg:msg_a",
      status: "msg:msg_c",
      decisions: 0,
      files: 0,
      open_questions: 0,
    })
  })

  test("never invents sections only a model can summarise", () => {
    const tree = mechanicalTree([user("a", "hi"), assistant("b", "hello")])!
    expect(tree.decisions).toEqual([])
    expect(tree.files).toEqual([])
    expect(tree.open_questions).toEqual([])
    expect(tree.open_todos).toBeUndefined()
  })

  test("uses the none sentinel when there is no assistant response", () => {
    const tree = mechanicalTree([user("a", "just a question, no answer yet")])!
    expect(tree.status.ref).toBe(NO_REF)
    expect(tree.status.label).toBe("no assistant response yet")
  })

  test("uses the none sentinel for the objective when the user spoke last", () => {
    const tree = mechanicalTree([assistant("a", "an unsolicited opening"), user("b", "actually...")])!
    expect(tree.objective.ref).toBe("msg:msg_b")
    expect(tree.status.ref).toBe("msg:msg_a")
  })

  test("clips a long status label so the anchor stays small", () => {
    const tree = mechanicalTree([user("a", "go"), assistant("b", "x".repeat(500))])!
    expect(tree.status.label!.length).toBe(120)
  })

  test("returns undefined when there is nothing substantive to anchor", () => {
    expect(mechanicalTree([])).toBeUndefined()
    expect(mechanicalTree([message({ id: "msg_e", role: "user", parts: [{ id: "prt_e", type: "text", text: "  " }] })])).toBeUndefined()
  })

  test("skips empty messages when picking the first user turn", () => {
    const tree = mechanicalTree([user("a", "   "), assistant("b", "ok"), user("c", "the real ask")])!
    expect(tree.objective.ref).toBe("msg:msg_c")
  })
})
