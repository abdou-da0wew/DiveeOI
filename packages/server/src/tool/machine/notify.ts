import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { exec } from "./exec"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import DESCRIPTION from "./notify.txt"

export const Parameters = Schema.Struct({
  title: Schema.String.annotate({ description: "Short title for the notification" }),
  body: Schema.String.annotate({ description: "Body text of the notification" }),
})

function pickNotifyCommand(title: string, body: string): { command: string; args: string[] } | undefined {
  if (process.platform === "darwin") {
    return {
      command: "osascript",
      args: ["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`],
    }
  }
  if (process.platform === "win32") {
    return {
      command: "powershell",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(${JSON.stringify(body)}, ${JSON.stringify(title)}) | Out-Null`,
      ],
    }
  }
  return { command: "notify-send", args: [title, body] }
}

export const NotifyTool = Tool.define(
  "notify",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { title: string; body: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const cmd = pickNotifyCommand(params.title, params.body)
          if (!cmd) {
            return {
              output: `Notification not sent: no notify binary available on ${process.platform}.`,
              title: params.title,
              metadata: { available: false, reason: "no-binary", platform: process.platform, delivered: false, exitCode: -1 },
            }
          }
          const result = yield* exec(spawner, cmd.command, cmd.args, 5000)
          const ok = result.exitCode === 0
          return {
            output: ok
              ? `Notification sent: ${params.title}`
              : `Notification may not have been delivered (exit ${result.exitCode}).`,
            title: params.title,
            metadata: { available: true, delivered: ok, platform: process.platform, exitCode: result.exitCode, reason: result.stderr },
          }
        }),
    }
  }),
)
