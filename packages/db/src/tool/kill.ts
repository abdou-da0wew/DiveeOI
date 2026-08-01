export * as KillTool from "./kill"

import { ToolFailure } from "@diveeoi/llm"
import { Duration, Effect, Layer, Schema } from "effect"
import { AppProcess } from "../process"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { PositiveInt } from "../schema"
import { ChildProcess } from "effect/unstable/process"

export const name = "kill"

export const Input = Schema.Struct({
  pid: Schema.Number.pipe(Schema.optional).annotate({
    description: "Process ID to kill. Specify either pid OR name/pattern. If both given, pid takes precedence.",
  }),
  name: Schema.String.pipe(Schema.optional).annotate({
    description: "Process name to match (e.g., 'node', 'chrome', 'python'). Matches against executable name.",
  }),
  pattern: Schema.String.pipe(Schema.optional).annotate({
    description: "Full command-line pattern to match (e.g., 'npm run dev', 'my-server --port 3000'). Matches against full command line.",
  }),
  signal: Schema.Literals(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP", "SIGUSR1", "SIGUSR2", "CTRL_C_EVENT", "CTRL_BREAK_EVENT"]).pipe(Schema.optional).annotate({
    description: "Signal to send. Default: SIGTERM (graceful) on POSIX, CTRL_C_EVENT on Windows. Use SIGKILL/CTRL_BREAK_EVENT for force.",
  }),
  force: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "If true, sends SIGKILL/TerminateProcess after timeout. If false and process doesn't exit gracefully, returns failure.",
  }),
  timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Timeout in ms before force kill (default: 5000). Only applies if force=true.",
  }),
  all: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "If true with name/pattern, kills ALL matching processes. If false (default), kills first match only.",
  }),
})

export const Output = Schema.Struct({
  killed: Schema.Array(
    Schema.Struct({
      pid: Schema.Number,
      name: Schema.String,
      signal: Schema.String,
      success: Schema.Boolean,
      error: Schema.String.pipe(Schema.optional),
    }),
  ),
  totalMatched: Schema.Number,
  totalKilled: Schema.Number,
})

type Output = typeof Output.Type

const defaultTimeout = 5000
const defaultSignal = process.platform === "win32" ? "CTRL_C_EVENT" : "SIGTERM"

const getSignalNumber = (signal: string): number => {
  if (process.platform === "win32") {
    switch (signal) {
      case "CTRL_C_EVENT":
        return 0
      case "CTRL_BREAK_EVENT":
        return 1
      default:
        return 1
    }
  }
  const signals: Record<string, number> = {
    SIGTERM: 15,
    SIGKILL: 9,
    SIGINT: 2,
    SIGHUP: 1,
    SIGUSR1: 10,
    SIGUSR2: 12,
  }
  return signals[signal] ?? 15
}

const findProcesses = (appProcess: AppProcess.Interface, input: typeof Input.Type): Effect.Effect<Array<{ pid: number; name: string; cmd: string }>, AppProcess.AppProcessError> =>
  Effect.gen(function* () {
    if (input.pid) {
      try {
        const cmd = process.platform === "win32"
          ? ChildProcess.make("tasklist", ["/FI", `PID eq ${input.pid}`, "/FO", "CSV"], { shell: false })
          : ChildProcess.make("ps", ["-p", String(input.pid), "-o", "pid,comm,args"], { shell: false })
        const proc = yield* appProcess.run(cmd)
        if (proc.exitCode === 0 && proc.stdout.toString().includes(String(input.pid))) {
          return [{ pid: input.pid, name: "unknown", cmd: "" }]
        }
        return []
      } catch {
        return []
      }
    }

    if (process.platform === "win32") {
      let cmd = "tasklist"
      const args = ["/FO", "CSV"]
      if (input.name) {
        args.push("/FI", `IMAGENAME eq ${input.name}*`)
      }
      const proc = yield* appProcess.run(ChildProcess.make(cmd, args, { shell: false }))
      if (proc.exitCode !== 0) return []

      const lines = proc.stdout.toString().trim().split("\n").slice(1)
      const results = []
      for (const line of lines) {
        const match = line.match(/"([^"]+)","(\d+)"/)
        if (match) {
          const name = match[1]
          const pid = parseInt(match[2], 10)
          if (!isNaN(pid)) results.push({ pid, name, cmd: "" })
        }
      }
      return results
    }

    try {
      let args: string[]
      if (input.pattern) {
        args = ["-f", input.pattern]
      } else if (input.name) {
        args = [input.name]
      } else {
        return []
      }
      const proc = yield* appProcess.run(ChildProcess.make("pgrep", ["-a", ...args], { shell: false }))
      if (proc.exitCode !== 0) return []

      const results = []
      for (const line of proc.stdout.toString().trim().split("\n")) {
        const [pidStr, ...cmdParts] = line.split(" ")
        const pid = parseInt(pidStr, 10)
        if (!isNaN(pid)) {
          results.push({ pid, name: cmdParts[0]?.split("/").pop() || "unknown", cmd: cmdParts.join(" ") })
        }
      }
      return results
    } catch {
      return []
    }
  })

const killProcess = (appProcess: AppProcess.Interface, pid: number, signal: string, force: boolean, timeout: number): Effect.Effect<{ pid: number; success: boolean; error?: string }, AppProcess.AppProcessError> =>
  Effect.gen(function* () {
    const sigNum = getSignalNumber(signal)

    if (process.platform === "win32") {
      const args = ["/PID", String(pid)]
      if (signal === "CTRL_C_EVENT" || signal === "CTRL_BREAK_EVENT") {
        args.push("/T")
      } else {
        args.push("/F")
      }

      const proc = yield* appProcess.run(ChildProcess.make("taskkill", args, { shell: false }))
      if (proc.exitCode === 0) {
        return { pid, success: true }
      }
      return { pid, success: false, error: proc.stderr.toString() || "Unknown error" }
    }

    const killCmd = ChildProcess.make("kill", ["-" + sigNum, String(pid)], { shell: false })
    const result = yield* appProcess.run(killCmd, { timeout: Duration.millis(timeout) }).pipe(
      Effect.catch(() => Effect.succeed({ exitCode: -1, stdout: new Uint8Array(), stderr: new Uint8Array() })),
    )

    if (result.exitCode === 0) {
      return { pid, success: true }
    }

    if (force && signal !== "SIGKILL") {
      const forceResult = yield* appProcess.run(
        ChildProcess.make("kill", ["-9", String(pid)], { shell: false }),
        { timeout: Duration.millis(1000) },
      ).pipe(
        Effect.catch(() => Effect.succeed({ exitCode: -1, stdout: new Uint8Array(), stderr: new Uint8Array() })),
      )
      if (forceResult.exitCode === 0) {
        return { pid, success: true }
      }
    }

    return { pid, success: false, error: "Failed to send signal" }
  })

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const appProcess = yield* AppProcess.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "CROSS-PLATFORM PROCESS KILLER - Linux/macOS/Windows. Kill processes by PID, name, or command pattern.\n\n" +
            "WORKS ON: Linux (kill), macOS (kill), Windows (taskkill).\n\n" +
            "PERMISSION: Requires user approval via UI prompt (respects 'Auto-Accept Permissions' setting).\n\n" +
            "USAGE EXAMPLES:\n" +
            "- Kill by PID: pid=12345\n" +
            "- Kill all node processes: name='node', all=true\n" +
            "- Kill 'npm run dev': pattern='npm run dev', all=true\n" +
            "- Graceful shutdown (default): signal='SIGTERM' (POSIX) or 'CTRL_C_EVENT' (Windows)\n" +
            "- Force kill: signal='SIGKILL' or force=true (sends SIGKILL/TerminateProcess after timeout)\n\n" +
            "SIGNALS (POSIX): SIGTERM=15 (graceful), SIGKILL=9 (force), SIGINT=2 (interrupt)\n" +
            "SIGNALS (Windows): CTRL_C_EVENT (Ctrl+C), CTRL_BREAK_EVENT (Ctrl+Break), /F (TerminateProcess)\n\n" +
            "BEST PRACTICES:\n" +
            "1. Always try graceful (SIGTERM) first\n" +
            "2. Use force=true with timeout for stubborn processes\n" +
            "3. Use all=true with name/pattern to kill process trees\n" +
            "4. Check 'killed' output for success/failure per PID",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: output.killed.map((k) => (k.success ? `✓ ${k.pid}` : `✗ ${k.pid}: ${k.error}`)).join("\n") + ` (${output.totalKilled}/${output.totalMatched})`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }

              yield* permission.assert({
                action: name,
                resources: [input.pid ? `pid:${input.pid}` : input.name ? `name:${input.name}` : `pattern:${input.pattern}`],
                save: ["*"],
                metadata: {
                  pid: input.pid,
                  name: input.name,
                  pattern: input.pattern,
                  signal: input.signal ?? defaultSignal,
                  force: input.force ?? false,
                  all: input.all ?? false,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })

              const signal = input.signal ?? defaultSignal
              const force = input.force ?? false
              const timeout = input.timeout ?? defaultTimeout
              const killAll = input.all ?? false

              const processes = yield* findProcesses(appProcess, input)
              if (processes.length === 0) {
                return {
                  killed: [],
                  totalMatched: 0,
                  totalKilled: 0,
                }
              }

              const targets = killAll ? processes : [processes[0]]

              const results = yield* Effect.all(
                targets.map((p) =>
                  killProcess(appProcess, p.pid, signal, force, timeout).pipe(
                    Effect.map((r) => ({ ...r, name: p.name, signal })),
                  ),
                ),
                { concurrency: "unbounded" },
              )

              const successful = results.filter((r) => r.success).length

              return {
                killed: results,
                totalMatched: targets.length,
                totalKilled: successful,
              }
            }).pipe(Effect.catch(() => new ToolFailure({ message: "Failed to kill process" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)