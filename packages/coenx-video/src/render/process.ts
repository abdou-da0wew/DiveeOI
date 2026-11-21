import { spawn, type ChildProcess } from "node:child_process"

export function runBuffer(
  command: string,
  args: string[],
  options: { input?: Uint8Array; maxOutputBytes?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env: options.env ?? process.env })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const limit = options.maxOutputBytes ?? 64 * 1024 * 1024
    let outputBytes = 0
    let errorBytes = 0
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      child.kill("SIGTERM")
      reject(error)
    }
    const abort = () => fail(new Error(`${command} was cancelled`))
    options.signal?.addEventListener("abort", abort, { once: true })
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > limit) return fail(new Error(`${command} exceeded the ${limit} byte output limit`))
      stdout.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorBytes >= 64 * 1024) return
      const remaining = 64 * 1024 - errorBytes
      stderr.push(chunk.subarray(0, remaining))
      errorBytes += Math.min(remaining, chunk.length)
    })
    child.once("error", fail)
    child.once("close", (code) => {
      options.signal?.removeEventListener("abort", abort)
      if (settled) return
      settled = true
      if (code !== 0)
        return reject(new Error(Buffer.concat(stderr).toString("utf8") || `${command} exited with code ${code}`))
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8") })
    })
    child.stdin.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") fail(error)
    })
    child.stdin.end(options.input)
  })
}

export function writeWithBackpressure(child: ChildProcess, chunk: Uint8Array) {
  return new Promise<void>((resolve, reject) => {
    const stdin = child.stdin
    if (!stdin || stdin.destroyed || !stdin.writable) return reject(new Error("Video encoder input is closed"))
    if (stdin.write(chunk)) return resolve()
    stdin.once("drain", resolve)
    stdin.once("error", reject)
  })
}

export function waitForExit(child: ChildProcess, stderr: Buffer[]) {
  return new Promise<void>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(Buffer.concat(stderr).toString("utf8") || `Video encoder exited with code ${code}`))
    })
  })
}
