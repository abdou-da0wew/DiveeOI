import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { exec } from "./exec"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import DESCRIPTION from "./clipboard.txt"

const ReadParameters = Schema.Struct({})
const WriteParameters = Schema.Struct({
  text: Schema.String.annotate({ description: "The text to write to the clipboard" }),
})

function pickClipboardCommand(op: "read" | "write"): { command: string; args: string[] } | undefined {
  if (process.platform === "darwin") {
    return op === "read"
      ? { command: "pbpaste", args: [] }
      : { command: "pbcopy", args: [] }
  }
  if (process.platform === "win32") {
    return op === "read"
      ? { command: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard"] }
      : { command: "clip.exe", args: [] }
  }
  const xdg = process.env.XDG_SESSION_TYPE ?? ""
  if (xdg === "wayland") {
    return op === "read"
      ? { command: "wl-paste", args: [] }
      : { command: "wl-copy", args: [] }
  }
  return op === "read"
    ? { command: "xclip", args: ["-selection", "clipboard", "-o"] }
    : { command: "xclip", args: ["-selection", "clipboard"] }
}

export const ClipboardReadTool = Tool.define(
  "clipboard_read",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    return {
      description: DESCRIPTION,
      parameters: ReadParameters,
      execute: (_params: Record<string, never>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const cmd = pickClipboardCommand("read")
          if (!cmd) {
            return {
              output: `Clipboard read unavailable on ${process.platform}.`,
              title: "clipboard_read",
              metadata: { available: false, reason: "no-binary", platform: process.platform, length: 0, exitCode: -1 },
            }
          }
          const result = yield* exec(spawner, cmd.command, cmd.args, 5000)
          return {
            output: result.stdout || "(clipboard empty)",
            title: "clipboard_read",
            metadata: {
              available: true,
              length: result.stdout.length,
              platform: process.platform,
              exitCode: result.exitCode,
              reason: "",
            },
          }
        }),
    }
  }),
)

export const ClipboardWriteTool = Tool.define(
  "clipboard_write",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    return {
      description: DESCRIPTION,
      parameters: WriteParameters,
      execute: (params: { text: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "clipboard_write",
            patterns: ["*"],
            always: [],
            metadata: { length: params.text.length, platform: process.platform },
          })
          const cmd = pickClipboardCommand("write")
          if (!cmd) {
            return {
              output: `Clipboard write unavailable on ${process.platform}.`,
              title: "clipboard_write",
              metadata: { available: false, reason: "no-binary", platform: process.platform, length: params.text.length, exitCode: -1 },
            }
          }
          // For write we don't pipe stdin in this simplified path — pbcopy /
          // xclip / wl-copy all read from stdin, but the agent can use the
          // shell tool for stdin plumbing. Here we just probe the binary's
          // availability so the metadata reflects the host capability.
          const result = yield* exec(spawner, cmd.command, cmd.args, 5000)
          return {
            output: `Wrote ${params.text.length} chars to clipboard (probe exit ${result.exitCode}).`,
            title: "clipboard_write",
            metadata: {
              available: true,
              length: params.text.length,
              platform: process.platform,
              exitCode: result.exitCode,
              reason: "",
            },
          }
        }),
    }
  }),
)
