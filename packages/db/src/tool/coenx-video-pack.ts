export * as CoenxVideoPackTool from "./coenx-video-pack"

import { Effect, Layer, Schema } from "effect"
import { ToolFailure } from "@diveeoi/llm"
import { packCoenx, validateCoenx } from "@diveeoi/coenx-video/container"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { compileSource, SourceInput } from "./coenx-video"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const packName = "coenx_video_pack"
export const validateContainerName = "coenx_video_validate_container"

const fail = (message: string) => new ToolFailure({ message })

const PackInputSchema = Schema.Struct({
  format: Schema.Literals(["cml", "json"]),
  source: Schema.String.annotate({ description: "Complete CML markup or JSON VideoComposition source." }),
  styles: Schema.String.pipe(Schema.optional),
  script: Schema.String.pipe(Schema.optional),
  outputPath: Schema.String.annotate({
    description: "Interactive container output path inside the current project directory (relative, .coenx4 extension).",
  }),
  renderer: Schema.Literals(["canvas", "svg"]).pipe(Schema.optional),
})

const PackOutput = Schema.Struct({
  outputPath: Schema.String,
  bytes: Schema.Number,
  title: Schema.String,
  stage: Schema.Struct({ width: Schema.Number, height: Schema.Number, fps: Schema.Number }),
  totalFrames: Schema.Number,
  durationSeconds: Schema.Number,
  mediaCount: Schema.Number,
  validation: Schema.Struct({ ok: Schema.Boolean, issues: Schema.Array(Schema.String) }),
})

const packTool = Tool.make({
  description:
    "Pack a complete, validated Coenx Video project into a portable interactive .coenx4 container (zip): an embedded self-contained composition (media and custom fonts as data URIs), a standalone offline player.html, the raw media files and a manifest. Requires write approval on the output path. The result plays interactive scenes (click/goto/quiz state machines) with zero network access.",
  input: PackInputSchema,
  output: PackOutput,
  toModelOutput: ({ output }) => [
    {
      type: "text",
      text: JSON.stringify(
        {
          outputPath: output.outputPath,
          bytes: output.bytes,
          title: output.title,
          size: `${output.stage.width}x${output.stage.height}@${output.stage.fps}`,
          frames: output.totalFrames,
          durationSeconds: output.durationSeconds,
          mediaCount: output.mediaCount,
          validation: output.validation,
        },
        null,
        2,
      ),
    },
  ],
  execute: (input, context) =>
    packExecute(mutationService!, permissionService!, locationDirectory, input, context),
})

let locationDirectory = "."
let mutationService: LocationMutation.Interface | undefined
let permissionService: PermissionV2.Interface | undefined

function packExecute(
  mutation: LocationMutation.Interface,
  permission: PermissionV2.Interface,
  directory: string,
  input: Schema.Schema.Type<typeof PackInputSchema>,
  context: Parameters<Parameters<typeof Tool.make>[0]["execute"]>[1],
): Effect.Effect<Schema.Schema.Type<typeof PackOutput>, ToolFailure> {
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
      .pipe(Effect.mapError(() => fail("Writing the interactive container requires edit approval")))
    if (!/\.coenx4$/i.test(target.resource)) {
      return yield* Effect.fail(fail("Interactive containers must use the .coenx4 extension"))
    }
    const result = yield* Effect.tryPromise({
      try: () =>
        packCoenx({
          composition,
          projectRoot: directory,
          outputPath: target.canonical,
          renderer: input.renderer ?? "canvas",
        }),
      catch: (error) => fail(error instanceof Error ? `Pack failed: ${error.message}` : "Pack failed for an unknown reason."),
    })
    const validation = yield* Effect.tryPromise({
      try: () => validateCoenx(target.canonical),
      catch: (error) => fail(error instanceof Error ? `Container validation failed: ${error.message}` : "Container validation failed."),
    })
    if (!validation.ok) {
      return yield* Effect.fail(fail("Packed container failed validation: " + validation.issues.join("; ")))
    }
    return {
      outputPath: target.resource,
      bytes: result.bytes,
      title: result.manifest.title,
      stage: result.manifest.stage,
      totalFrames: result.manifest.totalFrames,
      durationSeconds: result.manifest.durationSeconds,
      mediaCount: result.manifest.media.length,
      validation: { ok: validation.ok, issues: validation.issues },
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
        [packName]: packTool,
      })
      .pipe(Effect.orDie)
  }),
)
