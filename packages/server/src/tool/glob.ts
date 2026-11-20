import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@diveeoi/db/fs-util"
import { Ripgrep } from "@diveeoi/db/ripgrep"
import { RemoteSession } from "@/ssh-client"
import { glob as remoteGlob } from "@/ssh-client/remote-search"
import { assertExternalDirectoryEffect } from "./external-directory"
import { withLocalToolContext } from "./remote-local-context"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. Omit this field to use the current working directory.",
  }),
  ctx_local: Schema.optional(Schema.Boolean).annotate({
    description:
      "Remote sessions: when true, search the LOCAL machine instead of the remote SSH host. Defaults to false (remote).",
  }),
})

export const GlobTool = Tool.define(
  "glob",
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
            const instance = yield* InstanceState.context
            yield* ctx.ask({
              permission: "glob",
              patterns: [params.pattern],
              always: ["*"],
              metadata: { pattern: params.pattern, path: params.path },
            })

            let search = params.path ?? instance.directory
            search = path.isAbsolute(search) ? search : path.resolve(instance.directory, search)
            const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (info?.type === "File") throw new Error(`glob path must be a directory: ${search}`)
            yield* assertExternalDirectoryEffect(ctx, search, {
              bypass: false,
              kind: "directory",
            })

            const files = instance.remote
              ? yield* Effect.scoped(
                  Effect.gen(function* () {
                    const connection = yield* remote.acquire(instance.remote!)
                    return yield* remoteGlob(connection, search, params.pattern, 100)
                  }),
                )
              : yield* Effect.gen(function* () {
                  const result = yield* ripgrep.glob({ cwd: search, pattern: params.pattern, limit: 100 })
                  return {
                    paths: result.map((file) => path.resolve(search, file.path)),
                    truncated: result.length === 100,
                  }
                })

            const output = files.paths.length ? [...files.paths] : ["No files found"]
            if (files.truncated) {
              output.push("", "(Results are truncated: showing the first 100 results. Use a more specific pattern.)")
            }
            return {
              title: path.relative(instance.worktree, search),
              metadata: { count: files.paths.length, truncated: files.truncated },
              output: output.join("\n"),
            }
          }),
          params.ctx_local === true,
        ).pipe(Effect.orDie),
    }
  }),
)
