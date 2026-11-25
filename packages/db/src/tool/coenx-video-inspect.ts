export * as CoenxVideoInspectTool from "./coenx-video-inspect"

import { Effect, Layer, Schema } from "effect"
import { referenceSection, REFERENCE_TOPICS, type ReferenceTopic } from "@diveeoi/coenx-video/reference"
import { compileSource, diagnostic, SourceInput } from "./coenx-video"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const inspectName = "coenx_video_inspect"
export const referenceName = "coenx_video_reference"

const InspectOutput = Schema.Struct({
  composition: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    stage: Schema.Struct({ width: Schema.Number, height: Schema.Number, fps: Schema.Number }),
    totalFrames: Schema.Number,
    scenes: Schema.Number,
  }),
  scenes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      durationFrames: Schema.Number,
      nodeCount: Schema.Number,
      nodeIds: Schema.Array(Schema.String),
      transition: Schema.optional(Schema.String),
    }),
  ),
  resources: Schema.Struct({
    pathDefinitions: Schema.Array(Schema.String),
    clipPaths: Schema.Array(Schema.String),
    masks: Schema.Array(Schema.String),
    audio: Schema.Array(Schema.String),
    assets: Schema.Array(Schema.String),
  }),
  features: Schema.Struct({
    reusablePaths: Schema.Boolean,
    clipPaths: Schema.Boolean,
    masks: Schema.Boolean,
    gradients: Schema.Boolean,
    interactions: Schema.Boolean,
    audio: Schema.Boolean,
    physics2d: Schema.Boolean,
    physics3d: Schema.Boolean,
    software3d: Schema.Boolean,
    interactivePlayback: Schema.Boolean,
  }),
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      severity: Schema.Literals(["error", "warning"]),
      message: Schema.String,
    }),
  ),
})

const nodeIds = (nodes: ReadonlyArray<{ id: string }>) => nodes.slice(0, 200).map((node) => node.id)

const inspectTool = Tool.make({
  description:
    "Summarize a complete Coenx Video project structure without rendering: composition/stage/timing, per-scene node ids, reusable resources (paths, clips, masks), audio and assets, and which renderer features the project actually uses. Read-only; does not access project files or media.",
  input: SourceInput,
  output: InspectOutput,
  toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output, null, 2) }],
  execute: (input) =>
    Effect.sync(() => {
      const compiled = compileSource(input)
      const composition = compiled.composition
      if (!composition) {
        return {
          composition: { id: "", title: "", stage: { width: 0, height: 0, fps: 0 }, totalFrames: 0, scenes: 0 },
          scenes: [],
          resources: { pathDefinitions: [], clipPaths: [], masks: [], audio: [], assets: [] },
          features: {
            reusablePaths: false,
            clipPaths: false,
            masks: false,
            gradients: false,
            interactions: false,
            audio: false,
            physics2d: false,
            physics3d: false,
            software3d: false,
            interactivePlayback: false,
          },
          diagnostics: compiled.diagnostics,
        }
      }
      const scenes = composition.scenes
      const nodes = scenes.flatMap((scene) => scene.nodes)
      const totalFrames = scenes.reduce((sum, scene) => sum + scene.durationFrames, 0)
      const diagnostics = compiled.diagnostics
      if (scenes.some((scene) => scene.masks?.length)) diagnostics.push(diagnostic("masks.used", "Project uses alpha masks; supported by all four renderers (see capabilities)."))
      if (nodes.some((node) => node.kind === "select")) diagnostics.push(diagnostic("select.native_limit", "Select controls are not supported by the native Cairo renderer; use the static SVG backend or interactive playback."))
      return {
        composition: {
          id: composition.id,
          title: composition.title,
          stage: { width: composition.stage.width, height: composition.stage.height, fps: composition.stage.fps },
          totalFrames,
          scenes: scenes.length,
        },
        scenes: scenes.map((scene) => ({
          id: scene.id,
          durationFrames: scene.durationFrames,
          nodeCount: scene.nodes.length,
          nodeIds: nodeIds(scene.nodes),
          ...(scene.transition ? { transition: scene.transition.type } : {}),
        })),
        resources: {
          pathDefinitions: scenes.flatMap((scene) => (scene.pathDefinitions ?? []).map((item) => item.id)),
          clipPaths: scenes.flatMap((scene) => (scene.clipPaths ?? []).map((item) => item.id)),
          masks: scenes.flatMap((scene) => (scene.masks ?? []).map((item) => item.id)),
          audio: (composition.audio ?? []).map((track) => track.id),
          assets: Object.keys(composition.assets ?? {}),
        },
        features: {
          reusablePaths: scenes.some((scene) => (scene.pathDefinitions?.length ?? 0) > 0 || nodes.some((node) => node.kind === "path" && node.pathRef !== undefined)),
          clipPaths: scenes.some((scene) => (scene.clipPaths?.length ?? 0) > 0 || nodes.some((node) => node.clipPathId !== undefined)),
          masks: scenes.some((scene) => (scene.masks?.length ?? 0) > 0 || nodes.some((node) => node.maskId !== undefined)),
          gradients: nodes.some((node) => {
            const paint = "fill" in node ? node.fill : undefined
            return typeof paint === "object" && paint !== null
          }),
          interactions: scenes.some((scene) => (scene.interactions?.length ?? 0) > 0) || (composition.timeline?.length ?? 0) > 0,
          audio: (composition.audio?.length ?? 0) > 0,
          physics2d: scenes.some((scene) => scene.physics !== undefined),
          physics3d: scenes.some((scene) => scene.physics3d !== undefined),
          software3d: nodes.some((node) => node.kind === "mesh3d"),
          interactivePlayback: (composition.timeline?.length ?? 0) > 0 || scenes.some((scene) => (scene.interactions?.length ?? 0) > 0) || nodes.some((node) => node.kind === "button" || node.kind === "input" || node.kind === "select"),
        },
        diagnostics,
      }
    }),
})

const ReferenceInput = Schema.Struct({
  topic: Schema.Literals(REFERENCE_TOPICS).annotate({
    description: "Which bounded reference section to return.",
  }),
})

const ReferenceOutput = Schema.Struct({
  topic: Schema.String,
  body: Schema.String,
})

const referenceTool = Tool.make({
  description:
    "Return the bounded authoring reference section for one Coenx Video topic (composition-model, cml, masks, gradients, rendering-backends, tools, validation, overview). Use it to check exact schema rules and budgets instead of guessing.",
  input: ReferenceInput,
  output: ReferenceOutput,
  toModelOutput: ({ output }) => [{ type: "text", text: output.body }],
  execute: (input) =>
    Effect.sync(() => {
      const section = referenceSection(input.topic as ReferenceTopic)
      return { topic: section.topic, body: section.body }
    }),
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    yield* tools
      .register({
        [inspectName]: inspectTool,
        [referenceName]: referenceTool,
      })
      .pipe(Effect.orDie)
  }),
)
