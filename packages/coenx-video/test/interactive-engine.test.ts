import { describe, expect, it } from "bun:test"
import { InteractiveEngine } from "../src/interactive/engine"
import type { VideoComposition } from "../src/model/types"

describe("interactive composition state engine", () => {
  const composition: VideoComposition = {
    version: 1,
    id: "interaction-test",
    title: "Interaction test",
    stage: { width: 320, height: 180, fps: 30 },
    initialState: { score: 0, answer: "" },
    scenes: [
      {
        id: "question",
        durationFrames: 30,
        nodes: [
          { id: "submit", kind: "button", x: 160, y: 90, width: 100, height: 40, text: "Submit" },
          { id: "result", kind: "text", x: 160, y: 130, width: 100, height: 20, text: "Result" },
        ],
        interactions: [
          {
            id: "submit-answer",
            trigger: { type: "click", targetId: "submit" },
            when: { op: "eq", left: { op: "state", key: "answer" }, right: { op: "literal", value: "correct" } },
            actions: [
              { type: "increment", key: "score", amount: 1 },
              { type: "hide", targetId: "submit" },
              { type: "feedback", text: "Correct", tone: "success" },
              { type: "goto", sceneId: "complete" },
            ],
          },
        ],
      },
      { id: "complete", durationFrames: 30, nodes: [] },
    ],
  }

  it("evaluates conditions and applies state, visibility, feedback and branching", () => {
    const engine = new InteractiveEngine(composition)
    engine.dispatch({ type: "click", targetId: "submit" })
    expect(engine.state.score).toBe(0)
    engine.state.answer = "correct"
    const result = engine.dispatch({ type: "click", targetId: "submit" })
    expect(engine.state.score).toBe(1)
    expect(result.stateChanged).toBe(true)
    expect(engine.hiddenNodes.has("submit")).toBe(false)
    expect(result.feedback?.tone).toBe("success")
    expect(result.sceneChanged).toBe(true)
    expect(engine.currentSceneId).toBe("complete")
    engine.navigate("question")
    expect(engine.hiddenNodes.has("submit")).toBe(true)
  })

  it("fires condition-gated frame timers once the condition becomes true", () => {
    const engine = new InteractiveEngine({
      ...composition,
      scenes: [
        {
          ...composition.scenes[0],
          interactions: [
            {
              id: "timer",
              trigger: { type: "timer", frame: 5 },
              when: {
                op: "eq",
                left: { op: "state", key: "answer" },
                right: { op: "literal", value: "correct" },
              },
              actions: [{ type: "increment", key: "score", amount: 1 }],
            },
          ],
        },
      ],
    })
    engine.tick(5)
    expect(engine.state.score).toBe(0)
    engine.state.answer = "correct"
    const result = engine.tick(8)
    const repeated = engine.tick(9)
    expect(result.stateChanged).toBe(true)
    expect(repeated.stateChanged).toBe(false)
    expect(engine.state.score).toBe(1)
  })

  it("catches up skipped global timeline events without replaying them after branching", () => {
    const engine = new InteractiveEngine({
      ...composition,
      timeline: [
        {
          id: "global-score",
          frame: 5,
          actions: [{ type: "increment", key: "score", amount: 1 }],
        },
      ],
    })
    engine.setFrame(8)
    const first = engine.tick(8)
    engine.navigate("complete")
    engine.navigate("question")
    engine.setFrame(9)
    const second = engine.tick(9)
    expect(first.stateChanged).toBe(true)
    expect(second.stateChanged).toBe(false)
    expect(engine.state.score).toBe(1)
  })

  it("re-arms scene timers only when entering that scene again", () => {
    const engine = new InteractiveEngine({
      ...composition,
      scenes: [
        {
          ...composition.scenes[0],
          interactions: [
            {
              id: "scene-timer",
              trigger: { type: "timer", frame: 5 },
              actions: [{ type: "increment", key: "score", amount: 1 }],
            },
          ],
        },
        composition.scenes[1],
      ],
    })
    engine.tick(5)
    engine.navigate("complete")
    engine.navigate("question")
    const result = engine.tick(5)
    expect(result.stateChanged).toBe(true)
    expect(engine.state.score).toBe(2)
  })

  it("stops dispatching old-scene handlers after a branch", () => {
    const engine = new InteractiveEngine({
      ...composition,
      scenes: [
        {
          ...composition.scenes[0],
          interactions: [
            {
              id: "branch",
              trigger: { type: "click", targetId: "submit" },
              actions: [{ type: "goto", sceneId: "complete" }],
            },
            {
              id: "stale-score",
              trigger: { type: "click", targetId: "submit" },
              actions: [{ type: "increment", key: "score", amount: 1 }],
            },
          ],
        },
        composition.scenes[1],
      ],
    })
    const result = engine.dispatch({ type: "click", targetId: "submit" })
    expect(result.sceneChanged).toBe(true)
    expect(engine.currentSceneId).toBe("complete")
    expect(engine.state.score).toBe(0)
  })

  it("stops dispatching old-scene timers after a branch", () => {
    const engine = new InteractiveEngine({
      ...composition,
      scenes: [
        {
          ...composition.scenes[0],
          interactions: [
            {
              id: "branch-timer",
              trigger: { type: "timer", frame: 5 },
              actions: [{ type: "goto", sceneId: "complete" }],
            },
            {
              id: "stale-timer",
              trigger: { type: "timer", frame: 5 },
              actions: [{ type: "increment", key: "score", amount: 1 }],
            },
          ],
        },
        composition.scenes[1],
      ],
    })
    const result = engine.tick(5)
    expect(result.sceneChanged).toBe(true)
    expect(engine.currentSceneId).toBe("complete")
    expect(engine.state.score).toBe(0)
  })

  it("returns emitted application events from interactions", () => {
    const engine = new InteractiveEngine({
      ...composition,
      scenes: [
        {
          ...composition.scenes[0],
          interactions: [
            {
              id: "emit-answer",
              trigger: { type: "click", targetId: "submit" },
              actions: [{ type: "emit", event: "answer-submitted", payload: "correct" }],
            },
          ],
        },
      ],
    })
    const result = engine.dispatch({ type: "click", targetId: "submit" })
    expect(result.emitted).toEqual([{ event: "answer-submitted", payload: "correct" }])
  })
})
