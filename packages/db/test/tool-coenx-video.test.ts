import { describe, expect, it as bunIt } from "bun:test"
import { AgentV2 } from "@diveeoi/db/agent"
import { SessionMessage } from "@diveeoi/db/session/message"
import { SessionV2 } from "@diveeoi/db/session"
import { CoenxVideoTool } from "@diveeoi/db/tool/coenx-video"
import { ToolRegistry } from "@diveeoi/db/tool/registry"
import { Effect, Layer } from "effect"
import { COENX_VIDEO_CAPABILITIES } from "@diveeoi/coenx-video/capabilities"
import bundledRenderingSkill from "../src/plugin/skill/bundled/coenx-video-rendering/SKILL.md" with { type: "text" }
import { settleTool, toolDefinitions } from "./lib/tool"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_coenx_video_tool_test")
const toolIdentity = {
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make("msg_coenx_video_tool_test"),
}
const registry = ToolRegistry.defaultLayer
const coenx = CoenxVideoTool.layer.pipe(Layer.provide(registry))
const it = testEffect(Layer.mergeAll(registry, coenx))

const call = (name: string, input: unknown, id = "call-coenx-video") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input },
})

bunIt("keeps the project-local rendering skill identical to the bundled copy", async () => {
  const localSkill = await Bun.file(
    new URL("../../../.agents/skills/coenx-video-rendering/SKILL.md", import.meta.url),
  ).text()
  expect(localSkill).toBe(bundledRenderingSkill)
})

describe("CoenxVideoTool", () => {
  it.effect("registers capability and validation tools in the canonical tool registry", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const names = (yield* toolDefinitions(service)).map((tool) => tool.name)
      expect(names).toContain("coenx_video_capabilities")
      expect(names).toContain("coenx_video_validate")
    }),
  )

  it.effect("returns the code-backed renderer matrix including truthful GPU and CPU fallback status", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const result = yield* settleTool(service, call("coenx_video_capabilities", {}))
      expect(result.output?.structured).toMatchObject({
        schemaVersion: COENX_VIDEO_CAPABILITIES.schemaVersion,
        renderers: COENX_VIDEO_CAPABILITIES.renderers,
        features: COENX_VIDEO_CAPABILITIES.features,
        threeD: {
          current: { renderer: "software-projected-cpu", available: true },
          gpu: { status: "planned" },
          cpuFallback: { available: true, deterministic: true },
        },
      })
      expect(result.output?.content?.[0]).toMatchObject({ type: "text" })
    }),
  )

  it.effect("compiles and validates a CML project and returns a scene summary", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const markup =
        '<coenx id="demo" title="Demo" width="640" height="360" fps="30"><scene id="intro" frames="45"><rect id="panel" x="320" y="180" width="200" height="80" fill="#2563eb"/></scene></coenx>'
      const result = yield* settleTool(
        service,
        call("coenx_video_validate", { format: "cml", source: markup }, "call-coenx-cml-valid"),
      )
      expect(result.output?.structured).toEqual({
        valid: true,
        format: "cml",
        diagnostics: [],
        summary: {
          stage: { width: 640, height: 360, fps: 30 },
          scenes: 1,
          nodes: 1,
          totalFrames: 45,
        },
      })
    }),
  )

  it.effect("validates JSON compositions through the same shared model", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const composition = {
        version: 1,
        id: "json-demo",
        title: "JSON Demo",
        stage: { width: 640, height: 360, fps: 30, background: "#10131b" },
        scenes: [
          {
            id: "intro",
            durationFrames: 30,
            nodes: [
              {
                id: "panel",
                kind: "rect",
                x: 320,
                y: 180,
                width: 200,
                height: 80,
                fill: "#2563eb",
              },
            ],
          },
        ],
      }
      const result = yield* settleTool(
        service,
        call("coenx_video_validate", { format: "json", source: JSON.stringify(composition) }, "call-coenx-json-valid"),
      )
      expect(result.output?.structured).toMatchObject({
        valid: true,
        format: "json",
        diagnostics: [],
        summary: { stage: { width: 640, height: 360, fps: 30 }, scenes: 1, nodes: 1, totalFrames: 30 },
      })
    }),
  )

  it.effect("returns bounded machine-readable diagnostics for malformed and oversized source", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const malformed = yield* settleTool(
        service,
        call("coenx_video_validate", { format: "json", source: "{not json" }, "call-coenx-json-invalid"),
      )
      expect(malformed.output?.structured).toMatchObject({
        valid: false,
        format: "json",
        diagnostics: [{ code: "source.invalid_json", severity: "error" }],
      })

      const oversized = yield* settleTool(
        service,
        call(
          "coenx_video_validate",
          { format: "cml", source: "x".repeat(2 * 1024 * 1024 + 1) },
          "call-coenx-too-large",
        ),
      )
      expect(oversized.output?.structured).toMatchObject({
        valid: false,
        format: "cml",
        diagnostics: [{ code: "source.too_large", severity: "error" }],
      })
    }),
  )

  it.effect("rejects malformed model objects and CML-only companion files on JSON input", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const invalidComposition = {
        version: 8,
        id: "invalid",
        title: "Invalid",
        stage: { width: 640, height: 360, fps: 30 },
        scenes: [],
      }
      const invalid = yield* settleTool(
        service,
        call(
          "coenx_video_validate",
          { format: "json", source: JSON.stringify(invalidComposition) },
          "call-coenx-model-invalid",
        ),
      )
      expect(invalid.output?.structured).toMatchObject({
        valid: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "composition.invalid", severity: "error" }),
        ]),
      })

      const unexpected = yield* settleTool(
        service,
        call(
          "coenx_video_validate",
          { format: "json", source: "{}", styles: ".title { color: #fff; }" },
          "call-coenx-json-style",
        ),
      )
      expect(unexpected.output?.structured).toMatchObject({
        valid: false,
        diagnostics: [{ code: "source.unexpected_files", severity: "error" }],
      })
    }),
  )
})
