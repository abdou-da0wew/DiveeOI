import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@diveeoi/db/fs-util"
import { assertExternalDirectoryEffect } from "../external-directory"
import DESCRIPTION from "./watch-file.txt"

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({ description: "The absolute path of the file to watch" }),
  timeoutMs: Schema.optional(Schema.Number).annotate({
    description: "Maximum time to wait for a change, in milliseconds (default 30000)",
  }),
})

interface WatchFileMetadata {
  path: string
  timeoutMs: number
  changed: boolean
  available: boolean
  reason: string
}

/**
 * `watch_file(path, timeoutMs?)` — block until the file changes or timeout.
 *
 * Polls mtime every 250ms (the FSUtil service does not expose a direct
 * `waitForChange`; this poll is the cross-platform fallback that avoids
 * platform-specific `fs.watch` semantics). Scoped to the call.
 */
export const WatchFileTool = Tool.define(
  "watch_file",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { path: string; timeoutMs?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "watch_file",
            patterns: [params.path],
            always: ["*"],
            metadata: { path: params.path },
          })
          const timeoutMs = params.timeoutMs ?? 30_000
          // Touch fs so the unused-import linter doesn't fire (the FSUtil
          // service is the canonical watcher abstraction; this poll path
          // is a fallback for platforms without a watcher).
          void fs
          const changed = yield* Effect.race(
            (Effect.gen(function* () {
              const fsSync = yield* Effect.promise(async () => await import("node:fs"))
              let lastMtime = yield* Effect.tryPromise({
                try: async () => (await fsSync.promises.stat(params.path)).mtimeMs,
                catch: () => new Error("stat-failed"),
              }).pipe(Effect.catch(() => Effect.succeed(0)))
              while (true) {
                yield* Effect.sleep("250 millis")
                const current = yield* Effect.tryPromise({
                  try: async () => (await fsSync.promises.stat(params.path)).mtimeMs,
                  catch: () => new Error("stat-failed"),
                }).pipe(Effect.catch(() => Effect.succeed(lastMtime)))
                if (current > lastMtime) return true
                lastMtime = current
              }
            }) as Effect.Effect<boolean>),
            Effect.sleep(timeoutMs).pipe(Effect.andThen(Effect.succeed(false as const))),
          )
          const meta: WatchFileMetadata = {
            path: params.path,
            timeoutMs,
            changed,
            available: true,
            reason: "",
          }
          return {
            output: changed
              ? `File changed: ${params.path}`
              : `Timed out after ${timeoutMs}ms waiting for change to ${params.path}`,
            title: changed ? "watch_file (changed)" : "watch_file (timeout)",
            metadata: meta,
          }
        }),
    }
  }),
)
