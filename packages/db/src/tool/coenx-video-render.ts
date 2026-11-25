export * as CoenxVideoRenderTool from "./coenx-video-render"

import { Effect, Layer, Schema } from "effect"
import { ToolFailure } from "@diveeoi/llm"
import { renderNativeVideo, renderPreviewFrames, renderStandardVideo } from "@diveeoi/coenx-video/export"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { compileSource, SourceInput } from "./coenx-video"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const previewName = "coenx_video_preview"
export const exportName = "coenx_video_export"

const fail = (message: string) => new ToolFailure({ message })

const PreviewInput = Schema.Struct({
  format: Schema.Literals(["cml", "json"]),
  source: Schema.String.annotate({ description: "Complete CML markup or JSON VideoComposition source." }),
  styles: Schema.String.pipe(Schema.optional),
  script: Schema.String.pipe(Schema.optional),
  frames: Schema.Array(Schema.Number).annotate({
    description: "1-8 global frame indices to render (clamped to the composition).",
  }),
  maxDimension: Schema.optional(Schema.Number).annotate({
    description: "Longest PNG edge in pixels, 128-1280; defaults to 640.",
  }),
})

const PreviewOutput = Schema.Struct({
  backend: Schema.Literal("static-svg"),
  width: Schema.Number,
  height: Schema.Number,
  totalBytes: Schema.Number,
  frames: Schema.Array(
    Schema.Struct({
      frame: Schema.Number,
      width: Schema.Number,
      height: Schema.Number,
      mime: Schema.Literal("image/png"),
      bytesBase64: Schema.String,
    }),
  ),
})

const previewTool = Tool.make({
  description:
    "Render 1-8 preview frames of a complete Coenx Video project as small PNG images through the static SVG backend. Read-only and bounded: no FFmpeg, no native binary, frames clamped to the composition, dimensions capped at 1280 pixels. Image assets must be inline data URLs or resolvable inside the current project directory. Validate the project with coenx_video_validate first.",
  input: PreviewInput,
  output: PreviewOutput,
  toModelOutput: ({ output }) => [
    {
      type: "text",
      text: JSON.stringify(
        {
          backend: output.backend,
          size: `${output.width}x${output.height}`,
          totalBytes: output.totalBytes,
          frames: output.frames.map((frame) => ({ frame: frame.frame, bytes: frame.bytesBase64.length })),
        },
        null,
        2,
      ),
    },
    ...output.frames.map((frame) => ({
      type: "file" as const,
      data: frame.bytesBase64,
      mime: frame.mime,
      name: `coenx-frame-${frame.frame}.png`,
    })),
  ],
  execute: (input) => {
    const compiled = compileSource(input)
    const composition = compiled.composition
    if (!composition) {
      return Effect.fail(fail(compiled.diagnostics.map((item) => `${item.code}: ${item.message}`).join("; ")))
    }
    if (input.frames.length < 1 || input.frames.length > 8) {
      return Effect.fail(fail("frames must contain 1-8 frame indices"))
    }
    const maxDimension = input.maxDimension ?? 640
    if (maxDimension < 128 || maxDimension > 1280) {
      return Effect.fail(fail("maxDimension must be between 128 and 1280"))
    }
    return Effect.tryPromise({
      try: () =>
        renderPreviewFrames(composition, {
          frames: [...input.frames],
          maxDimension,
          projectRoot: locationDirectory,
        }),
      catch: (error) => fail(error instanceof Error ? `Preview failed: ${error.message}` : "Preview failed for an unknown reason."),
    }).pipe(Effect.map((preview) => ({
        backend: preview.backend,
        width: preview.frames[0]?.width ?? 0,
        height: preview.frames[0]?.height ?? 0,
          totalBytes: preview.totalBytes,
          frames: preview.frames.map((frame) => ({
            frame: frame.frame,
            width: frame.width,
            height: frame.height,
            mime: frame.mime,
            bytesBase64: Buffer.from(frame.bytes).toString("base64"),
          })),
        })),
      )
    },
})

const ExportInput = Schema.Struct({
  format: Schema.Literals(["cml", "json"]),
  source: Schema.String.annotate({ description: "Complete CML markup or JSON VideoComposition source." }),
  styles: Schema.String.pipe(Schema.optional),
  script: Schema.String.pipe(Schema.optional),
  outputPath: Schema.String.annotate({
    description: "MP4 output path inside the current project directory (relative, .mp4 extension).",
  }),
  renderer: Schema.Literals(["auto", "svg", "native"]).pipe(Schema.optional),
  profile: Schema.Literals(["low", "balanced", "quality"]).pipe(Schema.optional),
  overwrite: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Allow replacing an existing output file; defaults to false.",
  }),
})

const ExportOutput = Schema.Struct({
  outputPath: Schema.String,
  backend: Schema.Literals(["static-svg", "native-cairo"]),
  rendererRequested: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  fps: Schema.Number,
  frames: Schema.Number,
  durationSeconds: Schema.Number,
  bytes: Schema.Number,
  profile: Schema.String,
  notes: Schema.Array(Schema.String),
})

const exportTool = Tool.make({
  description:
    "Export a complete, validated Coenx Video project to an MP4 file inside the current project directory. Requires write approval on the output path. Refuses to replace an existing file unless overwrite is true. Bounded render profiles (low defaults to 1280x720@24). The manifest records the backend actually used and any fallback notes. Cancels cleanly when the session is interrupted.",
  input: ExportInput,
  output: ExportOutput,
  toModelOutput: ({ output }) => [
    {
      type: "text",
      text: JSON.stringify(
        {
          outputPath: output.outputPath,
          backend: output.backend,
          size: `${output.width}x${output.height}@${output.fps}`,
          frames: output.frames,
          durationSeconds: output.durationSeconds,
          bytes: output.bytes,
          notes: output.notes,
        },
        null,
        2,
      ),
    },
  ],
  execute: (input, context) =>
    exportExecute(mutationService!, permissionService!, locationDirectory, input, context),
})

let locationDirectory = "."
let mutationService: LocationMutation.Interface | undefined
let permissionService: PermissionV2.Interface | undefined

function exportExecute(
  mutation: LocationMutation.Interface,
  permission: PermissionV2.Interface,
  directory: string,
  input: Schema.Schema.Type<typeof ExportInput>,
  context: Parameters<Parameters<typeof Tool.make>[0]["execute"]>[1],
): Effect.Effect<Schema.Schema.Type<typeof ExportOutput>, ToolFailure> {
  const compiled = compileSource(input)
  const composition = compiled.composition
  if (!composition) {
    return Effect.fail(fail(compiled.diagnostics.map((item) => `${item.code}: ${item.message}`).join("; ")))
  }
  return Effect.gen(function* () {
    const source = {
      type: "tool" as const,
      messageID: context.assistantMessageID,
      callID: context.toolCallID,
    }
    const target = yield* mutation
      .resolve({ path: input.outputPath, kind: "file" })
      .pipe(Effect.mapError(() => fail(`Unable to resolve output path ${input.outputPath}`)))
    const external = target.externalDirectory
    if (external)
      yield* permission
        .assert({
          ...LocationMutation.externalDirectoryPermission(external),
          sessionID: context.sessionID,
          agent: context.agent,
          source,
        })
        .pipe(Effect.mapError(() => fail("External directory access was not approved")))
    yield* permission
      .assert({
        action: "edit",
        resources: [target.resource],
        save: ["*"],
        sessionID: context.sessionID,
        agent: context.agent,
        source,
      })
      .pipe(Effect.mapError(() => fail("Writing the video output requires edit approval")))
    if (!/\.mp4$/i.test(input.outputPath) && !/\.mp4$/i.test(target.resource)) {
      return yield* Effect.fail(fail("Video output must use the .mp4 extension"))
    }

    const renderer = input.renderer ?? "auto"
    const profile = input.profile ?? "low"
    const controller = new AbortController()
    const notes: string[] = []
    if (renderer === "native") {
      notes.push("native renderer requested: the export fails with a clear error when the Rust binary has not been built")
    }
    if (renderer === "auto") {
      notes.push("auto selected the static SVG/ImageMagick backend (compatibility path)")
    }

    const result = yield* Effect.tryPromise({
      try: () =>
        renderer === "native"
          ? renderNativeVideo(composition, {
              outputPath: target.canonical,
              projectRoot: directory,
              profile: { name: profile },
              signal: controller.signal,
            })
          : renderStandardVideo(composition, {
              outputPath: target.canonical,
              projectRoot: directory,
              profile: { name: profile },
              signal: controller.signal,
            }),
      catch: (error) => fail(error instanceof Error ? `Export failed: ${error.message}` : "Export failed for an unknown reason."),
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          controller.abort(new Error("Export cancelled"))
        }),
      ),
    )
    return {
      outputPath: target.resource,
      backend: renderer === "native" ? ("native-cairo" as const) : ("static-svg" as const),
      rendererRequested: renderer,
      width: result.width,
      height: result.height,
      fps: result.fps,
      frames: result.frames,
      durationSeconds: result.durationSeconds,
      bytes: result.bytes,
      profile,
      notes,
    }
  })
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const location = yield* Location.Service
    mutationService = yield* LocationMutation.Service
    permissionService = yield* PermissionV2.Service
    locationDirectory = location.directory
    yield* tools
      .register({
        [previewName]: previewTool,
        [exportName]: exportTool,
      })
      .pipe(Effect.orDie)
  }),
)
