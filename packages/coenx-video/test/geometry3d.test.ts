import { describe, expect, it } from "bun:test"
import { evaluateNodeAtFrame } from "../src/animation/timeline"
import type { Mesh3DNode, VideoComposition } from "../src/model/types"
import { physics3DPoseAt, simulatePhysics3D } from "../src/physics/simulate3d"
import { projectMesh3D } from "../src/render/geometry3d"
import { renderSceneSvg } from "../src/render/scene-svg"
import { validateComposition } from "../src/model/validate"

const triangle: Mesh3DNode = {
  id: "mesh",
  kind: "mesh3d",
  x: 160,
  y: 90,
  width: 160,
  height: 90,
  vertices: [
    [-1, -1, 0],
    [1, -1, 0],
    [0, 1, 0],
  ],
  triangles: [[0, 1, 2]],
  color: "#6b9ee8",
  material: { ambient: 0.12, diffuse: 0.9, specular: 0.2, shininess: 32 },
}

const camera = { position: [0, 0, 6] as const, target: [0, 0, 0] as const, fov: 55 }

describe("3D mesh pipeline", () => {
  it("supports smooth vertex-normal shading through adaptive triangle subdivision", () => {
    const flat = projectMesh3D(triangle, camera, { width: 160, height: 90 }, [
      { type: "directional", direction: [0, 0, 1], intensity: 1.2 },
    ])
    const smooth = projectMesh3D(
      { ...triangle, material: { ...triangle.material, shading: "smooth" } },
      camera,
      { width: 160, height: 90 },
      [{ type: "directional", direction: [0, 0, 1], intensity: 1.2 }],
    )
    expect(flat).toHaveLength(1)
    expect(smooth).toHaveLength(4)
    expect(smooth[0].fill).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it("changes the projected mesh when morph targets are animated", () => {
    const animated: Mesh3DNode = {
      ...triangle,
      morphTargets: [
        {
          name: "stretch",
          vertices: [
            [-1, -1, 0],
            [1, -1, 0],
            [0.9, 1, 0],
          ],
        },
      ],
      animations: [
        {
          property: "morph:stretch",
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 10, value: 1 },
          ],
        },
      ],
    }
    const start = evaluateNodeAtFrame(animated, 0) as Mesh3DNode
    const end = evaluateNodeAtFrame(animated, 10) as Mesh3DNode
    expect(start.morphWeights?.stretch ?? 0).toBe(0)
    expect(end.morphWeights?.stretch).toBe(1)
    expect(projectMesh3D(start, camera, { width: 160, height: 90 })).not.toEqual(
      projectMesh3D(end, camera, { width: 160, height: 90 }),
    )
  })

  it("animates the 3D position, rotation and scale components", () => {
    const animated: Mesh3DNode = {
      ...triangle,
      animations: [
        {
          property: "positionZ3d",
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 12, value: 2 },
          ],
        },
        {
          property: "rotationY3d",
          keyframes: [
            { frame: 0, value: 0 },
            { frame: 12, value: Math.PI / 2 },
          ],
        },
        {
          property: "scaleX3d",
          keyframes: [
            { frame: 0, value: 1 },
            { frame: 12, value: 1.5 },
          ],
        },
      ],
    }
    const frame = evaluateNodeAtFrame(animated, 6) as Mesh3DNode
    expect(frame.position).toEqual([0, 0, 1])
    expect(frame.rotation3d?.[1]).toBeCloseTo(Math.PI / 4)
    expect(frame.scale3d?.[0]).toBeCloseTo(1.25)
  })

  it("renders configured lights and scene transition clips into SVG frames", async () => {
    const composition: VideoComposition = {
      version: 1,
      id: "3d-transition-test",
      title: "3D transition",
      stage: { width: 320, height: 180, fps: 30 },
      scenes: [
        {
          id: "scene",
          durationFrames: 20,
          transition: { type: "wipe-left", durationFrames: 10 },
          camera3d: camera,
          lights3d: [
            { type: "ambient", intensity: 0.3 },
            { type: "directional", direction: [0, 0, 1], intensity: 1.1 },
          ],
          nodes: [triangle],
        },
      ],
    }
    const svg = await renderSceneSvg(composition, composition.scenes[0], 5, { projectRoot: "/tmp" })
    expect(svg).toContain("clipPath")
    expect(svg).toContain("polygon")
    expect(svg).toContain('fill="#')
  })

  it("simulates 3D gravity, angular motion and world-bound collisions deterministically", () => {
    const settings = {
      gravity: [0, -9.81, 0] as const,
      substeps: 3,
      bounds: { min: [-2, -1, -2] as const, max: [2, 2, 2] as const },
      bodies: [
        {
          nodeId: "falling-mesh",
          position: [0, 0, 0] as const,
          velocity: [0, 0, 0] as const,
          rotation: [0, 0, 0] as const,
          angularVelocity: [0, 1, 0] as const,
          mass: 1,
          size: [1, 1, 1] as const,
          collider: "aabb" as const,
          restitution: 0,
        },
      ],
    }
    const a = simulatePhysics3D(settings, 90, { dt: 1 / 30 })
    const b = simulatePhysics3D(settings, 90, { dt: 1 / 30 })
    const pose = physics3DPoseAt(a, "falling-mesh", 90)!
    expect(pose.position[1]).toBeGreaterThanOrEqual(-0.5001)
    expect(pose.rotation[1]).toBeCloseTo(3)
    expect(physics3DPoseAt(b, "falling-mesh", 90)).toEqual(pose)
  })

  it("resolves sphere-to-box collisions using the sphere radius", () => {
    const simulation = simulatePhysics3D(
      {
        gravity: [0, 0, 0],
        substeps: 1,
        bodies: [
          {
            nodeId: "sphere",
            position: [-0.8, 0, 0],
            velocity: [1, 0, 0],
            mass: 1,
            size: [0.8, 0.8, 0.8],
            collider: "sphere",
            restitution: 1,
          },
          {
            nodeId: "box",
            position: [0, 0, 0],
            velocity: [0, 0, 0],
            mass: 1,
            size: [1, 1, 1],
            collider: "aabb",
            isStatic: true,
          },
        ],
      },
      1,
      { dt: 1 / 30 },
    )
    const sphere = physics3DPoseAt(simulation, "sphere", 1)!
    expect(sphere.position[0]).toBeLessThan(-0.8)
  })

  it("validates morph targets, lights and 3D physics references", () => {
    const composition: VideoComposition = {
      version: 1,
      id: "validated-3d-scene",
      title: "Validated 3D scene",
      stage: { width: 320, height: 180, fps: 30 },
      scenes: [
        {
          id: "scene",
          durationFrames: 30,
          lights3d: [{ type: "directional", direction: [0, 1, 0], intensity: 1 }],
          physics3d: {
            bodies: [{ nodeId: "mesh", velocity: [0, 0, 0], mass: 1, size: [1, 1, 1] }],
          },
          nodes: [
            {
              ...triangle,
              morphTargets: [{ name: "shape", vertices: triangle.vertices }],
              morphWeights: { shape: 0.5 },
            },
          ],
        },
      ],
    }
    expect(() => validateComposition(composition)).not.toThrow()
  })
})
