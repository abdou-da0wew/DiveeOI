// Pack the world-showcase interactive world into the DiveeOI worktree so the
// app session viewer can open it as a video: tab.
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { packCoenx, validateCoenx } from "../src/container/pack"
import { arena as worldShowcaseComposition } from "./world-showcase-composition"

// Repo root derived from this file's location (scripts/ -> package -> repo);
// overridable with argv[1] so the script stays host-agnostic.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const outDir = process.argv[2] ?? path.join(repoRoot, "exports")
await mkdir(outDir, { recursive: true })
const containerPath = `${outDir}/world-showcase.coenx4`
const packed = await packCoenx({ composition: worldShowcaseComposition, projectRoot: outDir, outputPath: containerPath })
const validation = await validateCoenx(containerPath)
if (!validation.ok) throw new Error("validation failed: " + validation.issues.join("; "))
console.log("packed:", containerPath, packed.bytes, "bytes; valid:", validation.ok)
