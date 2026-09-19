import { spawn } from "node:child_process"
import { Effect } from "effect"

/**
 * In-process server restart: re-exec the current entrypoint as a detached
 * child, hand it the parent PID via env, respond to the HTTP request, then
 * exit. The child waits for the parent to release the listen port before
 * binding (see `waitForParentExit`), so no EADDRINUSE race.
 *
 * Works for `bun src/main.ts`, `node dist/main.js`, and compiled Bun binaries
 * alike: when argv[1] is a real script path it is passed through, otherwise
 * (compiled binary, argv[1] === execPath) only the user args are replayed.
 */

const REPLACE_PARENT_ENV = "DIVEEOI_REPLACE_PID"
const EXIT_DELAY_MS = 500
const PARENT_WAIT_TIMEOUT_MS = 15_000

const childArgs = (): string[] => {
  const script = process.argv[1]
  if (script && script !== process.execPath) return [script, ...process.argv.slice(2)]
  return process.argv.slice(2)
}

/** Spawn a replacement process and schedule this process's exit. Returns false if the spawn failed. */
export const restartProcess = (): Effect.Effect<boolean> =>
  Effect.sync(() => {
    try {
      const child = spawn(process.execPath, childArgs(), {
        detached: true,
        stdio: "inherit",
        env: { ...process.env, [REPLACE_PARENT_ENV]: String(process.pid) },
      })
      // Spawn failures surface asynchronously; swallow them so the scheduled
      // exit still runs and the endpoint's false result stays authoritative.
      child.on("error", () => {})
      child.unref()
    } catch {
      return false
    }
    setTimeout(() => process.exit(0), EXIT_DELAY_MS)
    return true
  })

/**
 * Called at the top of main.ts. When DIVEEOI_REPLACE_PID is set (we are the
 * spawned replacement), block until the old process is gone so the listen
 * port is free. The env var is consumed either way so it never leaks to
 * grandchildren.
 */
export const waitForParentExit = async (timeoutMs = PARENT_WAIT_TIMEOUT_MS): Promise<void> => {
  const raw = process.env[REPLACE_PARENT_ENV]
  if (!raw) return
  delete process.env[REPLACE_PARENT_ENV]
  const pid = Number(raw)
  if (!Number.isInteger(pid) || pid <= 0) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export * as ServerRestart from "./restart"
