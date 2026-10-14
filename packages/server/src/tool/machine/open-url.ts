import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { exec } from "./exec"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import DESCRIPTION from "./open-url.txt"

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to open in the default browser" }),
})

function pickOpenCommand(url: string): { command: string; args: string[] } | undefined {
  if (process.platform === "darwin") return { command: "open", args: [url] }
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] }
  return { command: "xdg-open", args: [url] }
}

export const OpenUrlTool = Tool.define(
  "open_url",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { url: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "open_url",
            patterns: [params.url],
            always: [],
            metadata: { url: params.url },
          })
          const cmd = pickOpenCommand(params.url)
          if (!cmd) {
            return {
              output: `open_url unavailable on ${process.platform}.`,
              title: "open_url",
              metadata: { available: false, reason: "no-binary", platform: process.platform, url: params.url, exitCode: -1 },
            }
          }
          const result = yield* exec(spawner, cmd.command, cmd.args, 5000)
          return {
            output:
              result.exitCode === 0
                ? `Opened ${params.url} in default browser.`
                : `Browser launch returned exit ${result.exitCode}.`,
            title: `open_url ${params.url}`,
            metadata: {
              url: params.url,
              exitCode: result.exitCode,
              platform: process.platform,
              available: true,
              reason: result.stderr,
            },
          }
        }),
    }
  }),
)
