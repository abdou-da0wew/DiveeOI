import { describe, expect, it } from "bun:test"
import { compileCmlProject, parseCmlMarkup, parseCmlStylesheet, parseCoenxScript } from "../src/index"

describe("Coenx markup", () => {
  it("parses a bounded XML-inspired document", () => {
    const root = parseCmlMarkup('<coenx id="demo"><scene id="intro"><text id="title">Hello</text></scene></coenx>')
    expect(root.tag).toBe("coenx")
    expect(root.children.length).toBe(1)
  })

  it("rejects DTD and malformed document roots", () => {
    expect(() => parseCmlMarkup("<!DOCTYPE coenx><coenx />")).toThrow()
    expect(() => parseCmlMarkup("<html />")).toThrow()
    expect(() => parseCmlMarkup("<coenx><scene></coenx>")).toThrow()
  })

  it("rejects documents beyond the nesting limit", () => {
    const source = "<coenx>" + "<scene>".repeat(33) + "</scene>".repeat(33) + "</coenx>"
    expect(() => parseCmlMarkup(source)).toThrow("nesting exceeds 32")
  })
})

describe("Coenx stylesheet", () => {
  it("accepts the safe selector and property subset", () => {
    const rules = parseCmlStylesheet(
      '.title { font-family: "Space Grotesk"; font-size: 42; color: #fff; } #hero { opacity: 0.8; }',
    )
    expect(rules).toHaveLength(2)
    expect(rules[0].declarations["font-family"]).toBe("Space Grotesk")
  })

  it("rejects remote CSS, unsupported selectors and unbundled fonts", () => {
    expect(() => parseCmlStylesheet('@import url("https://example.com/a.css");')).toThrow()
    expect(() => parseCmlStylesheet("text:hover { color: red; }")).toThrow()
    expect(() => parseCmlStylesheet('text { font-family: "A Remote Font"; }')).toThrow("not bundled and not declared in <font>")
    expect(() => parseCmlStylesheet("text { background: url(https://example.com); }")).toThrow()
  })
})

describe("CoenxScript", () => {
  it("compiles declarative state, conditions and actions", () => {
    const source =
      'export default { state: { answer: "", score: 0 }, events: [{ id: "correct", scene: "question", on: "click", target: "#answer-correct", when: { op: "eq", left: { op: "state", key: "answer" }, right: { op: "literal", value: "" } }, actions: [{ type: "set", key: "answer", value: "correct" }, { type: "increment", key: "score", amount: 1 }, { type: "feedback", text: "Correct", tone: "success" }] }] }'
    const result = parseCoenxScript(source)
    expect(result.state.answer).toBe("")
    expect(result.interactions).toHaveLength(1)
    expect(result.interactions[0].sceneId).toBe("question")
    expect(result.interactions[0].actions).toHaveLength(3)
  })

  it("rejects executable JavaScript and unknown actions", () => {
    expect(() => parseCoenxScript("export default { state: {}, events: [], run: () => fetch('/') }")).toThrow()
    expect(() =>
      parseCoenxScript(
        'export default { state: {}, events: [{ on: "click", target: "#x", actions: [{ type: "eval", source: "alert(1)" }] }] }',
      ),
    ).toThrow("unsupported action type")
    expect(() =>
      parseCoenxScript(
        'export default { state: {}, events: [{ on: "timer", frame: -1, actions: [{ type: "feedback", text: "x" }] }] }',
      ),
    ).toThrow("non-negative integer")
  })
})

describe("Coenx source compilation", () => {
  const markup =
    '<coenx id="demo" title="Demo" width="1280" height="720" fps="30">' +
    '<scene id="question" duration="5s">' +
    '<text id="headline" class="title" x="640" y="180">Which answer?</text>' +
    '<button id="answer" class="answer" x="640" y="420" width="300" height="80">Correct</button>' +
    "</scene>" +
    '<scene id="summary" duration="2s"><text id="summary-title" x="640" y="360">Done</text></scene>' +
    "</coenx>"
  const styles =
    '.title { font-family: "Space Grotesk"; font-size: 48; color: #ffffff; } .answer { font-family: "Manrope"; fill: #18243a; }'
  const script =
    'export default { state: { score: 0 }, events: [{ scene: "question", on: "click", target: "#answer", actions: [{ type: "set", key: "score", value: 1 }, { type: "goto", sceneId: "summary" }] }] }'

  it("compiles markup, styles and interactions to a validated composition", () => {
    const composition = compileCmlProject({ markup, styles, script })
    expect(composition.id).toBe("demo")
    expect(composition.scenes).toHaveLength(2)
    expect(composition.scenes[0].nodes[0].kind).toBe("text")
    expect(composition.scenes[0].interactions).toHaveLength(1)
    expect(composition.scenes[1].interactions).toHaveLength(0)
    expect(composition.initialState?.score).toBe(0)
  })

  it("requires retrieved citations and an objective in education mode", () => {
    const educational = markup.replace(
      '<coenx id="demo" title="Demo" width="1280" height="720" fps="30">',
      '<coenx id="demo" title="Demo" width="1280" height="720" fps="30" mode="education" objective="Check a concept">',
    )
    expect(() => compileCmlProject({ markup: educational, styles })).toThrow("real bookId and passageId")
    const withCitation = educational.replace(
      "</coenx>",
      '<citation bookId="book-1" passageId="passage-2" title="Retrieved source" page="12" /></coenx>',
    )
    expect(compileCmlProject({ markup: withCitation, styles }).provenance?.mode).toBe("education")
  })
})
