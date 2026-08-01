export * as FindTool from "./find"

import { ToolFailure } from "@diveeoi/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { FileSystem } from "../filesystem"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { RelativePath, PositiveInt } from "../schema"

export const name = "find"

const IncludeField = Schema.Literals(["path", "type", "size", "modified", "mode"])

export const Input = Schema.Struct({
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory to search recursively. Defaults to the active Location.",
  }),
  pattern: Schema.String.pipe(Schema.optional).annotate({
    description: "Glob pattern to filter results (e.g., '*.ts', '**/*.go', 'test_*.py'). Applied to full relative path.",
  }),
  limit: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum results to return (default: 10000)",
  }),
  maxDepth: Schema.Int.pipe(Schema.optional).annotate({
    description: "Maximum directory depth to traverse (-1 for unlimited, default: -1)",
  }),
  fileType: Schema.Literals(["file", "directory"]).pipe(Schema.optional).annotate({
    description: "Filter by type: 'file' or 'directory'",
  }),
  noIgnore: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Ignore .gitignore and built-in ignore patterns (node_modules, dist, .git, etc.)",
  }),
  include: Schema.Array(IncludeField).pipe(Schema.optional).annotate({
    description: "Fields to include in output (default: all). Options: path, type, size, modified, mode",
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
            "RECURSIVE file finder - walks directory tree to find matching files. Use when you need to search entire subtrees.\n\n" +
            "KEY DIFFERENCES:\n" +
            "- glob: Single pattern match, non-recursive unless ** used. Fast for known patterns.\n" +
            "- find: Full recursive walk with optional pattern filter. Best for 'find all X in project'.\n" +
            "- list: Single directory only, no recursion.\n\n" +
            "USE FIND WHEN:\n" +
            "- You need to search entire project/subtree recursively\n" +
            "- Pattern is a filter (e.g., find all .test.ts files anywhere)\n" +
            "- You need maxDepth control\n" +
            "- You want to filter by fileType during traversal\n\n" +
            "PERFORMANCE: Uses Go sidecar with parallel directory walking. Blazing fast on large codebases (100k+ files).\n" +
            "Ignores .git, node_modules, dist, build, .next, .turbo, vendor by default (use noIgnore=true to disable).",
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
                resources: [input.path ?? ".", input.pattern ?? "*"],
                save: ["*"],
                metadata: {
                  path: input.path,
                  pattern: input.pattern,
                  limit: input.limit,
                  maxDepth: input.maxDepth,
                  fileType: input.fileType,
                  noIgnore: input.noIgnore,
                  include: input.include,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const limit = input.limit ?? 10000
              const maxDepth = input.maxDepth ?? -1
              const fileType = input.fileType
              const noIgnore = input.noIgnore ?? false
              const include = input.include

              const args = [
                "-type",
                "find",
                "-root",
                location.directory,
                "-path",
                input.path ?? ".",
                "-limit",
                String(limit),
                "-maxDepth",
                String(maxDepth),
              ]
              if (input.pattern) args.push("-pattern", input.pattern)
              if (fileType) args.push("-fileType", fileType)
              if (noIgnore) args.push("-noIgnore", "true")
              if (include && include.length > 0) {
                for (const f of include) args.push("-include", f)
              }

              const result = yield* Effect.tryPromise({
                try: () =>
                  new Promise((resolve, reject) => {
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
                    const exitCode = yield* proc.exited
                    if (exitCode !== 0) {
                      reject(new Error(stderr || "Sidecar exited with code " + exitCode))
                    } else {
                      resolve(stdout)
                    }
                  }),
                catch: (error) => new ToolFailure({ message: `Find failed: ${error}` }),
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
              Effect.mapError(() => new ToolFailure({ message: `Unable to find files in ${input.path ?? "."}` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)