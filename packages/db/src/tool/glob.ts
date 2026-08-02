export * as GlobTool from "./glob"

import { ToolFailure } from "@diveeoi/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { FileSystem } from "../filesystem"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { RelativePath, PositiveInt } from "../schema"

export const name = "glob"

const IncludeFilter = Schema.Literals(["size", "modified", "mode"])

export const Input = Schema.Struct({
  pattern: Schema.String.annotate({ 
    description: "Glob pattern to match files against. Use * for single-level wildcards, ** for recursive matching (e.g., '**/*.ts' finds all TypeScript files recursively, 'src/**/*.test.ts' finds test files under src). Patterns are relative to the path parameter." 
  }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Base directory to search from (relative to workspace root). Defaults to the active workspace location. Use '.' for current workspace root.",
  }),
  limit: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum number of results to return (default: 10000). Use to prevent excessive output when pattern matches many files.",
  }),
  fileType: Schema.Literals(["file", "directory"]).pipe(Schema.optional).annotate({
    description: "Filter results by type: 'file' returns only files, 'directory' returns only directories. Omit to include both.",
  }),
  noIgnore: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "If true, ignores .gitignore and other ignore files. Use when searching for files that are normally ignored (e.g., build artifacts, node_modules). Default: false.",
  }),
  include: Schema.Array(IncludeFilter).pipe(Schema.optional).annotate({
    description: "Output fields to include for each match. Options: 'size' (file size in bytes), 'modified' (Unix timestamp in ms), 'mode' (permission string like '-rw-r--r--'). Default: all fields.",
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
            "FAST file pattern matching using optimized Go sidecar. Use this when you need to find files by name/pattern across the workspace. Examples:\n" +
            "- Find all test files: pattern='**/*.test.ts'\n" +
            "- Find config files: pattern='**/*.json' path='config'\n" +
            "- Find all TS files in src: pattern='src/**/*.ts'\n" +
            "- Find a specific file: pattern='**/package.json'\n" +
            "\n" +
            "KEY DIFFERENCES from other tools:\n" +
            "- glob: Pattern-based matching (fast, uses ** for recursion)\n" +
            "- list: Single directory listing (not recursive)\n" +
            "- find: Recursive walk with filtering (slower but more flexible)\n" +
            "- grep: Search file CONTENTS, not names\n" +
            "\n" +
            "Best for: Locating files by name pattern, discovering project structure, finding all files of a type. Use 'include' to reduce output size when you only need paths.",
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
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: input.path ?? ".",
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

              const cwd = path.resolve(location.directory, input.path ?? ".")
              const limit = input.limit ?? 10000
              const fileType = input.fileType
              const noIgnore = input.noIgnore ?? false
              const include = input.include

              const args = [
                "-type",
                "glob",
                "-root",
                location.directory,
                "-pattern",
                input.pattern,
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
                  const stdout = await Bun.readableStreamToText(proc.stdout)
                  const stderr = await Bun.readableStreamToText(proc.stderr)
                  const exitCode = await proc.exited
                  if (exitCode !== 0) {
                    throw new Error(stderr || `Sidecar exited with code ${exitCode}`)
                  }
                  return stdout
                },
                catch: (error) => new ToolFailure({ message: `Glob failed: ${error}` }),
              })

              const parsed = JSON.parse(result) as { entries: ModelOutput; count: number; error?: string }
              if (parsed.error) {
                return yield* Effect.fail(new ToolFailure({ message: parsed.error }))
              }

              return parsed.entries.map((entry) =>
                new FileSystem.Entry({
                  ...entry,
                  path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, entry.path))),
                }),
              )
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to find files matching ${input.pattern}` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)