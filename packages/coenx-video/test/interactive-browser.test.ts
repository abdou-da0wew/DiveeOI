import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { compileInteractiveProject } from "../src/compiler/interactive"
import type { Mesh3DNode, VideoComposition } from "../src/model/types"
import { runBuffer } from "../src/render/process"

setDefaultTimeout(45_000)

const chrome = Bun.which("google-chrome") ?? Bun.which("chromium") ?? Bun.which("chromium-browser")
const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

function composition(): VideoComposition {
  const morphMesh: Mesh3DNode = {
    id: "morph-mesh",
    kind: "mesh3d",
    x: 245,
    y: 90,
    width: 100,
    height: 80,
    position: [0, 0, 0],
    vertices: [
      [-1, -1, 0],
      [1, -1, 0],
      [0, 1, 0],
    ],
    triangles: [[0, 1, 2]],
    color: "#6b9ee8",
    material: { ambient: 0.2, diffuse: 0.9, specular: 0.25, shininess: 32, shading: "smooth" },
    morphTargets: [
      {
        name: "stretch",
        vertices: [
          [-1, -1, 0],
          [1, -1, 0],
          [0.85, 1, 0],
        ],
      },
    ],
    animations: [
      {
        property: "morph:stretch",
        keyframes: [
          { frame: 0, value: 0 },
          { frame: 12, value: 1 },
        ],
      },
      {
        property: "rotationY3d",
        keyframes: [
          { frame: 0, value: 0 },
          { frame: 12, value: 0.8 },
        ],
      },
    ],
  }
  const physicsMesh: Mesh3DNode = {
    ...morphMesh,
    id: "physics-mesh",
    x: 72,
    color: "#f59e0b",
    morphTargets: undefined,
    animations: undefined,
  }
  return {
    version: 1,
    id: "browser-interaction-smoke",
    title: "Interactive player smoke test",
    stage: { width: 320, height: 180, fps: 24 },
    initialState: { score: 0 },
    scenes: [
      {
        id: "question",
        durationFrames: 72,
        camera3d: { position: [0, 0, 5], target: [0, 0, 0], fov: 55 },
        lights3d: [
          { type: "ambient", intensity: 0.35 },
          { type: "directional", direction: [0, 0, 1], intensity: 1.1 },
        ],
        physics3d: {
          gravity: [0, -9.81, 0],
          substeps: 2,
          bodies: [
            {
              nodeId: "physics-mesh",
              position: [0, 0, 0],
              velocity: [0.15, 0, 0],
              rotation: [0, 0, 0],
              angularVelocity: [0, 0.4, 0],
              mass: 1,
              size: [1, 1, 1],
              collider: "aabb",
              restitution: 0.1,
            },
          ],
        },
        transition: { type: "flip-3d", durationFrames: 12 },
        pathDefinitions: [
          {
            id: "clip-donut",
            width: 50,
            height: 30,
            commands: [
              { type: "moveTo", point: [0, 0] },
              { type: "lineTo", point: [50, 0] },
              { type: "lineTo", point: [50, 30] },
              { type: "lineTo", point: [0, 30] },
              { type: "close" },
              { type: "moveTo", point: [12, 8] },
              { type: "lineTo", point: [36, 8] },
              { type: "lineTo", point: [36, 28] },
              { type: "lineTo", point: [12, 28] },
              { type: "close" },
            ],
          },
        ],
        clipPaths: [{ id: "clip-donut-mask", pathId: "clip-donut", fillRule: "evenodd" }],
        nodes: [
          {
            id: "submit",
            kind: "button",
            x: 160,
            y: 90,
            width: 120,
            height: 48,
            text: "Submit answer",
            fill: {
              type: "linear",
              from: [0, 0.5],
              to: [1, 0.5],
              stops: [
                { offset: 0, color: "#2563eb" },
                { offset: 1, color: "#a855f7" },
              ],
            },
          },
          {
            id: "gradient-panel",
            kind: "rect",
            x: 160,
            y: 155,
            width: 280,
            height: 24,
            radius: 8,
            fill: {
              type: "linear",
              from: [0, 0.5],
              to: [1, 0.5],
              stops: [
                { offset: 0, color: "#ef4444" },
                { offset: 1, color: "#2563eb" },
              ],
            },
          },
          {
            id: "gradient-orb",
            kind: "ellipse",
            x: 160,
            y: 30,
            width: 38,
            height: 26,
            fill: {
              type: "radial",
              center: [0.5, 0.5],
              radius: 0.7,
              stops: [
                { offset: 0, color: "#ffffff" },
                { offset: 1, color: "#10b981" },
              ],
            },
          },
          {
            id: "clipped-panel",
            kind: "rect",
            x: 265,
            y: 30,
            width: 60,
            height: 36,
            fill: "#16a34a",
            clipPathId: "clip-donut-mask",
          },
          {
            id: "curved-path",
            kind: "path",
            x: 160,
            y: 122,
            width: 92,
            height: 36,
            commands: [
              { type: "moveTo", point: [0, 18] },
              { type: "quadraticTo", control: [46, -6], to: [92, 18] },
              { type: "cubicTo", control1: [92, 36], control2: [0, 36], to: [0, 18] },
              { type: "close" },
            ],
            fill: {
              type: "linear",
              from: [0, 0.5],
              to: [1, 0.5],
              stops: [
                { offset: 0, color: "#f97316" },
                { offset: 1, color: "#7c3aed" },
              ],
            },
            stroke: "#ffffff",
            strokeWidth: 1.5,
          },
          morphMesh,
          physicsMesh,
        ],
        interactions: [
          {
            id: "submit-answer",
            trigger: { type: "click", targetId: "submit" },
            actions: [
              { type: "increment", key: "score", amount: 1 },
              { type: "emit", event: "answer-submitted", payload: "correct" },
              { type: "goto", sceneId: "complete" },
            ],
          },
        ],
      },
      { id: "complete", durationFrames: 72, nodes: [] },
    ],
  }
}

async function smokeRenderer(root: string, renderer: "canvas" | "svg") {
  const projectRoot = path.join(root, renderer)
  await mkdir(path.join(projectRoot, "exports"), { recursive: true })
  const outputDirectory = `exports/${renderer}`
  const result = await compileInteractiveProject(composition(), { projectRoot, outputDirectory, renderer })
  const htmlPath = path.join(result.outputDirectory, "index.html")
  const html = await readFile(htmlPath, "utf8")
  const probe = `<script>
window.addEventListener("error", event => {
  document.body.dataset.smokeError = event.message;
});
const root = document.querySelector("[data-coenx-player]");
root.addEventListener("coenx:event", event => {
  window.__coenxEvents = [...(window.__coenxEvents || []), event.detail];
});
root.addEventListener("coenx:state", event => {
  window.__coenxStates = [...(window.__coenxStates || []), event.detail];
});
root.addEventListener("coenx:scenechange", event => {
  window.__coenxScenes = [...(window.__coenxScenes || []), event.detail.sceneId];
});
root.addEventListener("coenx:ready", event => {
  const handle = event.detail.handle;
  const stage = root.querySelector("canvas, svg");
  handle.seek(0);
  const firstFrame = stage.tagName.toLowerCase() === "canvas" ? stage.toDataURL() : stage.innerHTML;
  handle.seek(6);
  const transitionStyle = stage.style.transform;
  handle.seek(12);
  const lastFrame = stage.tagName.toLowerCase() === "canvas" ? stage.toDataURL() : stage.innerHTML;
  const polygonCount = stage.querySelectorAll("polygon").length;
  const gradientCount = stage.querySelectorAll("linearGradient, radialGradient").length;
  const pathCount = stage.querySelectorAll("path").length;
  const clipPathCount = stage.querySelectorAll("clipPath").length;
  const clippedNode = stage.querySelector('[data-coenx-node="clipped-panel"]');
  const clipApplied = !!clippedNode?.getAttribute("clip-path");
  let clipInside = false;
  let clipHole = false;
  let clipOutside = false;
  if (stage.tagName.toLowerCase() === "canvas") {
    const context = stage.getContext("2d");
    // The canvas backing store is display-sized (CSS box x devicePixelRatio)
    // while the renderer draws in stage space scaled to fill it, so pixel
    // probes must map stage coordinates onto the backing store.
    const scaleX = stage.width / 320;
    const scaleY = stage.height / 180;
    const probe = (x, y) => context.getImageData(Math.round(x * scaleX), Math.round(y * scaleY), 1, 1).data;
    const inside = probe(242, 30);
    const hole = probe(265, 30);
    const outside = probe(232, 30);
    clipInside = inside[1] > inside[0] && inside[1] > inside[2];
    clipHole = !(hole[1] > hole[0] && hole[1] > hole[2]);
    clipOutside = !(outside[1] > outside[0] && outside[1] > outside[2]);
  }
  const target = root.querySelector('[data-coenx-node="submit"]') || root.querySelector("canvas");
  if (target.tagName.toLowerCase() === "canvas") {
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    }));
  } else {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  const marker = document.createElement("output");
  marker.id = "coenx-result";
  marker.textContent = JSON.stringify({
    score: handle.getState().score,
    events: window.__coenxEvents || [],
    states: window.__coenxStates || [],
    scenes: window.__coenxScenes || [],
    visualChanged: firstFrame !== lastFrame,
    polygonCount,
    gradientCount,
    pathCount,
    clipPathCount,
    clipApplied,
    clipInside,
    clipHole,
    clipOutside,
    transitionActive: transitionStyle.includes("perspective")
  });
  document.body.append(marker);
}, { once: true });
</script>`
  await writeFile(htmlPath, html.replace("</body>", `${probe}</body>`))

  const mime = (file: string) => {
    if (file.endsWith(".js")) return "text/javascript; charset=utf-8"
    if (file.endsWith(".json")) return "application/json; charset=utf-8"
    if (file.endsWith(".woff2")) return "font/woff2"
    if (file.endsWith(".css")) return "text/css; charset=utf-8"
    return "text/html; charset=utf-8"
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const file = path.resolve(result.outputDirectory, `.${pathname}`)
      if (file !== result.outputDirectory && !file.startsWith(result.outputDirectory + path.sep)) {
        return new Response("Not found", { status: 404 })
      }
      const data = Bun.file(file)
      if (!(await data.exists())) return new Response("Not found", { status: 404 })
      return new Response(data, { headers: { "content-type": mime(file) } })
    },
  })
  const browserData = await mkdtemp(path.join(root, `chrome-${renderer}-`))
  try {
    const { stdout, stderr } = await runBuffer(
      chrome!,
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${browserData}`,
        "--virtual-time-budget=1400",
        "--dump-dom",
        `http://127.0.0.1:${server.port}/index.html`,
      ],
      { maxOutputBytes: 8 * 1024 * 1024 },
    )
    const output = stdout.toString("utf8")
    expect(output).not.toContain("data-smoke-error")
    expect(output).toContain("data-coenx-player")
    const match = /<output id="coenx-result">([^<]+)<\/output>/.exec(output)
    expect(match?.[1]).toBeTruthy()
    if (!match?.[1])
      throw new Error(`Chrome did not complete the player probe. STDERR: ${stderr} DOM: ${output.slice(-4000)}`)
    const resultState = JSON.parse(match[1]) as {
      score: number
      events: Array<{ event: string; payload?: string }>
      states: Array<{ score: number }>
      scenes: string[]
      visualChanged: boolean
      polygonCount: number
      gradientCount: number
      pathCount: number
      clipPathCount: number
      clipApplied: boolean
      clipInside: boolean
      clipHole: boolean
      clipOutside: boolean
      transitionActive: boolean
    }
    expect(resultState.visualChanged).toBe(true)
    expect(resultState.transitionActive).toBe(true)
    if (renderer === "svg") {
      expect(resultState.polygonCount).toBeGreaterThanOrEqual(2)
      expect(resultState.gradientCount).toBeGreaterThanOrEqual(3)
      expect(resultState.pathCount).toBe(2)
      expect(resultState.clipPathCount).toBe(1)
      expect(resultState.clipApplied).toBe(true)
    } else {
      expect(resultState.clipInside).toBe(true)
      expect(resultState.clipHole).toBe(true)
      expect(resultState.clipOutside).toBe(true)
    }
    expect(resultState.score).toBe(1)
    expect(resultState.events).toEqual([{ event: "answer-submitted", payload: "correct" }])
    expect(resultState.states).toEqual([{ score: 1 }])
    expect(resultState.scenes).toEqual(["complete"])
  } finally {
    server.stop(true)
    await rm(browserData, { recursive: true, force: true })
  }
}

describe("interactive player browser runtime", () => {
  it.skipIf(!chrome)("plays a Canvas composition and dispatches interaction events", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coenx-browser-"))
    roots.push(root)
    await smokeRenderer(root, "canvas")
  })

  it.skipIf(!chrome)("plays an SVG composition and dispatches interaction events", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coenx-browser-"))
    roots.push(root)
    await smokeRenderer(root, "svg")
  })
})
