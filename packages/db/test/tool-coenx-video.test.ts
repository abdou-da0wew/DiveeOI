import { describe, expect, it as bunIt } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AgentV2 } from "@diveeoi/db/agent"
import { Location } from "@diveeoi/db/location"
import { LocationMutation } from "@diveeoi/db/location-mutation"
import { PermissionV2 } from "@diveeoi/db/permission"
import { SessionMessage } from "@diveeoi/db/session/message"
import { SessionV2 } from "@diveeoi/db/session"
import { CoenxVideoTool } from "@diveeoi/db/tool/coenx-video"
import { CoenxVideoInspectTool } from "@diveeoi/db/tool/coenx-video-inspect"
import { CoenxVideoRenderTool } from "@diveeoi/db/tool/coenx-video-render"
import { FSUtil } from "@diveeoi/db/fs-util"
import { AbsolutePath } from "@diveeoi/db/schema"
import { location } from "./fixture/location"
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
const coenxInspect = CoenxVideoInspectTool.layer.pipe(Layer.provide(registry))
const it = testEffect(Layer.mergeAll(registry, coenx, coenxInspect))

const allowPermission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  } as PermissionV2.Interface),
)
const denyingPermission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.fail(new PermissionV2.DeniedError({ rules: [] })),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  } as PermissionV2.Interface),
)
const permission = allowPermission

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

describe("CoenxVideoSkillParity", () => {
  bunIt("keeps every bundled coenx-video skill byte-identical to the project-local copy", async () => {
    const bundledRoot = new URL("../src/plugin/skill/bundled/", import.meta.url)
    const projectRoot = new URL("../../../.agents/skills/", import.meta.url)
    const names = (await Array.fromAsync(new Bun.Glob("*/SKILL.md").scan({ cwd: bundledRoot.pathname })))
      .filter((entry) => entry.startsWith("coenx-video"))
      .sort()
    expect(names.length).toBeGreaterThanOrEqual(20)
    const mismatches: string[] = []
    for (const name of names) {
      const bundled = await Bun.file(new URL(name, bundledRoot)).text()
      const local = await Bun.file(new URL(name, projectRoot)).text()
      if (bundled !== local) mismatches.push(name)
    }
    expect(mismatches).toEqual([])
  })
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

  it.effect("registers capability, validation, inspect and reference tools in the canonical tool registry", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const names = (yield* toolDefinitions(service)).map((tool) => tool.name)
      for (const name of [
        "coenx_video_capabilities",
        "coenx_video_validate",
        "coenx_video_inspect",
        "coenx_video_reference",
      ])
        expect(names).toContain(name)
    }),
  )
})

describe("CoenxVideoInspectTool", () => {
  it.effect("summarizes scenes, resources and feature usage without rendering", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const markup =
        '<coenx id="inspect-demo" title="Inspect demo" width="640" height="360" fps="30"><scene id="intro" frames="30"><rect id="panel" x="320" y="180" width="200" height="80" fill="#2563eb"/><text id="caption" x="320" y="300" width="400" height="40" font-size="24">Hello</text></scene></coenx>'
      const result = yield* settleTool(service, call("coenx_video_inspect", { format: "cml", source: markup }, "call-coenx-inspect"))
      expect(result.output?.structured).toMatchObject({
        composition: { id: "inspect-demo", stage: { width: 640, height: 360, fps: 30 }, totalFrames: 30, scenes: 1 },
        scenes: [{ id: "intro", durationFrames: 30, nodeCount: 2, nodeIds: ["panel", "caption"] }],
        resources: { pathDefinitions: [], clipPaths: [], masks: [], audio: [], assets: [] },
        features: { masks: false, gradients: false, interactivePlayback: false },
        diagnostics: [],
      })
    }),
  )

  it.effect("reports invalid source through the same diagnostic channel", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const result = yield* settleTool(service, call("coenx_video_inspect", { format: "json", source: "{}" }, "call-coenx-inspect-bad"))
      expect(result.output?.structured).toMatchObject({
        composition: { id: "", scenes: 0 },
        diagnostics: [{ code: "composition.invalid" }],
      })
    }),
  )
})

describe("CoenxVideoReferenceTool", () => {
  it.effect("returns the bounded masks reference section", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const result = yield* settleTool(service, call("coenx_video_reference", { topic: "masks" }, "call-coenx-ref"))
      const structured = result.output?.structured as { topic: string; body: string }
      expect(structured.topic).toBe("masks")
      expect(structured.body).toContain("Reusable alpha masks (WP2, v1)")
      expect(structured.body).toContain("32 masks/scene")
      expect(structured.body.length).toBeLessThan(6_000)
    }),
  )
})

describe("CoenxVideoRenderTool", () => {
  const markup =
    '<coenx id="render-demo" title="Render demo" width="320" height="180" fps="6"><scene id="intro" frames="6"><rect id="panel" x="160" y="90" width="200" height="100" fill="#2563eb"/></scene></coenx>'

  const renderStack = (permissionLayer: Layer.Layer<PermissionV2.Service>) => {
    const activeLocation = Layer.succeed(
      Location.Service,
      Location.Service.of(location({ directory: AbsolutePath.make(process.cwd()) } as Location.Ref)),
    )
    const resolution = LocationMutation.layer.pipe(Layer.provide(FSUtil.defaultLayer), Layer.provide(activeLocation))
    const localRegistry = registry.pipe(Layer.provide(permissionLayer))
    const render = CoenxVideoRenderTool.layer.pipe(
      Layer.provide(localRegistry),
      Layer.provide(permissionLayer),
      Layer.provide(resolution),
    )
    const base = Layer.mergeAll(localRegistry, resolution, activeLocation, permissionLayer)
    return render.pipe(Layer.provideMerge(base))
  }

  bunIt("registers preview and export tools in the canonical registry", async () => {
    const names = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ToolRegistry.Service
        return (yield* toolDefinitions(service)).map((tool) => tool.name)
      }).pipe(Effect.provide(renderStack(allowPermission))),
    )
    expect(names).toContain("coenx_video_preview")
    expect(names).toContain("coenx_video_export")
  })

  bunIt("renders preview frames as base64 PNG file parts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ToolRegistry.Service
        return yield* settleTool(
          service,
          call("coenx_video_preview", { format: "cml", source: markup, frames: [0, 3], maxDimension: 320 }, "call-coenx-preview"),
        )
      }).pipe(Effect.provide(renderStack(allowPermission))),
    )
    const structured = result.output?.structured as {
      backend: string
      width: number
      frames: Array<{ frame: number; mime: string; bytesBase64: string }>
    }
    expect(structured.backend).toBe("static-svg")
    expect(structured.frames).toHaveLength(2)
    expect(structured.frames.every((frame) => frame.mime === "image/png")).toBe(true)
    expect(structured.frames[0].bytesBase64.length).toBeGreaterThan(100)
    const fileParts = (result.output?.content ?? []).filter((part) => part.type === "file")
    expect(fileParts).toHaveLength(2)
  })

  bunIt("rejects out-of-budget preview requests before rendering", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ToolRegistry.Service
        return yield* settleTool(
          service,
          call("coenx_video_preview", { format: "cml", source: markup, frames: Array.from({ length: 9 }, (_, i) => i) }, "call-coenx-preview-budget"),
        )
      }).pipe(Effect.provide(renderStack(allowPermission))),
    )
    const outcome = result.result as { type: string; value: unknown }
    expect(outcome.type).toBe("error")
    expect(String(outcome.value)).toMatch(/1-8 frame indices/)
  })

  bunIt("exports a real MP4 inside the location and reports the manifest", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coenx-export-test-"))
    const activeLocation = Layer.succeed(
      Location.Service,
      Location.Service.of(location({ directory: AbsolutePath.make(projectRoot) } as Location.Ref)),
    )
    const resolution = LocationMutation.layer.pipe(Layer.provide(FSUtil.defaultLayer), Layer.provide(activeLocation))
    const localRegistry = registry.pipe(Layer.provide(allowPermission))
    const render = CoenxVideoRenderTool.layer.pipe(
      Layer.provide(localRegistry),
      Layer.provide(allowPermission),
      Layer.provide(resolution),
    )
    const base = Layer.mergeAll(localRegistry, resolution, activeLocation, allowPermission)
    const effect = Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      return yield* settleTool(
        service,
        call("coenx_video_export", { format: "cml", source: markup, outputPath: "out/demo.mp4", profile: "low" }, "call-coenx-export"),
      )
    }).pipe(Effect.provide(render.pipe(Layer.provideMerge(base))))
    const result = await Effect.runPromise(effect)
    const structured = result.output?.structured as {
      outputPath: string
      backend: string
      frames: number
      bytes: number
    }
    expect(structured.outputPath).toBe("out/demo.mp4")
    expect(structured.backend).toBe("static-svg")
    expect(structured.frames).toBe(6)
    expect(structured.bytes).toBeGreaterThan(0)
    const written = await fs.stat(path.join(projectRoot, "out", "demo.mp4"))
    expect(written.size).toBe(structured.bytes)
  })

  bunIt("fails with a repairable message when write approval is denied", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coenx-export-deny-"))
    const activeLocation = Layer.succeed(
      Location.Service,
      Location.Service.of(location({ directory: AbsolutePath.make(projectRoot) } as Location.Ref)),
    )
    const resolution = LocationMutation.layer.pipe(Layer.provide(FSUtil.defaultLayer), Layer.provide(activeLocation))
    const localRegistry = registry.pipe(Layer.provide(denyingPermission))
    const render = CoenxVideoRenderTool.layer.pipe(
      Layer.provide(localRegistry),
      Layer.provide(denyingPermission),
      Layer.provide(resolution),
    )
    const base = Layer.mergeAll(localRegistry, resolution, activeLocation, denyingPermission)
    const effect = Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      return yield* settleTool(
        service,
        call("coenx_video_export", { format: "cml", source: markup, outputPath: "out/denied.mp4" }, "call-coenx-export-deny"),
      )
    }).pipe(Effect.provide(render.pipe(Layer.provideMerge(base))))
    const result = await Effect.runPromise(effect)
    const outcome = result.result as { type: string; value: unknown }
    expect(outcome.type).toBe("error")
    expect(String(outcome.value)).toMatch(/edit approval/)
  })
})
