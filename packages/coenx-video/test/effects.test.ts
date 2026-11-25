import { describe, expect, it } from "bun:test"
import { EFFECT_BUDGETS, effectSurfacePixels } from "../src/model/validate-effects"
import { validateComposition } from "../src/model/validate"
import type { NodeEffect, Scene, VideoComposition } from "../src/model/types"
import { parseFilterAttribute, canvasFilterValue, colorAdjustMatrix, effectPrimitives, effectPadding, nativeEffectsPayload, svgFilterDefinition } from "../src/render/effects"
import { compileCmlProject } from "../src/format/compiler"
import { renderSceneSvg } from "../src/render/scene-svg"
import { COENX_VIDEO_CAPABILITIES } from "../src/capabilities"
import { referenceSection, referenceTopics } from "../src/reference"

function composition(effects?: NodeEffect[], nodes?: Scene["nodes"]): VideoComposition {
  return {
    version: 1,
    id: "effect-test",
    title: "Effect test",
    stage: { width: 160, height: 90, fps: 6, background: "#0b1220" },
    scenes: [
      {
        id: "intro",
        durationFrames: 6,
        background: "#0b1220",
        nodes: nodes ?? [
          {
            id: "glow",
            kind: "rect",
            x: 80,
            y: 45,
            width: 120,
            height: 60,
            fill: "#ff0000",
            ...(effects ? { effects } : {}),
          },
        ],
      },
    ],
  }
}

const validChain: NodeEffect[] = [
  { type: "blur", radius: 6 },
  { type: "drop-shadow", dx: 4, dy: 8, radius: 3, color: "#000000" },
  { type: "color-adjust", brightness: 1.1, saturate: 1.2 },
]

describe("effect model validation", () => {
  it("accepts a valid bounded chain", () => {
    const summary = validateComposition(composition(validChain))
    expect(summary.nodeCount).toBe(1)
  })

  it("accepts compositions without effects", () => {
    expect(() => validateComposition(composition())).not.toThrow()
  })

  it("rejects blur radii beyond the budget", () => {
    expect(() => validateComposition(composition([{ type: "blur", radius: EFFECT_BUDGETS.maxBlurRadius + 1 }]))).toThrow(
      /blur radius must be between 0 and 64/,
    )
  })

  it("rejects drop-shadow offsets and colors beyond the budget", () => {
    expect(() =>
      validateComposition(composition([{ type: "drop-shadow", dx: EFFECT_BUDGETS.maxShadowOffset + 1, dy: 0, radius: 2 }])),
    ).toThrow(/dx must be within/)
    expect(() =>
      validateComposition(composition([{ type: "drop-shadow", dx: 0, dy: 0, radius: EFFECT_BUDGETS.maxShadowRadius + 1 }])),
    ).toThrow(/drop-shadow radius must be between 0 and 32/)
    expect(() =>
      validateComposition(composition([{ type: "drop-shadow", dx: 0, dy: 0, radius: 2, color: "#12g" as string } as unknown as NodeEffect])),
    ).toThrow(/drop-shadow color must be/)
  })

  it("rejects color-adjust amounts beyond the budget", () => {
    expect(() => validateComposition(composition([{ type: "color-adjust", brightness: EFFECT_BUDGETS.maxBrightness + 1 }]))).toThrow(
      /brightness must be between 0 and 4/,
    )
    expect(() => validateComposition(composition([{ type: "color-adjust" }]))).toThrow(/must set at least one/)
    expect(() => validateComposition(composition([{ type: "color-adjust", hueRotate: 400 }]))).toThrow(/hueRotate must be within/)
  })

  it("rejects chains beyond the depth budget and unknown effect types", () => {
    expect(() => validateComposition(composition(Array.from({ length: EFFECT_BUDGETS.maxEffectsPerNode + 1 }, () => ({ type: "blur", radius: 1 }))))).toThrow(
      /4-effect chain budget/,
    )
    expect(() => validateComposition(composition([{ type: "displacement" } as unknown as NodeEffect]))).toThrow(/unsupported effect type/)
  })

  it("rejects effects on mesh3d nodes", () => {
    const mesh: Scene["nodes"] = [
      {
        id: "mesh",
        kind: "mesh3d",
        x: 80,
        y: 45,
        width: 100,
        height: 100,
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        triangles: [[0, 1, 2]],
        effects: [{ type: "blur", radius: 2 }],
      },
    ]
    expect(() => validateComposition(composition(undefined, mesh))).toThrow(/cannot carry filter effects/)
  })

  it("rejects chains whose padded surface exceeds the pixel budget", () => {
    const huge: Scene["nodes"] = [
      {
        id: "huge",
        kind: "rect",
        x: 80,
        y: 45,
        width: 4000,
        height: 3000,
        fill: "#ff0000",
        effects: [{ type: "blur", radius: EFFECT_BUDGETS.maxBlurRadius }, { type: "drop-shadow", dx: EFFECT_BUDGETS.maxShadowOffset, dy: EFFECT_BUDGETS.maxShadowOffset, radius: 2 }],
      },
    ]
    const pad = effectPadding([{ type: "blur", radius: EFFECT_BUDGETS.maxBlurRadius }, { type: "drop-shadow", dx: EFFECT_BUDGETS.maxShadowOffset, dy: EFFECT_BUDGETS.maxShadowOffset, radius: 2 }])
    expect(pad).toBe(Math.ceil(EFFECT_BUDGETS.maxBlurRadius * 3) + EFFECT_BUDGETS.maxShadowOffset)
    expect(effectSurfacePixels(2400, 1400, validChain)).toBeGreaterThan(0)
    expect(effectSurfacePixels(4000, 3000, huge[0]!.effects!)).toBeGreaterThan(EFFECT_BUDGETS.maxEffectSurfacePixels)
    expect(() => validateComposition(composition(undefined, huge))).toThrow(/pixel temporary surface budget/)
  })
})

describe("filter attribute parsing", () => {
  it("parses every supported function", () => {
    expect(parseFilterAttribute("blur(4)")).toEqual([{ type: "blur", radius: 4 }])
    expect(parseFilterAttribute("drop-shadow(2 3 4 #12345678)")).toEqual([
      { type: "drop-shadow", dx: 2, dy: 3, radius: 4, color: "#12345678" },
    ])
    expect(parseFilterAttribute("brightness(1.2) contrast(0.8)")).toEqual([
      { type: "color-adjust", brightness: 1.2 },
      { type: "color-adjust", contrast: 0.8 },
    ])
    expect(parseFilterAttribute("saturate(1.5) hue-rotate(30)")).toEqual([
      { type: "color-adjust", saturate: 1.5 },
      { type: "color-adjust", hueRotate: 30 },
    ])
  })

  it("rejects unknown functions, malformed arguments and trailing text", () => {
    expect(() => parseFilterAttribute("displacement(4)")).toThrow(/unsupported filter function/)
    expect(() => parseFilterAttribute("blur()")).toThrow(/takes exactly one radius/)
    expect(() => parseFilterAttribute("blur(4) oops")).toThrow(/unexpected text/)
    expect(() => parseFilterAttribute("")).toThrow(/at least one effect/)
  })
})

describe("CML filter authoring", () => {
  it("compiles a filter attribute into node effects", () => {
    const source = `<coenx width="160" height="90" fps="6"><scene id="intro" frames="6">
  <rect id="glow" x="20" y="15" width="120" height="60" fill="#ff0000" filter="blur(4) drop-shadow(2 4 3 #000000)"/>
</scene></coenx>`
    const value = compileCmlProject({ markup: source })
    expect(value.scenes[0]!.nodes[0]).toMatchObject({
      id: "glow",
      effects: [{ type: "blur", radius: 4 }, { type: "drop-shadow", dx: 2, dy: 4, radius: 3, color: "#000000" }],
    })
    expect(() => validateComposition(value)).not.toThrow()
  })

  it("reports malformed filter attributes with a repair hint and location", () => {
    const source = `<coenx width="160" height="90" fps="6"><scene id="intro" frames="6">
  <rect id="glow" x="20" y="15" width="120" height="60" fill="#ff0000" filter="wiggle(4)"/>
</scene></coenx>`
    expect(() => compileCmlProject({ markup: source })).toThrow(/filter attribute.*unsupported filter function wiggle.*line 2/)
  })

  it("accepts filter attributes through CSS style rules too", () => {
    const source = `<coenx width="160" height="90" fps="6"><scene id="intro" frames="6">
  <rect id="glow" x="20" y="15" width="120" height="60" fill="#ff0000"/>
</scene></coenx>`
    const value = compileCmlProject({ markup: source, styles: "rect { filter: brightness(1.5); }" })
    expect(value.scenes[0]!.nodes[0]).toMatchObject({ effects: [{ type: "color-adjust", brightness: 1.5 }] })
  })
})

describe("SVG filter output", () => {
  it("emits a scoped filter definition and reference", async () => {
    const value = composition(validChain)
    const svg = await renderSceneSvg(value, value.scenes[0]!, 0, { projectRoot: "/tmp" })
    expect(svg).toContain('<filter id="filter-intro-glow" filterUnits="userSpaceOnUse"')
    expect(svg).toContain('<feGaussianBlur stdDeviation="6"/>')
    expect(svg).toContain('<feDropShadow dx="4" dy="8" stdDeviation="3" flood-color="#000000" flood-opacity="1"/>')
    expect(svg).toContain('filter="url(#filter-intro-glow)"')
    // The region must be padded by 3 sigmas of blur plus the shadow offsets.
    const pad = effectPadding(validChain)
    expect(svg).toContain(`x="${-60 - pad}" y="${-30 - pad}" width="${120 + pad * 2}" height="${60 + pad * 2}"`)
    expect(svg).toContain("<feColorMatrix")
  })

  it("deduplicates identical effect chains across nodes", async () => {
    const value = composition(validChain, [
      { id: "a", kind: "rect", x: 40, y: 30, width: 120, height: 60, fill: "#ff0000", effects: validChain },
      { id: "b", kind: "rect", x: 120, y: 30, width: 120, height: 60, fill: "#00ff00", effects: validChain },
    ])
    const svg = await renderSceneSvg(value, value.scenes[0]!, 0, { projectRoot: "/tmp" })
    expect(svg.match(/<filter id="filter-intro-a"/g)?.length).toBe(1)
    expect(svg).not.toContain('<filter id="filter-intro-b"')
    expect(svg.match(/filter="url\(#filter-intro-a\)"/g)?.length).toBe(2)
  })

  it("deduplicates reusable clip definitions for identical node dimensions (WP1 follow-up)", async () => {
    const value = composition(undefined, [
      { id: "a", kind: "rect", x: 40, y: 30, width: 120, height: 60, fill: "#ff0000", clipPathId: "frame" },
      { id: "b", kind: "rect", x: 120, y: 30, width: 120, height: 60, fill: "#00ff00", clipPathId: "frame" },
    ] as Scene["nodes"])
    value.scenes[0]!.pathDefinitions = [{ id: "box", width: 120, height: 60, commands: [{ type: "moveTo", point: [0, 0] }, { type: "lineTo", point: [120, 0] }, { type: "lineTo", point: [120, 60] }, { type: "lineTo", point: [0, 60] }, { type: "close" }] }]
    value.scenes[0]!.clipPaths = [{ id: "frame", pathId: "box" }]
    const svg = await renderSceneSvg(value, value.scenes[0]!, 0, { projectRoot: "/tmp" })
    expect(svg.match(/<clipPath id="clip-intro-frame"/g)?.length).toBe(1)
    expect(svg.match(/clip-path="url\(#clip-intro-frame\)"/g)?.length).toBe(2)
  })
})

describe("backend effect helpers", () => {
  it("builds the CSS filter chain for Canvas", () => {
    expect(canvasFilterValue(validChain)).toBe(
      "blur(6px) drop-shadow(4px 8px 3px rgba(0, 0, 0, 1)) brightness(1.1) saturate(1.2)",
    )
    expect(canvasFilterValue([{ type: "drop-shadow", dx: 0, dy: 6, radius: 2, color: "#00000080" }])).toBe(
      "drop-shadow(0px 6px 2px rgba(0, 0, 0, 0.5019607843137255))",
    )
    expect(canvasFilterValue(undefined)).toBe("")
  })

  it("serializes a normalized native payload", () => {
    expect(nativeEffectsPayload(validChain)).toEqual([
      { type: "blur", radius: 6 },
      { type: "drop-shadow", dx: 4, dy: 8, radius: 3, color: "#000000" },
      { type: "color-adjust", brightness: 1.1, contrast: undefined, saturate: 1.2, hueRotate: undefined },
    ])
    expect(nativeEffectsPayload(undefined)).toBeUndefined()
  })

  it("combines color-adjust sub-operations in CSS order", () => {
    const matrix = colorAdjustMatrix({ type: "color-adjust", brightness: 1, contrast: 1 })
    expect(matrix).toBeDefined()
    // Identity brightness/contrast must produce the identity matrix rows plus alpha.
    expect(matrix).toBe("1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0")
    const brightness = colorAdjustMatrix({ type: "color-adjust", brightness: 2 })
    expect(brightness?.split(" ").slice(0, 3)).toEqual(["2", "0", "0"])
  })

  it("orders SVG primitives exactly like the chain", () => {
    const primitives = effectPrimitives(validChain).map((primitive) => primitive.tag)
    expect(primitives).toEqual(["feGaussianBlur", "feDropShadow", "feColorMatrix"])
    expect(svgFilterDefinition(validChain, "f", 120, 60, 30)).toContain('id="f"')
  })
})

describe("effects capability and reference surface", () => {
  it("reports filter-effects support per backend", () => {
    const feature = COENX_VIDEO_CAPABILITIES.features.find((item) => item.id === "filter-effects")
    expect(feature?.support).toEqual({
      "static-svg": "supported",
      "native-cairo": "supported",
      "interactive-canvas": "partial",
      "interactive-svg": "supported",
    })
    for (const renderer of COENX_VIDEO_CAPABILITIES.renderers) {
      expect(renderer.features).toContain("filter-effects")
      expect(renderer.features).toContain("masks")
      expect(renderer.features).toContain("paint-resources")
    }
    const authoring = COENX_VIDEO_CAPABILITIES.authoring.formats.find((format) => format.id === "json-typescript")
    expect(authoring?.unsupportedAuthoringFeatures).not.toContain("filter-effects")
  })

  it("exposes the effects reference topic", () => {
    expect(referenceTopics()).toContain("effects")
    expect(referenceSection("effects").body).toContain("blur")
    expect(referenceSection("effects").body).toContain("4 effects")
  })
})
