import { describe, expect, it } from "bun:test"
import { selectRenderer } from "../src/planner"

describe("renderer selection planner (WP7)", () => {
  it("selects native Cairo for MP4 when the runtime is available", () => {
    const plan = selectRenderer({ target: "mp4", runtime: { nativeBinary: true, ffmpeg: true } })
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.plan.backend).toBe("native-cairo")
      expect(plan.plan.reasons[0]).toContain("selected")
      expect(plan.plan.fallback).toBeUndefined()
    }
  })

  it("falls back to static SVG when the native binary is missing", () => {
    const plan = selectRenderer({ target: "mp4", runtime: { nativeBinary: false, ffmpeg: true } })
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.plan.backend).toBe("static-svg")
      expect(plan.plan.fallback).toMatchObject({ from: "native-cairo" })
      expect(plan.plan.reasons.join(" ")).toContain("missing runtime")
    }
  })

  it("respects an explicit preference and records the fallback reason", () => {
    const plan = selectRenderer({ target: "mp4", preference: "static-svg", runtime: { nativeBinary: true, ffmpeg: true } })
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.plan.backend).toBe("static-svg")
  })

  it("routes interactive targets to the browser backends", () => {
    const plan = selectRenderer({ target: "interactive", requiredFeatures: ["interactions"] })
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.plan.backend).toBe("interactive-canvas")
  })

  it("fails with feature ids when no backend can satisfy the request", () => {
    const plan = selectRenderer({ target: "mp4", requiredFeatures: ["gpu-3d"], runtime: { nativeBinary: true, ffmpeg: true } })
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.missingFeatures).toContain("gpu-3d")
      expect(plan.plan.reasons.join(" ")).toContain("gpu-3d")
      expect(plan.plan.featureSupport["gpu-3d"]["static-svg"]).toBe("unsupported")
    }
  })

  it("reports partial capability backends instead of pretending parity", () => {
    const plan = selectRenderer({ target: "mp4", requiredFeatures: ["linear-gradients"], runtime: { nativeBinary: true, ffmpeg: true } })
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.plan.backend).toBe("native-cairo")
  })
})
