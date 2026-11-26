// Generates the final deliverables proving both output contracts end to end:
//  1. a polished interactive world packed into a portable .coenx4 container
//  2. the same production rendered to a static MP4 via the native Cairo renderer
//  3. a poster PNG from the native preview frames
// Run: bun packages/coenx-video/scripts/world-showcase.ts <outDir>
import { mkdir } from "node:fs/promises"
import { packCoenx, validateCoenx } from "../src/container/pack"
import { renderNativeVideo } from "../src/render/native-video"
import type { VideoComposition } from "../src/model/types"

const outDir = process.argv[2] ?? "/home/z/my-project/download"
await mkdir(outDir, { recursive: true })

// ---------------------------------------------------------------------------
// 1. The interactive world showcase: physics playground + grounded quiz.
//    Click kicks the ball (statement list + impulse), hover scales the pad,
//    drag throws the ball with live physics, collisions drive the HUD, and
//    the lesson scene grades answers with retry-on-wrong and a final verdict.
// ---------------------------------------------------------------------------

const arena: VideoComposition = {
  version: 1,
  id: "world-showcase",
  title: "DiveeOI interactive world — physics playground",
  stage: { width: 960, height: 540, fps: 30 },
  initialState: { score: 0, bounces: 0 },
  scenes: [
    {
      id: "intro",
      durationFrames: 120,
      background: "#0b1120",
      nodes: [
        { id: "intro-title", kind: "text", x: 480, y: 130, width: 800, height: 56, text: "Interactive Video Worlds", color: "#eef2f8", align: "center" },
        { id: "intro-sub", kind: "text", x: 480, y: 205, width: 760, height: 60, text: "One composition model.\nStatic MP4 renders and live .coenx4 worlds.", color: "#93a0b8", align: "center" },
        { id: "intro-kick", kind: "button", x: 480, y: 330, width: 340, height: 60, text: "Enter the world", fill: "#5b8cff", color: "#0b1120", radius: 14 },
      ],
      interactions: [
        { id: "intro-go", trigger: { type: "click", targetId: "intro-kick" }, actions: [{ type: "goto", sceneId: "arena" }] },
        {
          id: "intro-auto",
          trigger: { type: "timer", frame: 100 },
          actions: [{ type: "goto", sceneId: "arena" }],
        },
      ],
      transition: { type: "fade", durationFrames: 18 },
    },
    {
      id: "arena",
      durationFrames: 660,
      background: "#0b1120",
      physics: {
        gravity: [0, 640],
        bodies: [
          { nodeId: "ball", mass: 1.2, velocity: [40, 0], size: [64, 64], restitution: 0.6 },
          { nodeId: "floor", mass: 0, velocity: [0, 0], size: [960, 28], isStatic: true, restitution: 0.15 },
          { nodeId: "wall-left", mass: 0, velocity: [0, 0], size: [28, 540], isStatic: true, restitution: 0.45 },
          { nodeId: "wall-right", mass: 0, velocity: [0, 0], size: [28, 540], isStatic: true, restitution: 0.45 },
          { nodeId: "pedestal", mass: 0, velocity: [0, 0], size: [220, 26], isStatic: true, restitution: 0.5 },
        ],
      },
      nodes: [
        { id: "hud", kind: "text", x: 260, y: 42, width: 440, height: 30, text: "hits 0  ·  bounces 0", color: "#eef2f8" },
        { id: "hint", kind: "text", x: 760, y: 42, width: 340, height: 26, text: "click · hover · drag", color: "#5b8cff", align: "right" },
        { id: "ball", kind: "ellipse", x: 480, y: 110, width: 64, height: 64, fill: { type: "radial", center: [0.35, 0.3], radius: 0.9, stops: [{ offset: 0, color: "#9db9ff" }, { offset: 1, color: "#5b8cff" }] } },
        { id: "pad", kind: "rect", x: 240, y: 380, width: 180, height: 40, fill: "#1a2337", radius: 10, stroke: "#5b8cff" },
        { id: "pedestal", kind: "rect", x: 660, y: 420, width: 220, height: 26, fill: "#243050", radius: 8 },
        { id: "floor", kind: "rect", x: 480, y: 526, width: 960, height: 28, fill: "#243050" },
        { id: "wall-left", kind: "rect", x: 14, y: 270, width: 28, height: 540, fill: "#243050" },
        { id: "wall-right", kind: "rect", x: 946, y: 270, width: 28, height: 540, fill: "#243050" },
      ],
      interactions: [
        {
          id: "ball-kick",
          trigger: { type: "click", targetId: "ball" },
          actions: [
            {
              type: "run",
              actions: [
                { type: "increment", key: "score", amount: 1 },
                { type: "impulse", targetId: "ball", vx: 90, vy: -230 },
                {
                  type: "setNode",
                  targetId: "hud",
                  props: {
                    text: {
                      op: "concat",
                      items: [
                        { op: "literal", value: "hits " },
                        { op: "state", key: "score" },
                        { op: "literal", value: "  ·  bounces " },
                        { op: "state", key: "bounces" },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
        { id: "pad-in", trigger: { type: "hover", targetId: "pad", phase: "enter" }, actions: [{ type: "setNode", targetId: "pad", props: { scale: 1.12 } }] },
        { id: "pad-out", trigger: { type: "hover", targetId: "pad", phase: "leave" }, actions: [{ type: "setNode", targetId: "pad", props: { scale: 1 } }] },
        {
          id: "ball-drag",
          trigger: { type: "drag", targetId: "ball", phase: "move" },
          actions: [{ type: "setNode", targetId: "hint", props: { text: "release to throw" } }],
        },
        {
          id: "ball-thrown",
          trigger: { type: "drag", targetId: "ball", phase: "end" },
          actions: [{ type: "feedback", text: "thrown!", tone: "success" }],
        },
        {
          id: "ball-bounce",
          trigger: { type: "collide", targetId: "ball", withId: "floor" },
          actions: [
            { type: "increment", key: "bounces", amount: 1 },
            {
              type: "setNode",
              targetId: "hud",
              props: {
                text: {
                  op: "concat",
                  items: [
                    { op: "literal", value: "hits " },
                    { op: "state", key: "score" },
                    { op: "literal", value: "  ·  bounces " },
                    { op: "state", key: "bounces" },
                  ],
                },
              },
            },
          ],
        },
        {
          id: "to-lesson",
          trigger: { type: "timer", frame: 580 },
          actions: [{ type: "goto", sceneId: "lesson" }],
        },
      ],
      transition: { type: "slide-left", durationFrames: 16 },
    },
    {
      id: "lesson",
      durationFrames: 480,
      background: "#0b1120",
      nodes: [
        { id: "lesson-prompt", kind: "text", x: 480, y: 120, width: 820, height: 50, text: "Checkpoint — what makes this video interactive?", color: "#eef2f8", align: "center" },
        { id: "lesson-status", kind: "text", x: 480, y: 492, width: 700, height: 28, text: "Choose an answer", color: "#93a0b8", align: "center" },
        { id: "o-static", kind: "button", x: 480, y: 220, width: 560, height: 56, text: "It only plays as a flat MP4", fill: "#1a2337", color: "#eef2f8", radius: 10, borderColor: "#5b8cff" },
        { id: "o-state", kind: "button", x: 480, y: 292, width: 560, height: 56, text: "State, logic, input, physics", fill: "#1a2337", color: "#eef2f8", radius: 10, borderColor: "#5b8cff" },
        { id: "o-server", kind: "button", x: 480, y: 364, width: 560, height: 56, text: "It streams logic from a server", fill: "#1a2337", color: "#eef2f8", radius: 10, borderColor: "#5b8cff" },
      ],
      interactions: [
        {
          id: "answer-right",
          trigger: { type: "click", targetId: "o-state" },
          when: { op: "eq", left: { op: "state", key: "answered" }, right: { op: "literal", value: 0 } },
          actions: [
            { type: "set", key: "answered", value: 1 },
            { type: "increment", key: "score", amount: 1 },
            { type: "feedback", text: "Correct", tone: "success" },
            { type: "emit", event: "tl:answer:correct", payload: "world-checkpoint" },
            { type: "setNode", targetId: "lesson-status", props: { text: "Correct — that is the whole point", color: "#3ecf8e" } },
            { type: "setNode", targetId: "o-state", props: { scale: 1.04 } },
          ],
        },
        {
          id: "answer-wrong-a",
          trigger: { type: "click", targetId: "o-static" },
          when: { op: "eq", left: { op: "state", key: "answered" }, right: { op: "literal", value: 0 } },
          actions: [
            { type: "feedback", text: "Not quite — try again", tone: "error" },
            { type: "emit", event: "tl:answer:wrong", payload: "world-checkpoint" },
            { type: "hide", targetId: "o-static" },
            { type: "setNode", targetId: "lesson-status", props: { text: "Not quite — you have clicked things already!", color: "#ff6b81" } },
          ],
        },
        {
          id: "answer-wrong-b",
          trigger: { type: "click", targetId: "o-server" },
          when: { op: "eq", left: { op: "state", key: "answered" }, right: { op: "literal", value: 0 } },
          actions: [
            { type: "feedback", text: "Not quite — try again", tone: "error" },
            { type: "emit", event: "tl:answer:wrong", payload: "world-checkpoint" },
            { type: "hide", targetId: "o-server" },
            { type: "setNode", targetId: "lesson-status", props: { text: "Everything runs offline inside the container", color: "#ff6b81" } },
          ],
        },
        {
          id: "lesson-done",
          trigger: { type: "timer", frame: 75 },
          when: { op: "eq", left: { op: "state", key: "answered" }, right: { op: "literal", value: 1 } },
          actions: [{ type: "goto", sceneId: "outro" }],
        },
      ],
      transition: { type: "slide-left", durationFrames: 16 },
    },
    {
      id: "outro",
      durationFrames: 210,
      background: "#0b1120",
      nodes: [
        { id: "outro-title", kind: "text", x: 480, y: 200, width: 800, height: 60, text: "Static MP4 + interactive .coenx4", color: "#eef2f8", align: "center" },
        { id: "outro-sub", kind: "text", x: 480, y: 280, width: 760, height: 40, text: "One authoring model · two output contracts · zero runtime dependencies", color: "#93a0b8", align: "center" },
        { id: "outro-score", kind: "text", x: 480, y: 360, width: 400, height: 34, text: "final score 1 / 1", color: "#5b8cff", align: "center" },
      ],
      interactions: [
        {
          id: "outro-grade",
          trigger: { type: "timer", frame: 1 },
          actions: [
            {
              type: "setNode",
              targetId: "outro-score",
              props: {
                text: {
                  op: "concat",
                  items: [{ op: "literal", value: "final score " }, { op: "state", key: "score" }, { op: "literal", value: " / 1" }],
                },
              },
            },
            { type: "emit", event: "tl:lesson:complete", payload: "world-showcase" },
          ],
        },
        { id: "replay", trigger: { type: "key", key: "r" }, actions: [{ type: "set", key: "score", value: 0 }, { type: "set", key: "bounces", value: 0 }, { type: "set", key: "answered", value: 0 }, { type: "goto", sceneId: "intro" }] },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// 2. Pack the interactive world (.coenx4) and validate it.
// ---------------------------------------------------------------------------

const containerPath = `${outDir}/coenx-world-showcase.coenx4`
const packed = await packCoenx({ composition: arena, projectRoot: outDir, outputPath: containerPath })
const validation = await validateCoenx(containerPath)
if (!validation.ok) throw new Error("World showcase container failed validation: " + validation.issues.join("; "))
console.log("coenx4 packed:", containerPath, `${packed.bytes} bytes`)

// ---------------------------------------------------------------------------
// 3. Render the static MP4 via the native Cairo renderer (same composition).
// ---------------------------------------------------------------------------

const rendered = await renderNativeVideo(arena, { projectRoot: outDir, outputPath: "coenx-world-showcase.mp4" })
console.log("mp4 rendered:", `${outDir}/coenx-world-showcase.mp4`, JSON.stringify({ frames: rendered.frames, seconds: rendered.durationSeconds, bytes: rendered.bytes }))
