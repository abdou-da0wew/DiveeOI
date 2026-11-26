export * as CoenxVideoLessonTool from "./coenx-video-lesson"

import { Effect, Layer, Schema } from "effect"
import { ToolFailure } from "@diveeoi/llm"
import { packCoenx, validateCoenx } from "@diveeoi/coenx-video/container"
import { createInteractiveLesson, type InteractiveLessonInput } from "@diveeoi/coenx-video/learning"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const lessonName = "coenx_video_lesson"

const fail = (message: string) => new ToolFailure({ message })

const CitationSchema = Schema.Struct({
  bookId: Schema.String,
  passageId: Schema.String,
  title: Schema.optional(Schema.String),
  page: Schema.optional(Schema.Number),
  quote: Schema.optional(Schema.String),
})

const QuestionSchema = Schema.Struct({
  id: Schema.String.annotate({ description: "Question id matching [A-Za-z][A-Za-z0-9_-]*." }),
  prompt: Schema.String.annotate({ description: "Question prompt shown to the student (max ~600 chars)." }),
  options: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      correct: Schema.optional(Schema.Boolean),
    }),
  ).annotate({ description: "2-4 answer options, exactly one marked correct." }),
})

const LessonInputSchema = Schema.Struct({
  id: Schema.String.annotate({ description: "Lesson id matching [A-Za-z][A-Za-z0-9_-]*." }),
  title: Schema.String.annotate({ description: "Lesson title (max 120 chars)." }),
  learningObjective: Schema.String.annotate({ description: "The lesson's learning objective (max ~400 chars)." }),
  citations: Schema.Array(CitationSchema).annotate({
    description: "Retrieved source citations grounding every fact in the lesson (1-24).",
  }),
  intro: Schema.Struct({
    heading: Schema.String,
    body: Schema.String,
  }),
  questions: Schema.Array(QuestionSchema).annotate({
    description: "1-16 quiz questions; students retry wrong answers until correct.",
  }),
  passThreshold: Schema.optional(Schema.Number.annotate({ description: "Fraction required to pass (0..1, default 0.7)." })),
  outputPath: Schema.String.annotate({
    description: "Interactive lesson output path inside the current project directory (relative, .coenx4 extension).",
  }),
  renderer: Schema.optional(Schema.Literals(["canvas", "svg"])),
})

const LessonOutput = Schema.Struct({
  outputPath: Schema.String,
  bytes: Schema.Number,
  title: Schema.String,
  questions: Schema.Number,
  totalFrames: Schema.Number,
  durationSeconds: Schema.Number,
  passThreshold: Schema.Number,
  validation: Schema.Struct({ ok: Schema.Boolean, issues: Schema.Array(Schema.String) }),
})

function buildComposition(input: Schema.Schema.Type<typeof LessonInputSchema>) {
  return createInteractiveLesson({
    id: input.id,
    title: input.title,
    learningObjective: input.learningObjective,
    citations: input.citations.map((citation) => ({ ...citation })),
    intro: { ...input.intro },
    questions: input.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options.map((option) => ({
        id: option.id,
        text: option.text,
        ...(option.correct ? { correct: true } : {}),
      })),
    })),
    ...(input.passThreshold !== undefined ? { passThreshold: input.passThreshold } : {}),
  })
}

const lessonTool = Tool.make({
  description:
    "Create a grounded interactive lesson as a portable .coenx4 container for Targeted Learning: an intro scene, one quiz scene per question (retry on wrong answers, live score, tl:answer:* events) and a graded results scene with replay. Requires write approval on the output path. The lesson opens in the DiveeOI interactive video viewer and works fully offline.",
  input: LessonInputSchema,
  output: LessonOutput,
  toModelOutput: ({ output }) => [
    {
      type: "text",
      text: JSON.stringify(
        {
          outputPath: output.outputPath,
          bytes: output.bytes,
          title: output.title,
          questions: output.questions,
          frames: output.totalFrames,
          durationSeconds: output.durationSeconds,
          passThreshold: output.passThreshold,
          validation: output.validation,
        },
        null,
        2,
      ),
    },
  ],
  execute: (input, context) => lessonExecute(mutationService!, permissionService!, locationDirectory, input, context),
})

let locationDirectory = "."
let mutationService: LocationMutation.Interface | undefined
let permissionService: PermissionV2.Interface | undefined

function lessonExecute(
  mutation: LocationMutation.Interface,
  permission: PermissionV2.Interface,
  directory: string,
  input: Schema.Schema.Type<typeof LessonInputSchema>,
  context: Parameters<Parameters<typeof Tool.make>[0]["execute"]>[1],
): Effect.Effect<Schema.Schema.Type<typeof LessonOutput>, ToolFailure> {
  let composition: ReturnType<typeof createInteractiveLesson>
  try {
    composition = buildComposition(input)
  } catch (error) {
    return Effect.fail(fail(error instanceof Error ? error.message : "Lesson spec is invalid"))
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
      .pipe(Effect.mapError(() => fail("Writing the interactive lesson requires edit approval")))
    if (!/\.coenx4$/i.test(target.resource)) {
      return yield* Effect.fail(fail("Interactive lessons must use the .coenx4 extension"))
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
      return yield* Effect.fail(fail("Packed lesson failed validation: " + validation.issues.join("; ")))
    }
    const total = input.questions.length
    const threshold = Math.max(0, Math.min(input.passThreshold ?? 0.7, 1))
    return {
      outputPath: target.resource,
      bytes: result.bytes,
      title: result.manifest.title,
      questions: total,
      totalFrames: result.manifest.totalFrames,
      durationSeconds: result.manifest.durationSeconds,
      passThreshold: threshold,
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
        [lessonName]: lessonTool,
      })
      .pipe(Effect.orDie)
  }),
)
