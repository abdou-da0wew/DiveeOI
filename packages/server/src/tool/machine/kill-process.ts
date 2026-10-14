import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { exec } from "./exec"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import DESCRIPTION from "./kill-process.txt"

export const Parameters = Schema.Struct({
  pid: Schema.Number.annotate({ description: "The process ID to terminate" }),
  signal: Schema.optional(Schema.String).annotate({
    description: "Signal to send (default 'TERM' on POSIX, ignored on Windows which always uses taskkill /F)",
  }),
})

interface KillProcessMetadata {
  pid: number
  platform: NodeJS.Platform
  available: boolean
  exitCode: number
  reason: string
  signal?: string
  error?: string
}

export const KillProcessTool = Tool.define(
  "kill_process",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pid: number; signal?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "kill_process",
            patterns: [String(params.pid)],
            always: [],
            metadata: { pid: params.pid, signal: params.signal ?? "TERM" },
          })

          if (process.platform === "win32") {
            const result = yield* exec(spawner, "taskkill", ["/PID", String(params.pid), "/T", "/F"], 5000)
            const meta: KillProcessMetadata = {
              pid: params.pid,
              platform: "win32",
              available: true,
              exitCode: result.exitCode,
              reason: result.stderr,
            }
            return {
              output:
                result.exitCode === 0
                  ? `Process ${params.pid} terminated.`
                  : `taskkill exited ${result.exitCode}: ${result.stderr || result.stdout}`,
              title: `kill ${params.pid}`,
              metadata: meta,
            }
          }
          try {
            process.kill(params.pid, (params.signal ?? "SIGTERM") as NodeJS.Signals)
            const meta: KillProcessMetadata = {
              pid: params.pid,
              signal: params.signal ?? "SIGTERM",
              platform: process.platform,
              available: true,
              exitCode: 0,
              reason: "",
            }
            return {
              output: `Signal ${params.signal ?? "SIGTERM"} sent to process ${params.pid}.`,
              title: `kill ${params.pid}`,
              metadata: meta,
            }
          } catch (err) {
            const meta: KillProcessMetadata = {
              pid: params.pid,
              error: (err as Error).message,
              platform: process.platform,
              available: true,
              exitCode: -1,
              reason: (err as Error).message,
            }
            return {
              output: `Failed to kill process ${params.pid}: ${(err as Error).message}`,
              title: `kill ${params.pid} (failed)`,
              metadata: meta,
            }
          }
        }),
    }
  }),
)
