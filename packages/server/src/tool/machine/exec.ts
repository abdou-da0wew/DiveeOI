// packages/server/src/tool/machine/exec.ts
// Shared exec helper for the machine tools (draft-10 P6).

import { Effect } from "effect"
import * as Duration from "effect/Duration"
import * as Stream from "effect/Stream"
import { ChildProcess, ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** The service value type yielded by `yield* ChildProcessSpawner`. */
type SpawnerService = InstanceType<typeof ChildProcessSpawnerNS.ChildProcessSpawner>

/**
 * Run a child process, capture stdout/stderr/exit, with a hard timeout.
 * Never throws — spawn failures and timeouts surface as `exitCode: -1`.
 *
 * The spawner is passed in by the caller. Each Tool.define resolves it via
 * `yield* ChildProcessSpawner` in its outer Effect.gen, then passes the
 * resolved service value to exec. This keeps the execute callback's Effect
 * R=never so Tool.define's type contract holds.
 */
export function exec(
  spawner: SpawnerService,
  command: string,
  args: string[],
  timeoutMs: number,
): Effect.Effect<ExecResult> {
  return Effect.scoped(
    Effect.gen(function* () {
      const cmd = ChildProcess.make(command, args, {
        cwd: process.cwd(),
        env: process.env,
        stdin: "ignore",
        detached: false,
      })
      const handle = yield* spawner.spawn(cmd).pipe(
        Effect.catch(() => Effect.fail(new Error(`spawn failed: ${command}`))),
      )
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      yield* Stream.runForEach(Stream.decodeText(handle.stdout), (s) =>
        Effect.sync(() => stdoutChunks.push(s)),
      ).pipe(Effect.catch(() => Effect.void), Effect.forkScoped)
      yield* Stream.runForEach(Stream.decodeText(handle.stderr), (s) =>
        Effect.sync(() => stderrChunks.push(s)),
      ).pipe(Effect.catch(() => Effect.void), Effect.forkScoped)
      const exitCode = yield* handle.exitCode.pipe(
        Effect.timeout(Duration.millis(timeoutMs)),
        Effect.catch(() =>
          handle.kill({ forceKillAfter: "100 millis" }).pipe(
            Effect.catch(() => Effect.void),
            Effect.andThen(Effect.succeed(-1 as number)),
          ),
        ),
        Effect.andThen((code) => Effect.succeed(typeof code === "number" ? code : -1)),
      )
      return {
        exitCode,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      }
    }),
  ).pipe(
    Effect.catch((err) =>
      Effect.succeed({
        exitCode: -1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
      }),
    ),
  ) as Effect.Effect<ExecResult>
}
