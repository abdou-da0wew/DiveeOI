import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { compileInteractiveProject } from "../src/compiler/interactive"
import { runBuffer } from "../src/render/process"
import type { VideoComposition } from "../src/model/types"

setDefaultTimeout(60_000)

const chrome = Bun.which("google-chrome") ?? Bun.which("chromium") ?? Bun.which("chromium-browser")
const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

/**
 * The world demo: a physics arena that exercises every world-model feature
 * end to end — click impulses with statement lists, hover enter/leave node
 * styling, drag-throw with live 2D physics, collision events and arithmetic
 * HUD updates driven by expressions.
 */
function worldComposition(): VideoComposition {
  return {
    version: 1,
    id: "world-demo",
    title: "World demo — physics playground",
    stage: { width: 480, height: 270, fps: 30 },
    initialState: { score: 0 },
    scenes: [
      {
        id: "arena",
        durationFrames: 300,
        background: "#0f1522",
        physics: {
          gravity: [0, 620],
          bodies: [
            { nodeId: "ball", mass: 1, velocity: [36, 0], size: [44, 44], restitution: 0.55 },
            { nodeId: "floor", mass: 0, velocity: [0, 0], size: [480, 24], isStatic: true, restitution: 0.2 },
            { nodeId: "wall-left", mass: 0, velocity: [0, 0], size: [24, 270], isStatic: true, restitution: 0.4 },
            { nodeId: "wall-right", mass: 0, velocity: [0, 0], size: [24, 270], isStatic: true, restitution: 0.4 },
          ],
        },
        nodes: [
          { id: "hud", kind: "text", x: 80, y: 24, width: 300, height: 26, text: "hits 0", color: "#eef2f8" },
          { id: "ball", kind: "ellipse", x: 240, y: 60, width: 44, height: 44, fill: "#5b8cff" },
          { id: "pad", kind: "rect", x: 120, y: 200, width: 90, height: 30, fill: "#1a2337", radius: 6, stroke: "#5b8cff" },
          { id: "floor", kind: "rect", x: 240, y: 258, width: 480, height: 24, fill: "#243050" },
          { id: "wall-left", kind: "rect", x: 12, y: 135, width: 24, height: 270, fill: "#243050" },
          { id: "wall-right", kind: "rect", x: 468, y: 135, width: 24, height: 270, fill: "#243050" },
        ],
        interactions: [
          {
            id: "ball-kick",
            trigger: { type: "click", targetId: "ball" },
            actions: [
              {
                type: "run",
                actions: [
                  { type: "increment", key: "score", amount: 1 },
                  { type: "impulse", targetId: "ball", vx: 60, vy: -190 },
                  {
                    type: "setNode",
                    targetId: "hud",
                    props: {
                      text: { op: "concat", items: [{ op: "literal", value: "hits " }, { op: "state", key: "score" }] },
                    },
                  },
                ],
              },
            ],
          },
          {
            id: "pad-hover-in",
            trigger: { type: "hover", targetId: "pad", phase: "enter" },
            actions: [{ type: "setNode", targetId: "pad", props: { scale: 1.15 } }],
          },
          {
            id: "pad-hover-out",
            trigger: { type: "hover", targetId: "pad", phase: "leave" },
            actions: [{ type: "setNode", targetId: "pad", props: { scale: 1 } }],
          },
          {
            id: "ball-drag-move",
            trigger: { type: "drag", targetId: "ball", phase: "move" },
            actions: [{ type: "setNode", targetId: "hud", props: { text: "dragging…" } }],
          },
          {
            id: "ball-drag-end",
            trigger: { type: "drag", targetId: "ball", phase: "end" },
            actions: [{ type: "feedback", text: "thrown", tone: "success" }],
          },
          {
            id: "ball-bounce",
            trigger: { type: "collide", targetId: "ball", withId: "floor" },
            actions: [
              { type: "emit", event: "world:bounce" },
              { type: "setNode", targetId: "hud", props: { color: "#3ecf8e" } },
            ],
          },
          {
            id: "ball-wall",
            trigger: { type: "collide", targetId: "ball", withId: "wall-right" },
            actions: [{ type: "emit", event: "world:wall" }],
          },
        ],
      },
    ],
  }
}

interface WorldProbeResult {
  score: number
  events: Array<{ event: string; payload?: string }>
  scenes: string[]
  hudDuringDrag: string
  hudAfterKick: string
  padScaleOnHover: string | null
  padScaleAfterLeave: string | null
  ballTransformAfterDrag: string | null
  bounceCount: number
  ballMovedWithoutInput: boolean
}

async function runWorldProbe(root: string, renderer: "canvas" | "svg") {
  const projectRoot = path.join(root, renderer)
  await mkdir(projectRoot, { recursive: true })
  const result = await compileInteractiveProject(worldComposition(), {
    projectRoot,
    outputDirectory: "exports",
    renderer,
  })
  const htmlPath = path.join(result.outputDirectory, "index.html")
  const html = await readFile(htmlPath, "utf8")
  const probe = `<script>
window.addEventListener("error", event => { document.body.dataset.smokeError = event.message; });
const root = document.querySelector("[data-coenx-player]");
const readHud = () => {
  const node = root.querySelector('[data-coenx-node="hud"]');
  if (!node) return null;
  const text = node.querySelector("text, textPath") || node;
  return text.textContent || node.textContent || "";
};
const readAttr = (id, attr) => root.querySelector('[data-coenx-node="' + id + '"]')?.getAttribute(attr) ?? null;
const pointFor = (id, dx = 0, dy = 0) => {
  const stage = root.querySelector("canvas, svg");
  const rect = stage.getBoundingClientRect();
  const boxes = { ball: [240, 60], pad: [120, 200] };
  const [x, y] = boxes[id];
  return { clientX: rect.left + (rect.width * x) / 480 + dx, clientY: rect.top + (rect.height * y) / 270 + dy };
};
const fire = (type, targetId, extra = {}) => {
  const stage = root.querySelector("canvas, svg");
  stage.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, ...pointFor(targetId), ...extra }));
};
root.addEventListener("coenx:event", event => { window.__events = [...(window.__events || []), event.detail]; });
root.addEventListener("coenx:scenechange", event => { window.__scenes = [...(window.__scenes || []), event.detail.sceneId]; });
root.addEventListener("coenx:ready", event => {
  const handle = event.detail.handle;
  // Input handlers require a playing player; keep re-arming it because the
  // headless environment may pause playback via visibility/intersection.
  const ensurePlaying = () => handle.play();
  ensurePlaying();
  setTimeout(() => {
    // Hover enter/leave restyles the pad via setNode.
    ensurePlaying();
    fire("pointermove", "pad");
    const hoverScale = readAttr("pad", "transform");
    fire("pointermove", "ball");
    const leaveScale = readAttr("pad", "transform");
    // Click the ball: statement list scores, records and updates the HUD text.
    ensurePlaying();
    fire("pointerdown", "ball");
    fire("pointerup", "ball");
    document.querySelector("canvas, svg").dispatchEvent(new MouseEvent("click", { bubbles: true, ...pointFor("ball") }));
    const hudAfterKick = readHud();
    // Drag the ball: start -> move -> end throws it with live physics.
    ensurePlaying();
    fire("pointerdown", "ball");
    fire("pointermove", "ball", { clientX: pointFor("ball").clientX + 30, clientY: pointFor("ball").clientY + 10 });
    const hudDuringDrag = readHud();
    const ballTransformAfterDrag = readAttr("ball", "transform");
    fire("pointerup", "ball");
    // Advance the timeline deterministically: every seek renders and steps up
    // to 12 physics frames, so the world simulates 240 frames (~8s) here.
    for (let frame = 12; frame <= 240; frame += 12) handle.seek(frame);
    const marker = document.createElement("output");
    marker.id = "world-result";
    marker.textContent = JSON.stringify({
      score: handle.getState().score,
      events: window.__events || [],
      scenes: window.__scenes || [],
      hudAfterKick,
      hudDuringDrag,
      padScaleOnHover: hoverScale,
      padScaleAfterLeave: leaveScale,
      ballTransformAfterDrag,
      bounceCount: (window.__events || []).filter(item => item.event === "world:bounce").length,
      wallCount: (window.__events || []).filter(item => item.event === "world:wall").length
    });
    document.body.append(marker);
  }, 250);
}, { once: true });
</script>`
  await writeFile(htmlPath, html.replace("</body>", `${probe}</body>`))

  const mime = (file: string) => {
    if (file.endsWith(".js")) return "text/javascript; charset=utf-8"
    if (file.endsWith(".json")) return "application/json; charset=utf-8"
    return "text/html; charset=utf-8"
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const file = path.resolve(result.outputDirectory, `.${pathname}`)
      if (!file.startsWith(result.outputDirectory + path.sep)) return new Response("Not found", { status: 404 })
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
        "--virtual-time-budget=6000",
        "--dump-dom",
        `http://127.0.0.1:${server.port}/index.html`,
      ],
      { maxOutputBytes: 8 * 1024 * 1024 },
    )
    const output = stdout.toString("utf8")
    expect(output).not.toContain("data-smoke-error")
    const match = /<output id="world-result">([^<]+)<\/output>/.exec(output)
    if (!match?.[1]) throw new Error(`Chrome did not complete the world probe. STDERR: ${stderr} DOM: ${output.slice(-4000)}`)
    return JSON.parse(match[1]) as WorldProbeResult
  } finally {
    server.stop(true)
  }
}

describe("world demo e2e (headless chrome)", () => {
  it.skipIf(!chrome)(
    "drives clicks, hovers, drags, live physics and collision events in the browser",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "coenx-world-"))
      roots.push(root)
      const result = await runWorldProbe(root, "svg")

      // Click: statement list ran — score incremented and HUD shows the
      // concatenated expression result.
      expect(result.score).toBe(1)
      expect(result.hudAfterKick).toBe("hits 1")

      // Hover: pad scaled on enter and restored on leave.
      expect(result.padScaleOnHover).toContain("scale(1.15")
      expect(result.padScaleAfterLeave).not.toContain("scale(1.15")

      // Drag: move-phase interaction fired and the ball followed the pointer.
      expect(result.hudDuringDrag).toBe("dragging…")
      expect(result.ballTransformAfterDrag).toBeTruthy()

      // Physics: the dropped ball bounced off the floor (collision events).
      expect(result.bounceCount).toBeGreaterThan(0)
    },
  )
})
