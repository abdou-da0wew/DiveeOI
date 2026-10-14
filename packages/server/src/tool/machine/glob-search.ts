import path from "node:path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Ripgrep } from "@diveeoi/db/ripgrep"
import { assertExternalDirectoryEffect } from "../external-directory"
import DESCRIPTION from "./glob-search.txt"
import * as Tool from "../tool"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({
    description: "Glob pattern, e.g. '**/*.ts' or 'src/**/*.test.ts'",
  }),
  cwd: Schema.optional(Schema.String).annotate({
    description: "Directory to search in (defaults to the session working directory)",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of matches to return (default 100)",
  }),
})

interface GlobSearchMetadata {
  pattern: string
  cwd: string
  count: number
  truncated: boolean
  available: boolean
  reason: string
}

/**
 * `glob_search(pattern, cwd?, limit?)` — fast path over the existing glob
 * tool (draft-10 P6). Auto-approved (read-only). Uses the same Ripgrep
 * machinery the existing glob tool uses.
 */
export const GlobSearchTool = Tool.define(
  "glob_search",
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: { pattern: string; cwd?: string; limit?: number },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const search = params.cwd ?? ins.directory
          yield* ctx.ask({
            permission: "glob_search",
            patterns: [params.pattern],
            always: ["*"],
            metadata: { pattern: params.pattern, cwd: search },
          })
          yield* assertExternalDirectoryEffect(ctx, search, {
            bypass: false,
            kind: "directory",
          }).pipe(Effect.catch(() => Effect.fail(new Error(`Directory not allowed: ${search}`))))
          const limit = params.limit ?? 100
          const files = yield* ripgrep.glob({ cwd: search, pattern: params.pattern, limit })
          const truncated = files.length === limit
          const output: string[] = files.map((f) => path.resolve(search, f.path))
          if (truncated) {
            output.push("")
            output.push(`(Results truncated: showing first ${limit}.)`)
          }
          const meta: GlobSearchMetadata = {
            pattern: params.pattern,
            cwd: search,
            count: files.length,
            truncated,
            available: true,
            reason: "",
          }
          return {
            output: output.join("\n") || "No files found",
            title: `${files.length} matches for ${params.pattern}`,
            metadata: meta,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
