import { describe, expect, it } from "bun:test"
import { compileCmlProject } from "../src/format/compiler"
import { parsePathD } from "../src/format/defs"
import { validateComposition, VideoValidationError } from "../src/model/validate"
import { renderSceneSvg } from "../src/render/scene-svg"


const defsCml = `<coenx id="defs-demo" title="Defs demo" width="320" height="180" fps="6">
  <scene id="intro" frames="6">
    <defs>
      <path id="wave" d="M 0 50 Q 25 0 50 50 Q 75 100 100 50 Z" viewBox="100x100" fill-rule="evenodd"/>
      <clip id="frame-clip" path="wave"/>
      <mask id="fade-mask" viewBox="100x60">
        <rect x="0" y="0" width="60" height="60" fill="#ffffff"/>
        <ellipse cx="80" cy="30" rx="20" ry="30" fill="#ffffff" fill-opacity="0.5"/>
      </mask>
      <gradient id="brand" type="linear" from="0,0.5" to="1,0.5" spread="repeat">
        <stop offset="0" color="#ff0000"/>
        <stop offset="1" color="#0000ff"/>
      </gradient>
      <gradient id="glow" type="radial" center="0.5,0.5" radius="0.5">
        <stop offset="0" color="#ffffff"/>
        <stop offset="1" color="#10b981" opacity="0.2"/>
      </gradient>
    </defs>
    <rect id="panel" x="160" y="60" width="120" height="80" fill="url(#brand)" clip="frame-clip" mask="fade-mask"/>
    <ellipse id="orb" x="260" y="120" width="90" height="60" fill="url(#glow)"/>
    <path id="curve" x="80" y="130" width="100" height="50" path-ref="wave" fill="#10b981"/>
  </scene>
</coenx>`

describe("CML defs compilation (WP5)", () => {
  const composition = compileCmlProject({ markup: defsCml })
  const scene = composition.scenes[0]

  it("compiles path resources with d syntax and view boxes", () => {
    expect(scene.pathDefinitions).toHaveLength(1)
    expect(scene.pathDefinitions?.[0]).toMatchObject({
      id: "wave",
      width: 100,
      height: 100,
      fillRule: "evenodd",
      commands: [
        { type: "moveTo", point: [0, 50] },
        { type: "quadraticTo", control: [25, 0], to: [50, 50] },
        { type: "quadraticTo", control: [75, 100], to: [100, 50] },
        { type: "close" },
      ],
    })
  })

  it("compiles clip and mask resources", () => {
    expect(scene.clipPaths?.[0]).toMatchObject({ id: "frame-clip", pathId: "wave" })
    expect(scene.masks?.[0]).toMatchObject({ id: "fade-mask", width: 100, height: 60 })
    const shapes = scene.masks?.[0].shapes ?? []
    expect(shapes[0]).toMatchObject({ kind: "rect", x: 0, y: 0, width: 60, height: 60 })
    expect(shapes[1]).toMatchObject({ kind: "ellipse", x: 60, y: 0, width: 40, height: 60 })
  })

  it("compiles gradient paint resources and node references", () => {
    expect(scene.paints?.[0]).toMatchObject({ id: "brand" })
    expect(scene.paints?.[0].paint).toMatchObject({ type: "linear", spread: "repeat" })
    const panel = scene.nodes[0]
    expect(panel).toMatchObject({ clipPathId: "frame-clip", maskId: "fade-mask" })
    expect(panel.kind === "rect" && panel.fill).toEqual({ paintRef: "brand" })
  })

  it("produces a composition the shared validator accepts end to end", () => {
    expect(() => validateComposition(composition)).not.toThrow()
  })

  it("emits spread and transform attributes into the static SVG backend", async () => {
    const svg = await renderSceneSvg(composition, scene, 0, { projectRoot: "/tmp" })
    expect(svg).toContain('spreadMethod="repeat"')
    expect(svg).toContain('fill="url(#gradient-defs-demo-panel)"')
  })

  it("reports compiler errors with source locations", () => {
    const broken = defsCml.replace('d="M 0 50 Q 25 0 50 50 Q 75 100 100 50 Z"', 'd="M 0 50 X 5 5"')
    try {
      compileCmlProject({ markup: broken })
      expect.unreachable()
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      expect(message).toMatch(/unsupported path command.*\(line \d+, column \d+\)/)
    }
  })

  it("rejects unsupported defs elements and malformed path data", () => {
    expect(() => parsePathD("M 0 0 X 5 5")).toThrow(/unsupported path command/)
    expect(() => compileCmlProject({ markup: '<coenx><scene><defs><foo id="x"/></defs></scene></coenx>' })).toThrow(
      /unsupported <defs> element/,
    )
  })

  it("keeps plain CML projects byte-compatible (no defs)", () => {
    const plain = '<coenx id="plain" title="Plain" width="320" height="180" fps="6"><scene id="s" frames="6"><rect id="r" x="10" y="10" width="50" height="50" fill="#ffffff"/></scene></coenx>'
    const compiled = compileCmlProject({ markup: plain })
    expect(compiled.scenes[0].pathDefinitions).toBeUndefined()
    expect(compiled.scenes[0].nodes[0]).toMatchObject({ kind: "rect", fill: "#ffffff" })
  })
})

describe("gradient spread and paint resources (WP3)", () => {
  it("freezes pad behavior when spread is omitted (default parity)", async () => {
    const cml = '<coenx id="pad" title="Pad" width="160" height="90" fps="6"><scene id="s" frames="6"><rect id="r" x="80" y="45" width="120" height="60" fill="url(#g)"/><defs><gradient id="g" type="linear" from="0,0.5" to="1,0.5"><stop offset="0" color="#ff0000"/><stop offset="1" color="#0000ff"/></gradient></defs></scene></coenx>'
    const svg = await renderSceneSvg(compileCmlProject({ markup: cml }), compileCmlProject({ markup: cml }).scenes[0], 0, { projectRoot: "/tmp" })
    expect(svg).not.toContain("spreadMethod")
  })

  it("validates paint resource references and spread values", () => {
    const dangling = '<coenx id="d" title="D" width="320" height="180" fps="6"><scene id="s" frames="6"><rect id="r" x="10" y="10" width="50" height="50" fill="url(#nope)"/></scene></coenx>'
    expect(() => validateComposition(compileCmlProject({ markup: dangling }))).toThrow(VideoValidationError)
    const badSpread = '<coenx id="d2" title="D2" width="320" height="180" fps="6"><scene id="s" frames="6"><defs><gradient id="g" type="linear" from="0,0.5" to="1,0.5" spread="mirage"><stop offset="0" color="#ff0000"/><stop offset="1" color="#0000ff"/></gradient></defs><rect id="r" x="10" y="10" width="50" height="50" fill="url(#g)"/></scene></coenx>'
    expect(() => validateComposition(compileCmlProject({ markup: badSpread }))).toThrow(VideoValidationError)
  })

  it.skipIf(!Bun.which("ffmpeg") || !Bun.which("ffprobe"))("encodes repeat/transform gradients to MP4 with the native renderer", async () => {
    const { mkdtemp } = await import("node:fs/promises")
    const os = await import("node:os")
    const { renderNativeVideo } = await import("../src/render/native-video")
    const projectRoot = await mkdtemp(`${os.tmpdir()}/coenx-spread-`)
    const composition = compileCmlProject({
      markup:
        '<coenx id="spread" title="Spread" width="160" height="90" fps="6"><scene id="s" frames="6"><defs><gradient id="g" type="linear" from="0,0.5" to="0.25,0.5" spread="repeat"><stop offset="0" color="#ff0000"/><stop offset="1" color="#0000ff"/></gradient></defs><rect id="r" x="80" y="45" width="150" height="80" fill="url(#g)"/></scene></coenx>',
    })
    const result = await renderNativeVideo(composition, { outputPath: "out/spread.mp4", projectRoot, profile: { name: "low" } })
    expect(result.frames).toBe(6)
  })
})
