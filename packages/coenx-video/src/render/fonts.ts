import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { VideoComposition, VisualNode } from "../model/types"
import { findFontFamily } from "../fonts/catalog"
import { FONT_LIBRARY_RESOURCE_FILES } from "../fonts/embedded"

function textNodes(nodes: VisualNode[]) {
  return nodes.filter(
    (node) => node.kind === "text" || node.kind === "button" || node.kind === "input" || node.kind === "select",
  )
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

const WOFF2_TO_TTF_SCRIPT = [
  "import sys",
  "from fontTools.ttLib import TTFont",
  "for pair in sys.argv[1:]:",
  "    source, target = pair.split('=', 1)",
  "    font = TTFont(source)",
  "    font.flavor = None",
  "    font.save(target)",
].join("\n")

/**
 * Some fontconfig + Pango stacks index WOFF2 fonts but cannot rasterize their
 * glyphs, so text silently falls back to a system typeface. When a local
 * converter is available, add TTF siblings next to the WOFF2 files so the
 * bundled families always win font matching. Best effort: any failure keeps
 * the WOFF2-only behaviour unchanged.
 */
async function convertWoff2ToTtf(fontsDirectory: string, files: string[]): Promise<number> {
  const jobs = files.map((file) => {
    if (!file.endsWith(".woff2")) return undefined
    const source = path.join(fontsDirectory, file)
    const target = source.slice(0, -".woff2".length) + ".ttf"
    return source + "=" + target
  }).filter((job): job is string => job !== undefined)
  if (!jobs.length) return 0
  return await new Promise((resolve) => {
    const child = spawn("python3", ["-c", WOFF2_TO_TTF_SCRIPT, ...jobs], { stdio: "ignore" })
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000)
    child.on("error", () => {
      clearTimeout(timer)
      resolve(0)
    })
    child.on("exit", (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? jobs.length : 0)
    })
  })
}

export async function prepareRenderFonts(composition: VideoComposition, tempRoot: string) {
  const usedFamilies = new Set<string>(["Geist"])
  for (const scene of composition.scenes) {
    for (const node of textNodes(scene.nodes)) {
      if (node.fontFamily) usedFamilies.add(node.fontFamily)
    }
  }

  const fontsDirectory = path.join(tempRoot, "fonts")
  const cacheDirectory = path.join(tempRoot, "font-cache")
  await Promise.all([mkdir(fontsDirectory, { recursive: true }), mkdir(cacheDirectory, { recursive: true })])

  const manifest = JSON.parse(FONT_LIBRARY_RESOURCE_FILES["manifest.json"]) as {
    families: Array<{ family: string; files: string[] }>
  }
  const fontFiles = new Set<string>()
  for (const family of usedFamilies) {
    const catalogueEntry = findFontFamily(family)
    if (!catalogueEntry) throw new Error("Font family is not bundled with Coenx Video: " + family)
    const record = manifest.families.find((item) => item.family === catalogueEntry.family)
    if (!record?.files.length) throw new Error("Bundled font files are missing for: " + family)
    record.files.forEach((file) => fontFiles.add(file))
  }

  for (const file of fontFiles) {
    const resource = FONT_LIBRARY_RESOURCE_FILES["fonts/" + file + ".b64"]
    if (!resource) throw new Error("Bundled font resource is missing: " + file)
    await writeFile(path.join(fontsDirectory, file), Buffer.from(resource, "base64"))
  }

  const converted = await convertWoff2ToTtf(fontsDirectory, [...fontFiles])

  const configFile = path.join(tempRoot, "fonts.conf")
  const config = [
    '<?xml version="1.0"?>',
    "<fontconfig>",
    "  <dir>" + escapeXml(fontsDirectory) + "</dir>",
    "  <cachedir>" + escapeXml(cacheDirectory) + "</cachedir>",
    "</fontconfig>",
  ].join(String.fromCharCode(10))
  await writeFile(configFile, config)
  return {
    fontConfigFile: configFile,
    fontCount: fontFiles.size,
    families: [...usedFamilies],
    ttfConverted: converted,
  }
}
