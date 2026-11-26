import { describe, expect, it } from "bun:test"
import { InteractiveEngine } from "../src/interactive/engine"
import type { TextNode, VideoComposition } from "../src/model/types"

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

describe("world-model interactions: logic, moving, statements", () => {
  const base: VideoComposition = {
    version: 1,
    id: "world-test",
    title: "World test",
    stage: { width: 640, height: 360, fps: 30 },
    initialState: { score: 0, label: "", depth: 3 },
    scenes: [
      {
        id: "arena",
        durationFrames: 120,
        nodes: [
          { id: "ball", kind: "ellipse", x: 100, y: 100, width: 40, height: 40, fill: "#f66" },
          { id: "pad", kind: "rect", x: 300, y: 200, width: 80, height: 20, fill: "#6f6" },
          { id: "hud", kind: "text", x: 40, y: 24, width: 200, height: 24, text: "score" },
        ],
        interactions: [],
      },
      { id: "end", durationFrames: 30, nodes: [] },
    ],
  }

  function node(base: VideoComposition, id: string) {
    const scene = base.scenes[0]
    return scene.nodes.find((item) => item.id === id)!
  }

  it("evaluates arithmetic, clamp, min/max, concat, if and event coordinates", () => {
    const engine = new InteractiveEngine({
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          interactions: [
            {
              id: "drag-ball",
              trigger: { type: "drag", targetId: "ball", phase: "move" },
              actions: [
                { type: "set", key: "label", value: { op: "concat", items: [{ op: "literal", value: "x=" }, { op: "event", key: "x" }] } },
                { type: "set", key: "score", value: { op: "clamp", value: { op: "add", left: { op: "state", key: "score" }, right: { op: "literal", value: 10 } }, min: { op: "literal", value: 0 }, max: { op: "literal", value: 15 } } },
                {
                  type: "setNode",
                  targetId: "hud",
                  props: {
                    text: { op: "if", cond: { op: "gte", left: { op: "state", key: "score" }, right: { op: "literal", value: 15 } }, trueValue: { op: "literal", value: "maxed" }, falseValue: { op: "state", key: "label" } },
                    x: { op: "min", items: [{ op: "event", key: "x" }, { op: "literal", value: 500 }] },
                    y: { op: "mod", left: { op: "event", key: "y" }, right: { op: "literal", value: 100 } },
                    rotation: { op: "mul", left: { op: "state", key: "depth" }, right: { op: "literal", value: 5 } },
                    opacity: { op: "div", left: { op: "state", key: "depth" }, right: { op: "literal", value: 4 } },
                  },
                },
              ],
            },
          ],
        },
      ],
    })
    const result = engine.dispatch({ type: "drag", targetId: "ball", phase: "move", x: 600, y: 250 })
    expect(engine.state.label).toBe("x=600")
    expect(engine.state.score).toBe(10)
    expect(result.nodesChanged).toBe(true)
    const hud = engine.nodeOverrides.get("hud")!
    expect(hud.text).toBe("x=600")
    expect(hud.x).toBe(500)
    expect(hud.y).toBe(50)
    expect(hud.rotation).toBe(15)
    expect(hud.opacity).toBe(0.75)
  })

  it("matches hover enter/leave and drag phases separately", () => {
    const engine = new InteractiveEngine({
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          interactions: [
            {
              id: "hover-enter",
              trigger: { type: "hover", targetId: "pad", phase: "enter" },
              actions: [{ type: "setNode", targetId: "pad", props: { scale: 1.2 } }],
            },
            {
              id: "hover-leave",
              trigger: { type: "hover", targetId: "pad", phase: "leave" },
              actions: [{ type: "setNode", targetId: "pad", props: { scale: 1 } }],
            },
            {
              id: "drag-end",
              trigger: { type: "drag", targetId: "ball", phase: "end" },
              actions: [{ type: "feedback", text: "thrown", tone: "success" }],
            },
          ],
        },
      ],
    })
    const enter = engine.dispatch({ type: "hover", targetId: "pad", phase: "enter" })
    expect(enter.nodesChanged).toBe(true)
    expect(engine.nodeOverrides.get("pad")!.scale).toBe(1.2)
    engine.dispatch({ type: "hover", targetId: "pad", phase: "leave" })
    expect(engine.nodeOverrides.get("pad")!.scale).toBe(1)
    engine.dispatch({ type: "hover", targetId: "pad" })
    // Phase-less hover events do not re-fire phase-gated handlers.
    expect(engine.nodeOverrides.get("pad")!.scale).toBe(1)
    const end = engine.dispatch({ type: "drag", targetId: "ball", phase: "end" })
    expect(end.feedback?.text).toBe("thrown")
  })

  it("runs statement lists, applies impulses and honors gotoFrame", () => {
    const engine = new InteractiveEngine({
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          interactions: [
            {
              id: "launch",
              trigger: { type: "click", targetId: "ball" },
              actions: [
                {
                  type: "run",
                  actions: [
                    { type: "increment", key: "score", amount: 5 },
                    { type: "impulse", targetId: "ball", vx: 240, vy: -180 },
                    { type: "setNode", targetId: "hud", props: { text: { op: "concat", items: [{ op: "literal", value: "score " }, { op: "state", key: "score" }] } } },
                    { type: "gotoFrame", frame: 30 },
                  ],
                },
              ],
            },
            {
              id: "collide-wall",
              trigger: { type: "collide", targetId: "ball", withId: "pad" },
              actions: [{ type: "emit", event: "world:hit" }],
            },
          ],
        },
      ],
    })
    const result = engine.dispatch({ type: "click", targetId: "ball" })
    expect(engine.state.score).toBe(5)
    expect(result.impulses).toEqual([{ nodeId: "ball", vx: 240, vy: -180 }])
    expect(result.gotoFrame).toBe(30)
    expect(engine.nodeOverrides.get("hud")!.text).toBe("score 5")
    const hit = engine.dispatch({ type: "collide", targetId: "ball", withId: "pad" })
    expect(hit.emitted).toEqual([{ event: "world:hit", payload: undefined }])
    const otherHit = engine.dispatch({ type: "collide", targetId: "ball", withId: "wall" })
    expect(otherHit.emitted).toEqual([])
  })

  it("restores per-scene node overrides on navigation like hidden nodes", () => {
    const engine = new InteractiveEngine({
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          interactions: [
            {
              id: "paint",
              trigger: { type: "click", targetId: "pad" },
              actions: [{ type: "setNode", targetId: "hud", props: { text: "clicked", x: 60 } }],
            },
            { id: "to-end", trigger: { type: "key", key: "Enter" }, actions: [{ type: "goto", sceneId: "end" }] },
          ],
        },
        {
          id: "end",
          durationFrames: 30,
          nodes: [],
          interactions: [{ id: "back", trigger: { type: "key", key: "Escape" }, actions: [{ type: "goto", sceneId: "arena" }] }],
        },
      ],
    })
    engine.dispatch({ type: "click", targetId: "pad" })
    expect(engine.nodeOverrides.get("hud")!.text).toBe("clicked")
    engine.dispatch({ type: "key", key: "Enter" })
    expect(engine.currentSceneId).toBe("end")
    expect(engine.nodeOverrides.size).toBe(0)
    engine.dispatch({ type: "key", key: "Escape" })
    expect(engine.currentSceneId).toBe("arena")
    expect(engine.nodeOverrides.get("hud")!.text).toBe("clicked")
    expect((node(base, "hud") as TextNode).text).toBe("score")
  })

  it("bounds nested run statements", () => {
    const engine = new InteractiveEngine({
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          interactions: [
            {
              id: "deep",
              trigger: { type: "click", targetId: "pad" },
              actions: [makeDeepRun(40)],
            },
          ],
        },
      ],
    })
    const before = engine.state.score
    engine.dispatch({ type: "click", targetId: "pad" })
    expect(engine.state.score).toBe(before)
  })

  function makeDeepRun(depth: number): any {
    let action: any = { type: "increment", key: "score", amount: 1 }
    for (let index = 0; index < depth; index++) action = { type: "run", actions: [action] }
    return action
  }

  it("rejects invalid world-model interactions during validation", async () => {
    const { validateComposition, VideoValidationError } = await import("../src/model/validate")
    const broken: VideoComposition = {
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          interactions: [
            {
              id: "bad-node",
              trigger: { type: "impulse" as any, targetId: "ghost" } as any,
              actions: [
                { type: "setNode", targetId: "ghost", props: { text: "x" } },
                { type: "impulse", targetId: "ghost", vx: 10, vy: 10 },
                { type: "gotoFrame", frame: -3 },
                { type: "run", actions: [{ type: "goto", sceneId: "missing" }] },
              ],
            },
          ],
        },
        base.scenes[1],
      ],
    }
    let issues: string[] = []
    try {
      validateComposition(broken)
    } catch (error) {
      if (error instanceof VideoValidationError) issues = error.issues
      else throw error
    }
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((issue) => issue.includes("ghost"))).toBe(true)
    expect(issues.some((issue) => issue.includes("missing scene"))).toBe(true)
  })
})

