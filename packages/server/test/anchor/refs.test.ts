import { describe, expect, test } from "bun:test"
import { collectRefs, normalizeRef, validateTree, buildRepairPrompt, NO_REF, type AnchorTree } from "@/anchor/anchor"
import type { SessionV1 } from "@diveeoi/db/v1/session"
import { MessageID, PartID, SessionID } from "@/session/schema"

const sid = SessionID.make("ses_t")
const mid = (n: string) => MessageID.make(`msg_${n}`)
const pid = (n: string) => PartID.make(`prt_${n}`)

const messages = [
  {
    info: { id: mid("a"), role: "user", sessionID: sid },
    parts: [{ id: pid("a1"), sessionID: sid, messageID: mid("a"), type: "text", text: "hi", time: {} }],
  },
  {
    info: { id: mid("b"), role: "assistant", sessionID: sid },
    parts: [
      { id: pid("b1"), sessionID: sid, messageID: mid("b"), type: "text", text: "ok", time: {} },
      {
        id: pid("b2"),
        sessionID: sid,
        messageID: mid("b"),
        type: "tool",
        tool: "read",
        time: {},
        state: { status: "completed", input: {}, output: "x", title: "t", metadata: {}, time: { start: 1, end: 2 } },
      },
    ],
  },
] as unknown as ReadonlyArray<SessionV1.WithParts>

const refs = collectRefs(messages)

const tree = (over: Partial<AnchorTree> = {}) => ({
  objective: { ref: "msg:msg_a" },
  decisions: [],
  files: [],
  open_questions: [],
  status: { ref: "msg:msg_b" },
  ...over,
})

describe("anchor refs", () => {
  test("collects message, part and tool refs plus the none sentinel", () => {
    expect(refs.has("msg:msg_a")).toBe(true)
    expect(refs.has("part:msg_a:prt_a1")).toBe(true)
    expect(refs.has("tool:msg_b:prt_b2")).toBe(true)
    expect(refs.has(NO_REF)).toBe(true)
  })

  test("leaves a canonical ref alone", () => {
    expect(normalizeRef("part:msg_a:prt_a1", refs)).toBe("part:msg_a:prt_a1")
    expect(normalizeRef("msg:msg_a", refs)).toBe("msg:msg_a")
  })

  test("expands a bare part ref, which models emit routinely", () => {
    expect(normalizeRef("part:prt_a1", refs)).toBe("part:msg_a:prt_a1")
    expect(normalizeRef("tool:prt_b2", refs)).toBe("tool:msg_b:prt_b2")
  })

  test("does not expand a part ref across prefixes", () => {
    // prt_b2 is a tool part; asking for it as `part:` must not silently resolve to the tool.
    expect(normalizeRef("part:prt_b2", refs)).toBe("part:prt_b2")
  })

  test("never invents a ref for something not in the conversation", () => {
    expect(normalizeRef("part:prt_hallucinated", refs)).toBe("part:prt_hallucinated")
    expect(normalizeRef("msg:msg_nope", refs)).toBe("msg:msg_nope")
    expect(normalizeRef("garbage", refs)).toBe("garbage")
  })
})

describe("anchor validateTree", () => {
  test("accepts a well-formed tree and canonicalizes its refs", () => {
    const result = validateTree(
      tree({ decisions: [{ ref: "part:prt_b1", label: "the decision" }] }),
      refs,
    )
    expect(result.valid).toBe(true)
    expect(result.missingRefs).toEqual([])
    expect(result.tree.decisions[0].ref).toBe("part:msg_b:prt_b1")
  })

  test("rejects a hallucinated ref even when the shape is perfect", () => {
    const result = validateTree(tree({ files: [{ ref: "msg:msg_never_existed", label: "ghost" }] }), refs)
    expect(result.valid).toBe(false)
    expect(result.missingRefs).toContain("msg:msg_never_existed")
  })

  test("allows the none sentinel for objective and status", () => {
    const result = validateTree(
      { ...tree(), objective: { ref: NO_REF }, status: { ref: NO_REF, label: "none" } },
      refs,
    )
    expect(result.valid).toBe(true)
  })

  test("rejects a structurally wrong tree", () => {
    expect(validateTree({ objective: { ref: "msg:msg_a" } }, refs).valid).toBe(false)
    expect(validateTree("nope", refs).valid).toBe(false)
    expect(validateTree(null, refs).valid).toBe(false)
  })

  test("keeps open_todos when present and omits it otherwise", () => {
    const withTodos = validateTree(tree({ open_todos: [{ content: "do the thing" }] }), refs)
    expect(withTodos.tree.open_todos).toEqual([{ content: "do the thing" }])
    expect(validateTree(tree(), refs).tree.open_todos).toBeUndefined()
  })
})

describe("anchor repair prompt", () => {
  test("states the errors and the canonical ref format", () => {
    const prompt = buildRepairPrompt(["Unknown refs: msg:x"], refs)
    expect(prompt).toContain("Unknown refs: msg:x")
    expect(prompt).toContain("part:<message id>:<part id>")
    // Every allowed ref has to be present or the model cannot possibly comply.
    for (const ref of refs) expect(prompt).toContain(ref)
  })
})
