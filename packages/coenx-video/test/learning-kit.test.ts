import { describe, expect, it } from "bun:test"
import { createInteractiveLesson, citationsForVideo } from "../src/learning"
import { InteractiveEngine } from "../src/interactive/engine"
import { validateComposition } from "../src/model/validate"
import type { ButtonNode, TextNode } from "../src/model/types"

const citations = [{ bookId: "book-1", passageId: "chunk-42", title: "Chapter 3", page: 55 }]

function lessonInput() {
  return {
    id: "photosynthesis-lesson",
    title: "Photosynthesis basics",
    learningObjective: "Explain how plants convert light into chemical energy",
    citations,
    intro: {
      heading: "Photosynthesis",
      body: "A short interactive lesson grounded in your book.",
    },
    questions: [
      {
        id: "q1",
        prompt: "Which gas do plants absorb during photosynthesis?",
        options: [
          { id: "oxygen", text: "Oxygen" },
          { id: "co2", text: "Carbon dioxide", correct: true },
          { id: "nitrogen", text: "Nitrogen" },
        ],
      },
      {
        id: "q2",
        prompt: "Where does photosynthesis mainly take place?",
        options: [
          { id: "mitochondria", text: "Mitochondria" },
          { id: "chloroplast", text: "Chloroplasts", correct: true },
        ],
      },
    ],
  }
}

describe("targeted learning interactive lesson kit", () => {
  it("builds a validating composition with intro, question and results scenes", () => {
    const composition = createInteractiveLesson(lessonInput())
    expect(composition.scenes.length).toBe(4)
    expect(composition.scenes.map((scene) => scene.id)).toEqual(["intro", "q-q1", "q-q2", "results"])
    expect(composition.provenance?.mode).toBe("education")
    expect(composition.provenance?.learningObjective).toContain("light")
    expect(() => validateComposition(composition)).not.toThrow()
  })

  it("grades answers through the engine: correct scores, wrong hides and lets the student retry", () => {
    const composition = createInteractiveLesson(lessonInput())
    const engine = new InteractiveEngine(composition)
    const scene = composition.scenes[1]
    engine.navigate(scene.id)
    const correctButton = scene.nodes.find((node) => (node as ButtonNode).text === "Carbon dioxide")!
    const wrongButton = scene.nodes.find((node) => (node as ButtonNode).text === "Oxygen")!

    const wrong = engine.dispatch({ type: "click", targetId: wrongButton.id })
    expect(wrong.emitted).toEqual([{ event: "tl:answer:wrong", payload: "q1" }])
    expect(engine.hiddenNodes.has(wrongButton.id)).toBe(true)
    expect(engine.state.score).toBe(0)
    expect((engine.nodeOverrides.get("q1-status")!.color as string)).toBe("#ff6b81")

    const correct = engine.dispatch({ type: "click", targetId: correctButton.id })
    expect(correct.emitted).toEqual([{ event: "tl:answer:correct", payload: "q1" }])
    expect(engine.state.score).toBe(1)
    expect(engine.state.q_q1).toBe(1)

    // Answered questions do not re-score on further clicks.
    engine.dispatch({ type: "click", targetId: correctButton.id })
    expect(engine.state.score).toBe(1)

    // The advance timer only navigates after the linger window.
    const early = engine.tick(10)
    expect(early.sceneChanged).toBe(false)
    const late = engine.tick(80)
    expect(late.sceneChanged).toBe(true)
    expect(engine.currentSceneId).toBe("q-q2")
  })

  it("grades the final score and supports replay with a full state reset", () => {
    const composition = createInteractiveLesson(lessonInput())
    const engine = new InteractiveEngine(composition)
    for (const scene of composition.scenes.slice(1, 3)) {
      engine.navigate(scene.id)
      const button = scene.nodes.find((node) => node.kind === "button" && ((node as ButtonNode).text === "Carbon dioxide" || (node as ButtonNode).text === "Chloroplasts"))!
      engine.dispatch({ type: "click", targetId: button.id })
      // The advance timer navigates to the next scene after the linger window.
      engine.tick(80)
    }
    expect(engine.currentSceneId).toBe("results")
    expect(engine.state.score).toBe(2)

    const graded = engine.tick(1)
    expect(graded.emitted[0]?.event).toBe("tl:lesson:complete")
    expect(graded.nodesChanged).toBe(true)
    expect((engine.nodeOverrides.get("results-score")!.text as string)).toBe("2 / 2")
    expect(engine.nodeOverrides.get("results-verdict")!.text).toBe("Passed — mastery demonstrated")
    expect(engine.nodeOverrides.get("results-verdict")!.color).toBe("#3ecf8e")

    // Replay resets every per-question flag and the score.
    engine.dispatch({ type: "click", targetId: "results-replay" })
    expect(engine.currentSceneId).toBe("intro")
    expect(engine.state.score).toBe(0)
    expect(engine.state.q_q1).toBe(0)
    expect(engine.state.q_q2).toBe(0)
  })

  it("rejects ungrounded or malformed lesson specs", () => {
    expect(() => createInteractiveLesson({ ...lessonInput(), citations: [] })).toThrow(/citation/)
    expect(() =>
      createInteractiveLesson({
        ...lessonInput(),
        questions: [{ id: "q1", prompt: "p", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }] }],
      }),
    ).toThrow(/correct option/)
    expect(() =>
      createInteractiveLesson({
        ...lessonInput(),
        questions: [
          {
            id: "q1",
            prompt: "p",
            options: [
              { id: "a", text: "A", correct: true },
              { id: "b", text: "B" },
              { id: "c", text: "C" },
              { id: "d", text: "D" },
              { id: "e", text: "E" },
            ],
          },
        ],
      }),
    ).toThrow(/2–4 options/)
  })

  it("maps citations for provenance round-trips", () => {
    const mapped = citationsForVideo([{ bookId: "b", passageId: "c", quote: "light reactions", page: 3 }])
    expect(mapped).toEqual([{ bookId: "b", passageId: "c", page: 3, quote: "light reactions" }])
  })

  it("renders the intro start button wired to the first question scene", () => {
    const composition = createInteractiveLesson(lessonInput())
    const intro = composition.scenes[0]
    const start = intro.nodes.find((node) => node.kind === "button")
    expect(start).toBeDefined()
    const engine = new InteractiveEngine(composition)
    const result = engine.dispatch({ type: "click", targetId: start!.id })
    expect(result.sceneChanged).toBe(true)
    expect(engine.currentSceneId).toBe("q-q1")
    const heading = composition.scenes[0].nodes.find((node) => node.kind === "text") as TextNode
    expect(heading.text).toBe("Photosynthesis")
  })
})
