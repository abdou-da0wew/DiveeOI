import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { PhysicsSettings } from "../model/types"
import type { PhysicsFrame } from "../physics/world"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function findNativeBinary() {
  const configured = process.env.COENX_VIDEO_NATIVE
  if (configured && existsSync(configured)) return configured
  const suffix = process.platform === "win32" ? ".exe" : ""
  const target = path.join(
    packageRoot,
    "native",
    "coenx-video-native",
    "target",
    "release",
    `coenx-video-native${suffix}`,
  )
  return existsSync(target) ? target : undefined
}

export async function simulateNativePhysics(
  settings: PhysicsSettings,
  steps: number,
  dt: number,
  signal?: AbortSignal,
) {
  const binary = findNativeBinary()
  if (!binary) return undefined

  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let bytes = 0
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes <= 32 * 1024 * 1024) stdout.push(chunk)
    else child.kill("SIGKILL")
  })
  child.stderr.on("data", (chunk: Buffer) => {
    if (Buffer.concat(stderr).length < 16_384) stderr.push(chunk)
  })
  const abort = () => child.kill("SIGTERM")
  signal?.addEventListener("abort", abort, { once: true })
  const close = new Promise<{ code: number | null }>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => resolve({ code }))
  })
  child.stdin.end(
    JSON.stringify({ op: "simulate", steps, dt, gravity: settings.gravity ?? [0, 980], bodies: settings.bodies }),
  )
  try {
    const result = await close
    if (signal?.aborted) throw new Error("Native physics simulation cancelled")
    if (result.code !== 0)
      throw new Error(Buffer.concat(stderr).toString("utf8") || `Native video sidecar exited with ${result.code}`)
    const payload = JSON.parse(Buffer.concat(stdout).toString("utf8")) as { frames?: PhysicsFrame[]; error?: string }
    if (payload.error) throw new Error(payload.error)
    if (!payload.frames || payload.frames.length !== steps + 1)
      throw new Error("Native physics sidecar returned an incomplete frame batch")
    return payload.frames
  } finally {
    signal?.removeEventListener("abort", abort)
  }
}
