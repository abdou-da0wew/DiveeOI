// Pack a test container with only the molecules scene for fast viewer testing.
import { mkdir } from "node:fs/promises"
import { packCoenx, validateCoenx } from "../src/container/pack"
import { arena } from "./world-showcase-composition"

const outDir = "/home/z/my-project/DiveeOI/exports"
await mkdir(outDir, { recursive: true })
const moleculesFirst = {
  ...arena,
  id: "molecules-test",
  title: "Molecules chamber — heat test",
  scenes: arena.scenes
    .filter((s) => s.id !== "arena")
    .map((s) => {
      if (s.id !== "intro") return s
      // Fast path: short intro that jumps straight into the molecules chamber.
      return {
        ...s,
        durationFrames: 30,
        interactions: [
          { id: "intro-go-mol", trigger: { type: "click", targetId: "intro-kick" }, actions: [{ type: "goto", sceneId: "molecules" }] },
          { id: "intro-auto-mol", trigger: { type: "timer", frame: 20 }, actions: [{ type: "goto", sceneId: "molecules" }] },
        ],
      }
    }),
}
const containerPath = `${outDir}/molecules-test.coenx4`
const packed = await packCoenx({ composition: moleculesFirst, projectRoot: outDir, outputPath: containerPath })
const validation = await validateCoenx(containerPath)
if (!validation.ok) throw new Error("validation failed: " + validation.issues.join("; "))
console.log("packed:", containerPath, packed.bytes, "bytes; valid:", validation.ok)
