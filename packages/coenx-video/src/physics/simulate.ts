import type { PhysicsSettings } from "../model/types"
import { simulateNativePhysics } from "../native/physics-client"
import { simulatePhysicsFallback, type PhysicsFrame } from "./world"

export interface PhysicsOptions {
  dt?: number
  preferNative?: boolean
  signal?: AbortSignal
}

export async function simulatePhysics(
  settings: PhysicsSettings,
  steps: number,
  options: PhysicsOptions = {},
): Promise<PhysicsFrame[]> {
  const dt = options.dt ?? 1 / 30
  if (steps < 0 || !Number.isInteger(steps) || steps > 36_000)
    throw new Error("Physics step count is outside the supported range")
  if (options.preferNative !== false) {
    try {
      const native = await simulateNativePhysics(settings, steps, dt, options.signal)
      if (native) return native
    } catch (error) {
      if (process.env.COENX_VIDEO_NATIVE_REQUIRED === "1") throw error
    }
  }
  return simulatePhysicsFallback(settings, steps, dt, options.signal)
}
