import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { exec } from "./exec"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import DESCRIPTION from "./screenshot.txt"

export const Parameters = Schema.Struct({})

interface ScreenshotMetadata {
  available: boolean
  reason: string
  platform: NodeJS.Platform
  bytes: number
  exitCode: number
  dataUrl?: string
}

function pickScreenshotCommand(outFile: string): { command: string; args: string[] } | undefined {
  if (process.platform === "darwin") return { command: "screencapture", args: ["-x", outFile] }
  if (process.platform === "win32") {
    return {
      command: "powershell",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $b.Save('${outFile}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose()`,
      ],
    }
  }
  const xdg = process.env.XDG_SESSION_TYPE ?? ""
  if (xdg === "wayland") return { command: "grim", args: [outFile] }
  return { command: "scrot", args: [outFile] }
}

export const ScreenshotTool = Tool.define(
  "screenshot",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_params: Record<string, never>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "screenshot",
            patterns: ["*"],
            always: [],
            metadata: { platform: process.platform },
          })
          const tmp = `/tmp/diveeoi-screenshot-${Date.now()}.png`
          const cmd = pickScreenshotCommand(tmp)
          if (!cmd) {
            const meta: ScreenshotMetadata = {
              available: false,
              reason: "no-binary",
              platform: process.platform,
              bytes: 0,
              exitCode: -1,
            }
            return {
              output: `Screenshot unavailable on ${process.platform}.`,
              title: "screenshot",
              metadata: meta,
            }
          }
          const result = yield* exec(spawner, cmd.command, cmd.args, 15000)
          if (result.exitCode !== 0) {
            const meta: ScreenshotMetadata = {
              available: true,
              exitCode: result.exitCode,
              platform: process.platform,
              bytes: 0,
              reason: result.stderr,
            }
            return {
              output: `Screenshot command exited ${result.exitCode} on ${process.platform}.`,
              title: "screenshot (failed)",
              metadata: meta,
            }
          }
          const buf = yield* Effect.tryPromise({
            try: async () => {
              const fs = await import("node:fs/promises")
              const b = await fs.readFile(tmp)
              await fs.unlink(tmp).catch(() => {})
              return b
            },
            catch: (err) => new Error(`failed to read screenshot file: ${(err as Error).message}`),
          }).pipe(Effect.catch(() => Effect.succeed(Buffer.from(""))))
          if (buf.length === 0) {
            const meta: ScreenshotMetadata = {
              available: true,
              exitCode: 0,
              platform: process.platform,
              bytes: 0,
              reason: "read-failed",
            }
            return {
              output: `Screenshot captured but file read failed.`,
              title: "screenshot (read failed)",
              metadata: meta,
            }
          }
          const base64 = buf.toString("base64")
          const meta: ScreenshotMetadata = {
            available: true,
            bytes: buf.length,
            platform: process.platform,
            exitCode: 0,
            reason: "",
            dataUrl: `data:image/png;base64,${base64}`,
          }
          return {
            output: `Screenshot captured (${Math.round(buf.length / 1024)} KB PNG, base64-encoded).`,
            title: "screenshot",
            metadata: meta,
          }
        }),
    }
  }),
)
