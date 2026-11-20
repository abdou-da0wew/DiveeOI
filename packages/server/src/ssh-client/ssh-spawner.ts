import { Effect, Stream, Sink } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { Connection } from "./index"

function quote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function commandLine(command: any): string {
  if (command?._tag === "PipedCommand") {
    return `${commandLine(command.left)} | ${commandLine(command.right)}`
  }
  const executable = [command.command, ...(command.args ?? [])].map((part: unknown) => quote(String(part))).join(" ")
  const options = command.options ?? {}
  const exports = Object.entries(options.env ?? {})
    .filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0]),
    )
    .map(([key, value]) => `export ${key}=${quote(value)}`)
  const prefix = [...(options.cwd ? [`cd -- ${quote(options.cwd)}`] : []), ...exports]
  return `${prefix.length ? `${prefix.join(" && ")} && ` : ""}${executable}`
}

export function makeSSHSpawner(connection: Connection) {
  const spawn = Effect.fn("SshSpawner.spawn")(function* (input: unknown) {
    const command = input as ChildProcess.StandardCommand
    const text = commandLine(command)
    const result = yield* connection.exec(text, {
      cwd: connection.config.workingDirectory,
      timeoutMs: 120_000,
    })
    const encoder = new TextEncoder()
    const stdout = Stream.succeed(encoder.encode(result.stdout))
    const stderr = Stream.succeed(encoder.encode(result.stderr))
    return {
      pid: ChildProcessSpawner.ProcessId(0),
      stdin: Sink.drain,
      stdout,
      stderr,
      all: Stream.merge(stdout, stderr),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      isRunning: Effect.succeed(false),
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.exitCode)),
      kill: () => Effect.void,
      unref: Effect.succeed(() => Effect.void),
    } as any
  })
  return ChildProcessSpawner.make(spawn as any)
}

/**
 * Compatibility layer for callers that provide a RemoteConfig service.
 * The session prompt uses makeSSHSpawner directly so it can share the SFTP
 * connection with the filesystem layer.
 */
export const sshSpawnerLayer = ChildProcessSpawner as any
