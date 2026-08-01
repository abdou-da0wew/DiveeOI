export * as ListTool from "./list"

import { ToolFailure } from "@diveeoi/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { FileSystem } from "../filesystem"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { RelativePath, PositiveInt } from "../schema"

export const name = "list"

const IncludeField = Schema.Literals(["path", "type", "size", "modified", "mode"])

export const Input = Schema.Struct({
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory path to list (relative to workspace root). Defaults to workspace root. Use '.' for root, 'src' for src directory, etc.",
  }),
  limit: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum number of entries to return (default: 10000).",
  }),
  fileType: Schema.Literals(["file", "directory"]).pipe(Schema.optional).annotate({
    description: "Filter by type: 'file' for files only, 'directory' for folders only. Omit for both.",
  }),
  noIgnore: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "If true, shows files normally hidden by .gitignore (build artifacts, node_modules, etc.). Default: false.",
  }),
  include: Schema.Array(IncludeField).pipe(Schema.optional).annotate({
    description: "Output fields per entry: 'path' (relative path), 'type' (file/directory), 'size' (bytes), 'modified' (Unix ms), 'mode' (permissions). Default: all.",
  }),
})

export const Output = Schema.Array(FileSystem.Entry)
type ModelOutput = typeof Output.Encoded

export const toModelOutput = (output: ModelOutput) => {
  if (output.length === 0) return "No files found"
  return output.map((item) => item.path).join("\n")
}

const sidecarPath = path.resolve(__dirname, "sidecar/fsutil")

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "FAST single-directory listing using optimized Go sidecar. Lists immediate contents of ONE directory (non-recursive). Use when you need to see what's directly in a folder.\n\n" +
            "Examples:\n" +
            "- List workspace root: path='.'\n" +
            "- List src directory: path='src'\n" +
            "- List only directories: path='src' fileType='directory'\n" +
            "- List ignoring .gitignore: path='build' noIgnore=true\n\n" +
            "KEY DIFFERENCES:\n" +
            "- list: Single directory, flat listing, instant\n" +
            "- glob: Pattern matching across tree (use ** for recursion)\n" +
            "- find: Recursive walk with filtering (slower, more flexible)\n" +
            "\n" +
            "Best for: Quick directory overview, checking if directory exists, seeing immediate children. Use 'include' to reduce output (e.g., include=['path','type'] for just names and types).",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: toModelOutput(
                output.map((entry) => ({ ...entry, path: path.resolve(location.directory, entry.path) })),
              ),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.path ?? "."],
                save: ["*"],
                metadata: {
                  path: input.path,
                  limit: input.limit,
                  fileType: input.fileType,
                  noIgnore: input.noIgnore,
                  include: input.include,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const limit = input.limit ?? 10000
              const fileType = input.fileType
              const noIgnore = input.noIgnore ?? false
              const include = input.include

              const args = [
                "-type",
                "list",
                "-root",
                location.directory,
                "-path",
                input.path ?? ".",
                "-limit",
                String(limit),
              ]
              if (fileType) args.push("-fileType", fileType)
              if (noIgnore) args.push("-noIgnore", "true")
              if (include && include.length > 0) {
                for (const f of include) args.push("-include", f)
              }

              const result = yield* Effect.tryPromise({
                try: async () => {
                  const proc = Bun.spawn([sidecarPath, ...args], {
                    stdout: "pipe",
                    stderr: "pipe",
                  })
                  let stdout = ""
                  let stderr = ""
                  for await (const chunk of proc.stdout) {
                    stdout += new TextDecoder().decode(chunk)
                  }
                  for await (const chunk of proc.stderr) {
                    stderr += new TextDecoder().decode(chunk)
                  }
                  const exitCode = await proc.exited
                  if (exitCode !== 0) {
                    throw new Error(stderr || `Sidecar exited with code ${exitCode}`)
                  }
                  return stdout
                },
                catch: (error) => new ToolFailure({ message: `List failed: ${error}` }),
              })

              const parsed = JSON.parse(result) as { entries: ModelOutput; count: number; error?: string }
              if (parsed.error) {
                return yield* Effect.fail(new ToolFailure({ message: parsed.error }))
              }

              return parsed.entries.map((entry) =>
                new FileSystem.Entry({
                  ...entry,
                  path: RelativePath.make(path.relative(location.directory, path.resolve(location.directory, entry.path))),
                }),
              )
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to list directory ${input.path ?? "."}` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)