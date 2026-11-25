export * as CoenxVideoTool from "./coenx-video"

import { Effect, Layer, Schema } from "effect"
import { COENX_VIDEO_CAPABILITIES } from "@diveeoi/coenx-video/capabilities"
import {
  compileCmlProject,
  RENDER_PROFILES,
  validateComposition,
  VideoValidationError,
  type VideoComposition,
} from "@diveeoi/coenx-video/validation"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const capabilitiesName = "coenx_video_capabilities"
export const validateName = "coenx_video_validate"
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024

export const SourceInput = Schema.Struct({
  format: Schema.Literals(["cml", "json"]),
  source: Schema.String.annotate({ description: "Complete CML markup or JSON VideoComposition source." }),
  styles: Schema.String.pipe(Schema.optional),
  script: Schema.String.pipe(Schema.optional),
})
export type SourceInput = Schema.Schema.Type<typeof SourceInput>

const Diagnostic = Schema.Struct({
  code: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
  message: Schema.String,
})

export function diagnostic(code: string, message: string): { code: string; severity: "error" | "warning"; message: string } {
  return { code, severity: "error", message: message.slice(0, 1_000) }
}

/** Shared bounded compile/validate step for every source-consuming Coenx tool. */
export function compileSource(input: SourceInput): { composition?: VideoComposition; diagnostics: Array<{ code: string; severity: "error" | "warning"; message: string }> } {
  const byteLength = new TextEncoder().encode(input.source + (input.styles ?? "") + (input.script ?? "")).byteLength
  if (byteLength > MAX_SOURCE_BYTES) {
    return { diagnostics: [diagnostic("source.too_large", "Combined project source must not exceed 2 MiB.")] }
  }
  if (input.format === "json" && (input.styles !== undefined || input.script !== undefined)) {
    return { diagnostics: [diagnostic("source.unexpected_files", "styles and script are only accepted with CML source.")] }
  }
  let composition: VideoComposition
  try {
    if (input.format === "cml") {
      composition = compileCmlProject({
        markup: input.source,
        styles: input.styles,
        script: input.script,
      })
    } else {
      composition = JSON.parse(input.source) as VideoComposition
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to parse project source."
    return {
      diagnostics: [diagnostic(input.format === "json" ? "source.invalid_json" : "source.compile_failed", message)],
    }
  }
  try {
    validateComposition(composition, RENDER_PROFILES.quality)
    return { composition, diagnostics: [] }
  } catch (error) {
    const issues =
      error instanceof VideoValidationError
        ? error.issues
        : [error instanceof Error ? error.message : "Composition validation failed."]
    return { diagnostics: issues.slice(0, 50).map((message) => diagnostic("composition.invalid", message)) }
  }
}

const Support = Schema.Struct({
  "static-svg": Schema.Literals(["supported", "partial", "unsupported"]),
  "native-cairo": Schema.Literals(["supported", "partial", "unsupported"]),
  "interactive-canvas": Schema.Literals(["supported", "partial", "unsupported"]),
  "interactive-svg": Schema.Literals(["supported", "partial", "unsupported"]),
})

const Renderer = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  targets: Schema.Array(Schema.String),
  acceleration: Schema.Literal("cpu"),
  status: Schema.Literal("available"),
  features: Schema.Array(Schema.String),
  limitations: Schema.Array(Schema.String),
})

const Feature = Schema.Struct({
  id: Schema.String,
  support: Support,
  notes: Schema.Array(Schema.String),
})

const CapabilitiesOutput = Schema.Struct({
  schemaVersion: Schema.Number,
  composition: Schema.Struct({
    version: Schema.Number,
    sharedAcrossOutputs: Schema.Boolean,
    rule: Schema.String,
  }),
  renderers: Schema.Array(Renderer),
  features: Schema.Array(Feature),
  authoring: Schema.Struct({
    formats: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        supportedNodes: Schema.Array(Schema.String),
        unsupportedAuthoringFeatures: Schema.Array(Schema.String),
      }),
    ),
    safety: Schema.Array(Schema.String),
  }),
  threeD: Schema.Struct({
    current: Schema.Struct({
      renderer: Schema.String,
      available: Schema.Boolean,
      features: Schema.Array(Schema.String),
      limitations: Schema.Array(Schema.String),
    }),
    gpu: Schema.Struct({
      status: Schema.Literal("planned"),
      browser: Schema.String,
      native: Schema.String,
      sharedContract: Schema.String,
    }),
    cpuFallback: Schema.Struct({
      available: Schema.Boolean,
      deterministic: Schema.Boolean,
      policy: Schema.String,
    }),
  }),
})

const Input = Schema.Struct({})
const ValidateInput = SourceInput

const Summary = Schema.Struct({
  stage: Schema.Struct({
    width: Schema.Number,
    height: Schema.Number,
    fps: Schema.Number,
  }),
  scenes: Schema.Number,
  nodes: Schema.Number,
  totalFrames: Schema.Number,
})

const ValidateOutput = Schema.Struct({
  valid: Schema.Boolean,
  format: Schema.Literals(["cml", "json"]),
  diagnostics: Schema.Array(Diagnostic),
  summary: Schema.optional(Summary),
})

type ValidateResult = Schema.Schema.Type<typeof ValidateOutput>

function validateSource(input: SourceInput): ValidateResult {
  const compiled = compileSource(input)
  const summary = compiled.composition
  if (!summary) {
    return { valid: false, format: input.format, diagnostics: compiled.diagnostics }
  }
  try {
    const result = validateComposition(summary, RENDER_PROFILES.quality)
    return {
      valid: true,
      format: input.format,
      diagnostics: [],
      summary: {
        stage: {
          width: summary.stage.width,
          height: summary.stage.height,
          fps: summary.stage.fps,
        },
        scenes: summary.scenes.length,
        nodes: result.nodeCount,
        totalFrames: result.totalFrames,
      },
    }
  } catch (error) {
    const issues =
      error instanceof VideoValidationError
        ? error.issues
        : [error instanceof Error ? error.message : "Composition validation failed."]
    return {
      valid: false,
      format: input.format,
      diagnostics: issues.slice(0, 50).map((message) => diagnostic("composition.invalid", message)),
    }
  }
}

const capabilitiesTool = Tool.make({
  description:
    "Return the authoritative machine-readable Coenx Video capability matrix. Check this before authoring or selecting an output renderer. It reports per-backend feature support, CML versus structured-model authoring limits, current CPU-projected 3D support, planned GPU backends and the CPU fallback policy. GPU 3D is planned, not available.",
  input: Input,
  output: CapabilitiesOutput,
  toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output, null, 2) }],
  execute: () =>
    Effect.succeed(
      JSON.parse(JSON.stringify(COENX_VIDEO_CAPABILITIES)) as Schema.Schema.Type<typeof CapabilitiesOutput>,
    ),
})

const validateTool = Tool.make({
  description:
    "Compile and validate a complete Coenx Video project without rendering it. Provide CML markup or a JSON VideoComposition. For CML, styles and the restricted declarative script are optional. Returns structured diagnostics and a validated stage/scene/frame summary. Does not execute JavaScript, access files, fetch media or export video.",
  input: ValidateInput,
  output: ValidateOutput,
  toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output, null, 2) }],
  execute: (input) => Effect.sync(() => validateSource(input)),
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    yield* tools
      .register({
        [capabilitiesName]: capabilitiesTool,
        [validateName]: validateTool,
      })
      .pipe(Effect.orDie)
  }),
)
