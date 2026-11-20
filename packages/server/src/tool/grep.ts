import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@diveeoi/db/fs-util"
import { Ripgrep } from "@diveeoi/db/ripgrep"
import { RemoteSession } from "@/ssh-client"
import { grep as remoteGrep } from "@/ssh-client/remote-search"
import { assertExternalDirectoryEffect } from "./external-directory"
import { withLocalToolContext } from "./remote-local-context"
import DESCRIPTION from "./grep.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The regex pattern to search for in file contents" }),
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. Defaults to the current working directory.",
  }),
  include: Schema.optional(Schema.String).annotate({
    description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
  }),
  ctx_local: Schema.optional(Schema.Boolean).annotate({
    description:
      "Remote sessions: when true, search the LOCAL machine instead of the remote SSH host. Defaults to false (remote).",
  }),
})

export const GrepTool = Tool.define(
  "grep",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const remote = yield* RemoteSession.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        withLocalToolContext(
          Effect.gen(function* () {
            const empty = {
              title: params.pattern,
              metadata: { matches: 0, truncated: false },
              output: "No files found",
            }
            if (!params.pattern) throw new Error("pattern is required")

            yield* ctx.ask({
              permission: "grep",
              patterns: [params.pattern],
              always: ["*"],
              metadata: { pattern: params.pattern, path: params.path, include: params.include },
            })

            const instance = yield* InstanceState.context
            const requested = path.isAbsolute(params.path ?? instance.directory)
              ? (params.path ?? instance.directory)
              : path.resolve(instance.directory, params.path ?? ".")
            const requestedInfo = yield* fs.stat(requested).pipe(Effect.catch(() => Effect.succeed(undefined)))
            yield* assertExternalDirectoryEffect(ctx, requested, {
              bypass: false,
              kind: requestedInfo?.type === "Directory" ? "directory" : "file",
            })

            const search = instance.remote ? path.posix.normalize(requested) : FSUtil.resolve(requested)
            const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const cwd = info?.type === "Directory" ? search : path.dirname(search)

            const found = instance.remote
              ? yield* Effect.scoped(
                  Effect.gen(function* () {
                    const connection = yield* remote.acquire(instance.remote!)
                    return yield* remoteGrep(connection, cwd, params.pattern, params.include, 100)
                  }),
                )
              : yield* Effect.gen(function* () {
                  const result = yield* ripgrep.grep({
                    cwd,
                    pattern: params.pattern,
                    include: params.include,
                    limit: 100,
                  })
                  return {
                    matches: result.map((item) => ({
                      path: path.resolve(cwd, item.entry.path),
                      line: item.line,
                      text: item.text,
                    })),
                    truncated: result.length === 100,
                  }
                })

            if (found.matches.length === 0) return empty
            const output = [
              `Found ${found.matches.length} matches${found.truncated ? " (more matches available)" : ""}`,
            ]
            let current = ""
            for (const match of found.matches) {
              if (current !== match.path) {
                if (current) output.push("")
                current = match.path
                output.push(`${match.path}:`)
              }
              output.push(`  Line ${match.line}: ${match.text}`)
            }
            if (found.truncated) output.push("", "(Results truncated. Consider using a more specific path or pattern.)")

            return {
              title: params.pattern,
              metadata: { matches: found.matches.length, truncated: found.truncated },
              output: output.join("\n"),
            }
          }),
          params.ctx_local === true,
        ).pipe(Effect.orDie),
    }
  }),
)
