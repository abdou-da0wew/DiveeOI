// Benchmark the live 2D physics world under a heat-chamber-like load:
// many small dynamic bodies + static walls, collisions constantly firing.
// Usage: bun scripts/bench-live-physics.ts
import { LivePhysicsWorld } from "../src/physics/live"
import type { PhysicsSettings } from "../src/model/types"

const W = 960
const H = 540
const MOLECULES = 40

function makeSettings(): PhysicsSettings {
  const bodies: PhysicsSettings["bodies"] = [
    // Static chamber walls (thick, mass 0).
    { nodeId: "wall-left", mass: 0, isStatic: true, size: [20, H], position: [10, H / 2], velocity: [0, 0] },
    { nodeId: "wall-right", mass: 0, isStatic: true, size: [20, H], position: [W - 10, H / 2], velocity: [0, 0] },
    { nodeId: "wall-top", mass: 0, isStatic: true, size: [W, 20], position: [W / 2, 10], velocity: [0, 0] },
    { nodeId: "floor", mass: 0, isStatic: true, size: [W, 20], position: [W / 2, H - 10], velocity: [0, 0] },
  ]
  // Packed dynamic molecules: dense enough that collisions fire every step.
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
const WARMUP = 60
const STEPS = 900 // 30 seconds of simulated time at 30fps

function run(): { msPerStep: number; events: number } {
  const world = new LivePhysicsWorld(makeSettings(), new Map())
  let events = 0
  for (let i = 0; i < WARMUP; i++) events += world.step(DT).length
  const started = performance.now()
  for (let i = 0; i < STEPS; i++) events += world.step(DT).length
  const elapsed = performance.now() - started
  return { msPerStep: elapsed / STEPS, events }
}

// Stabilize: run once to JIT-warm, then report the median of 5 runs.
void run()
const samples: number[] = []
let totalEvents = 0
for (let r = 0; r < 5; r++) {
  const result = run()
  samples.push(result.msPerStep)
  totalEvents = result.events
}
samples.sort((a, b) => a - b)
const median = samples[Math.floor(samples.length / 2)]
console.log(`bodies=44 dt=${DT.toFixed(4)} steps=${STEPS}`)
console.log(`median step time: ${median.toFixed(4)} ms  (30fps budget: 33.3 ms)`)
console.log(`collision events produced: ${totalEvents}`)
console.log(`samples: ${samples.map((s) => s.toFixed(3)).join(", ")}`)
