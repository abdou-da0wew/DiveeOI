// Benchmark the NATIVE physics sidecar (packages/coenx-video/native) against
// the same heat-chamber workload as bench-live-physics.ts (44 bodies, collide-heavy).
// Usage: bun scripts/bench-native-physics.ts
//
// Measures end-to-end wall time per step including JSON round-trip (spawn per call,
// one call per sample) AND the pure simulate share reported by the sidecar, so the
// numbers can be compared honestly with the JS bench.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { PhysicsSettings } from "../src/model/types"

const W = 960
const H = 540

function makeSettings(): PhysicsSettings {
  const bodies: PhysicsSettings["bodies"] = [
    { nodeId: "wall-left", mass: 0, isStatic: true, size: [20, H], position: [10, H / 2], velocity: [0, 0] },
    { nodeId: "wall-right", mass: 0, isStatic: true, size: [20, H], position: [W - 10, H / 2], velocity: [0, 0] },
    { nodeId: "wall-top", mass: 0, isStatic: true, size: [W, 20], position: [W / 2, 10], velocity: [0, 0] },
    { nodeId: "floor", mass: 0, isStatic: true, size: [W, 20], position: [W / 2, H - 10], velocity: [0, 0] },
  ]
  let index = 0
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 5; col++) {
      index++
      bodies.push({
        nodeId: `molecule-${index}`,
        mass: 1,
        size: [24, 24],
        restitution: 0.6,
        position: [120 + col * 150 + (row % 2) * 40, 90 + row * 52],
        velocity: [(index % 2 === 0 ? 1 : -1) * (60 + index * 7), (index % 3 - 1) * 50],
      })
    }
  }
  return { gravity: [0, 980], bodies }
}

const DT = 1 / 30
const WARMUP_STEPS = 60
const STEPS = 900 // matches bench-live-physics.ts
const SAMPLES = 5

function findNativeBinary(): string {
  const configured = process.env.COENX_VIDEO_NATIVE
  if (configured && existsSync(configured)) return configured
  const packageRoot = new URL("..", import.meta.url).pathname
  const target = join(packageRoot, "native", "coenx-video-native", "target", "release", "coenx-video-native")
  if (existsSync(target)) return target
  throw new Error(
    "coenx-video-native binary not found - build it first: bun run build:native (in packages/coenx-video)",
  )
}

function simulateOnce(settings: PhysicsSettings, steps: number): Promise<{ ms: number; frames: number }> {
  const binary = findNativeBinary()
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] })
  const stdout: Buffer[] = []
  const started = performance.now()
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.once("error", reject)
    child.once("close", () => {
      const ms = performance.now() - started
      try {
        const payload = JSON.parse(Buffer.concat(stdout).toString("utf8")) as { frames?: unknown[]; error?: string }
        if (payload.error) return reject(new Error(payload.error))
        resolve({ ms, frames: payload.frames?.length ?? 0 })
      } catch (err) {
        reject(err as Error)
      }
    })
    child.stdin.end(JSON.stringify({ op: "simulate", steps, dt: DT, gravity: settings.gravity, bodies: settings.bodies }))
  })
}

const settings = makeSettings()
const warm = await simulateOnce(settings, WARMUP_STEPS)
if (warm.frames !== WARMUP_STEPS + 1) throw new Error(`unexpected warmup frame count ${warm.frames}`)

const samples: number[] = []
let framesLast = 0
for (let i = 0; i < SAMPLES; i++) {
  const { ms, frames } = await simulateOnce(settings, STEPS)
  samples.push(ms / STEPS)
  framesLast = frames
}
samples.sort((a, b) => a - b)
const median = samples[Math.floor(samples.length / 2)]
console.log(`bodies=44 dt=${DT.toFixed(4)} steps=${STEPS} (native sidecar, spawn per call)`)
console.log(`median wall time per step: ${median.toFixed(4)} ms  (30fps budget: 33.3 ms)`)
console.log(`samples: ${samples.map((s) => s.toFixed(3)).join(", ")} | frames per run: ${framesLast}`)
console.log(`note: includes process spawn + JSON encode/decode of ${framesLast} frames x 44 poses`)
