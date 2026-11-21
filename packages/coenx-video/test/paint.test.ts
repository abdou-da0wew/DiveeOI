import { describe, expect, it } from "bun:test"
import type { VideoComposition } from "../src/model/types"
import { validateComposition } from "../src/model/validate"
import { cssPaint, svgPaint } from "../src/render/paint"
import { pathCommandsToSvgD } from "../src/render/path"
import { renderSceneSvg } from "../src/render/scene-svg"

const linear = {
  type: "linear" as const,
  from: [0, 0.5] as const,
  to: [1, 0.5] as const,
  stops: [
    { offset: 0, color: "#ef4444" },
    { offset: 1, color: "#2563eb", opacity: 0.75 },
  ],
}

const radial = {
  type: "radial" as const,
  center: [0.5, 0.5] as const,
  radius: 0.6,
  stops: [
    { offset: 0, color: "#ffffff" },
    { offset: 1, color: "#10b981" },
  ],
}

function composition(fill = linear): VideoComposition {
  return {
    version: 1,
    id: "gradient-test",
    title: "Gradient test",
    stage: { width: 320, height: 180, fps: 24 },
    scenes: [
      {
        id: "scene",
        durationFrames: 12,
        nodes: [
          { id: "panel", kind: "rect", x: 80, y: 90, width: 120, height: 100, fill },
          { id: "orb", kind: "ellipse", x: 230, y: 90, width: 90, height: 90, fill: radial },
          { id: "button", kind: "button", x: 160, y: 25, width: 100, height: 24, text: "Continue", fill: linear },
        ],
      },
    ],
  }
}

describe("shared gradient paints", () => {
  it("validates linear and radial gradients as shared composition paints", () => {
    expect(() => validateComposition(composition())).not.toThrow()
  })

  it("renders SVG gradient definitions for rects, ellipses and buttons", async () => {
    const value = composition()
    const svg = await renderSceneSvg(value, value.scenes[0], 0, { projectRoot: "/tmp" })
    expect(svg).toContain("<linearGradient")
    expect(svg).toContain("<radialGradient")
    expect(svg).toContain('stop-opacity="0.75"')
    expect(svg).toContain('fill="url(#gradient-gradient-test-panel)"')
    expect(svg).toContain('fill="url(#gradient-gradient-test-orb)"')
    expect(svg).toContain('fill="url(#gradient-gradient-test-button)"')
  })

  it("produces matching Canvas, CSS-overlay and standalone SVG paint forms", () => {
    expect(cssPaint(linear, "#000")).toContain("linear-gradient(")
    expect(cssPaint(radial, "#000")).toContain("radial-gradient(")
    expect(svgPaint(linear, "linear-fill", "none").value).toBe("url(#linear-fill)")
    expect(svgPaint(radial, "radial-fill", "none").definition).toContain("<radialGradient")
  })

  it("serializes bounded move, quadratic, cubic and close path commands", () => {
    const path = pathCommandsToSvgD(
      [
        { type: "moveTo", point: [0, 0] },
        { type: "quadraticTo", control: [50, 0], to: [100, 50] },
        { type: "cubicTo", control1: [80, 60], control2: [20, 60], to: [0, 50] },
        { type: "close" },
      ],
      100,
      50,
    )
    expect(path).toBe("M -50 -25 Q 0 -25 50 25 C 30 35 -30 35 -50 25 Z")
  })

  it("rejects path commands with missing move segments or invalid coordinates", () => {
    const invalid = composition()
    invalid.scenes[0].nodes.push({
      id: "bad-path",
      kind: "path",
      x: 40,
      y: 40,
      width: 40,
      height: 40,
      commands: [{ type: "lineTo", point: [10, Number.NaN] }],
    })
    expect(() => validateComposition(invalid)).toThrow("must begin with moveTo")
  })

  it("rejects unordered stops and invalid opacity before rendering", () => {
    const unordered = composition({
      ...linear,
      stops: [
        { offset: 0.8, color: "#ffffff" },
        { offset: 0.2, color: "#000000" },
      ],
    })
    expect(() => validateComposition(unordered)).toThrow("gradient stops must be ordered")
    const invalidOpacity = composition({
      ...linear,
      stops: [
        { offset: 0, color: "#ffffff", opacity: 2 },
        { offset: 1, color: "#000000" },
      ],
    })
    expect(() => validateComposition(invalidOpacity)).toThrow("opacity must be between 0 and 1")
  })
})
