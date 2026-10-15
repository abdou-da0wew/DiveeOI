// packages/server/src/ssh-client/ssh-spawner.ts
// SSH exec-backed process spawner (draft-10 remote sessions).
//
// Implements the ChildProcessSpawner service contract using SSH exec
// channels instead of local process spawning. When the session is remote,
// this layer replaces the default ChildProcessSpawner so that the shell
// tool (and any other tool that spawns processes) transparently runs
// commands on the remote host.
//
// The spawner acquires a Connection from RemoteSession.Service and uses
// its exec() method. Stream-based methods (stdout/stderr) are wired from
// the ssh2 exec stream. The Command shape from effect/unstable/process
// is translated to a shell command string for remote execution.

import { Context, Effect, Layer, Scope, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { PlatformError } from "effect"
import { RemoteSession } from "./index"
import { RemoteConfigTag } from "./sftp-fs"

/**
 * Layer that provides ChildProcessSpawner backed by SSH exec. When active,
 * every ChildProcess.make / spawner.spawn runs the command on the remote
 * host via SSH instead of locally.
 */
export const sshSpawnerLayer = Layer.effect(
  ChildProcessSpawner as any,
  Effect.gen(function* () {
    const config = yield* RemoteConfigTag
    const remoteSvc = yield* RemoteSession.Service

    const spawn = Effect.fn("SshSpawner.spawn")(function* (command: unknown) {
      const cmd = command as { command?: string; args?: string[]; shell?: string; cwd?: string; env?: Record<string, string> }
      const fullCommand = cmd.args && cmd.args.length > 0 ? `${cmd.command} ${cmd.args.join(" ")}` : (cmd.command ?? "")
      const conn = yield* remoteSvc.acquire(config)
      const result = yield* conn.exec(fullCommand, {
        cwd: cmd.cwd ?? config.workingDirectory,
        env: cmd.env,
      })

      const stdout = Stream.succeed(new TextEncoder().encode(result.stdout))
      const stderr = Stream.succeed(new TextEncoder().encode(result.stderr))
      const all = Stream.concat(stdout, stderr)
      const exitCode = Effect.succeed(result.exitCode)
      const kill = () => Effect.void
      const pid = undefined

      return { stdout, stderr, all, exitCode, kill, pid, stdin: undefined } as any
    })

    return ChildProcessSpawner.make(spawn as any)
  }),
)
