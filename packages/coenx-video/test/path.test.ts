import { describe, expect, it } from "bun:test"
import type { VideoComposition } from "../src/model/types"
import { validateComposition } from "../src/model/validate"
import { pathCommandsToSvgD, resolveClipPath, resolveNodePath } from "../src/render/path"
import { renderSceneSvg } from "../src/render/scene-svg"

const commands = [
  { type: "moveTo", point: [0, 20] },
  { type: "quadraticTo", control: [45, -8], to: [90, 20] },
  { type: "cubicTo", control1: [90, 42], control2: [0, 42], to: [0, 20] },
  { type: "close" },
] as const

function composition(): VideoComposition {
  return {
    version: 1,
    id: "path-test",
    title: "Vector path test",
    stage: { width: 160, height: 90, fps: 24 },
    scenes: [
      {
        id: "scene",
        durationFrames: 6,
        nodes: [
          {
            id: "curve",
            kind: "path",
            x: 80,
            y: 45,
            width: 90,
            height: 42,
            commands: [...commands],
            fill: {
              type: "linear",
              from: [0, 0.5],
              to: [1, 0.5],
              stops: [
                { offset: 0, color: "#ef4444" },
                { offset: 1, color: "#2563eb" },
              ],
            },
            stroke: "#ffffff",
            strokeWidth: 2,
            lineCap: "round",
            lineJoin: "round",
          },
        ],
      },
    ],
  }
}

describe("shared vector paths", () => {
  it("serializes path commands to centered SVG path data", () => {
    expect(pathCommandsToSvgD([...commands], 90, 42)).toBe("M -45 -1 Q 0 -29 45 -1 C 45 21 -45 21 -45 -1 Z")
  })

  it("validates bounded commands and path paint", () => {
    expect(() => validateComposition(composition())).not.toThrow()
    const invalid = composition()
    const invalidNode = invalid.scenes[0].nodes[0]
    if (invalidNode.kind !== "path") throw new Error("Path fixture is invalid")
    invalidNode.commands = [{ type: "lineTo", point: [10, 10] }, { type: "close" }]
    expect(() => validateComposition(invalid)).toThrow("must begin with moveTo")
  })

  it("renders vector curves into standard SVG frames", async () => {
    const value = composition()
    const svg = await renderSceneSvg(value, value.scenes[0], 0, { projectRoot: "/tmp" })
    expect(svg).toContain("<path d=")
    expect(svg).toContain(" Q ")
    expect(svg).toContain(" C ")
    expect(svg).toContain("url(#gradient-path-test-curve)")
  })

  it("resolves reusable path definitions into node-local geometry", () => {
    const value = composition()
    const scene = value.scenes[0]
    scene.pathDefinitions = [{ id: "organic", width: 90, height: 42, commands: [...commands], fillRule: "evenodd" }]
    const node = {
      id: "reused",
      kind: "path" as const,
      x: 80,
      y: 45,
      width: 180,
      height: 84,
      pathRef: "organic",
    }
    scene.nodes.push(node)
    const resolved = resolveNodePath(node, scene)
    expect(resolved.fillRule).toBe("evenodd")
    expect(resolved.commands[0]).toEqual({ type: "moveTo", point: [0, 40] })
    expect(resolved.commands[1]).toEqual({
      type: "quadraticTo",
      control: [90, -16],
      to: [180, 40],
    })
    expect(() => validateComposition(value)).not.toThrow()
  })

  it("renders a referenced clip path in standard SVG output", async () => {
    const value = composition()
    const scene = value.scenes[0]
    scene.pathDefinitions = [{ id: "organic", width: 90, height: 42, commands: [...commands] }]
    scene.clipPaths = [{ id: "organic-clip", pathId: "organic", fillRule: "evenodd" }]
    scene.nodes.push({
      id: "clipped-panel",
      kind: "rect",
      x: 80,
      y: 45,
      width: 180,
      height: 84,
      fill: "#16a34a",
      clipPathId: "organic-clip",
    })
    const clip = resolveClipPath(scene.nodes[1], scene)
    expect(clip?.fillRule).toBe("evenodd")
    expect(clip?.commands[1]).toEqual({
      type: "quadraticTo",
      control: [90, -16],
      to: [180, 40],
    })
    expect(() => validateComposition(value)).not.toThrow()
    const svg = await renderSceneSvg(value, scene, 0, { projectRoot: "/tmp" })
    expect(svg).toContain('<clipPath id="clip-scene-clipped-panel"')
    expect(svg).toContain('clip-path="url(#clip-scene-clipped-panel)"')
    expect(svg).toContain('clip-rule="evenodd"')
  })

  it("rejects missing and duplicate reusable path references", () => {
    const missing = composition()
    const missingPath = missing.scenes[0].nodes[0]
    if (missingPath.kind !== "path") throw new Error("Path fixture is invalid")
    missingPath.commands = undefined
    missingPath.pathRef = "missing"
    expect(() => validateComposition(missing)).toThrow("references missing path missing")

    const duplicate = composition()
    duplicate.scenes[0].pathDefinitions = [
      { id: "shared", width: 90, height: 42, commands: [...commands] },
      { id: "shared", width: 90, height: 42, commands: [...commands] },
    ]
    expect(() => validateComposition(duplicate)).toThrow("duplicate path definition shared")
  })

  it("rejects references to missing clip paths", () => {
    const missing = composition()
    missing.scenes[0].nodes[0].clipPathId = "missing"
    expect(() => validateComposition(missing)).toThrow("references missing clip path missing")
  })

  it("bounds total path commands before a renderer is started", () => {
    const value = composition()
    const commands = [
      { type: "moveTo" as const, point: [0, 0] as const },
      ...Array.from({ length: 255 }, (_, index) => ({
        type: "lineTo" as const,
        point: [index, index] as const,
      })),
    ]
    value.scenes[0].pathDefinitions = Array.from({ length: 65 }, (_, index) => ({
      id: `shape-${index}`,
      width: 256,
      height: 256,
      commands: [...commands],
    }))
    expect(() => validateComposition(value)).toThrow("too many path commands")
  })
})
