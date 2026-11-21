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
  }
}
