import path from "node:path"
import os from "node:os"
import { mkdtemp, mkdir, realpath, rename, rm, stat, writeFile, copyFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { validateComposition } from "../model/validate"
import { FONT_FACE_CSS } from "../fonts/embedded"
import type { CustomFontSpec, VideoComposition } from "../model/types"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function resolveInside(root: string, relative: string) {
  if (/^[a-z]+:\/\//i.test(relative) || path.isAbsolute(relative))
    throw new Error(`Only local relative assets are supported: ${relative}`)
  const resolved = path.resolve(root, relative)
  if (!resolved.startsWith(path.resolve(root) + path.sep))
    throw new Error(`Asset path escapes the project root: ${relative}`)
  return resolved
}

function safeOutput(root: string, output: string) {
  if (path.isAbsolute(output)) throw new Error("Interactive export path must be relative to the project root")
  const resolved = path.resolve(root, output)
  if (!resolved.startsWith(path.resolve(root) + path.sep) || resolved === path.resolve(root))
    throw new Error("Interactive export path escapes the project root")
  return resolved
}

async function ensureSourceFile(root: string, relative: string) {
  const tmpRoot = await realpath(os.tmpdir())
  let resolved: string
  if (relative.startsWith("tmp:")) {
    const rest = relative.slice(4)
    if (!rest) throw new Error(`tmp: media source needs a path: ${relative}`)
    resolved = path.isAbsolute(rest) ? path.resolve(rest) : path.resolve(tmpRoot, rest)
  } else if (path.isAbsolute(relative)) {
    resolved = path.resolve(relative)
  } else {
    resolved = resolveInside(root, relative)
  }
  const info = await stat(resolved)
  if (!info.isFile()) throw new Error(`Media source is not a file: ${relative}`)
  if (info.size > 128 * 1024 * 1024) throw new Error(`Media source exceeds 128 MB: ${relative}`)
  const verified = await realpath(resolved)
  if (!verified.startsWith((await realpath(root)) + path.sep) && !verified.startsWith(tmpRoot + path.sep))
    throw new Error(`Media source resolves outside the project root and temp directory: ${relative}`)
  return verified
}

export interface InteractiveCompileOptions {
  outputDirectory: string
  projectRoot?: string
  renderer?: "canvas" | "svg"
}

export interface InteractiveCompileResult {
  outputDirectory: string
  compositionFile: string
  runtimeFile: string
  assetsCopied: number
  totalFrames: number
}

export async function compileInteractiveProject(composition: VideoComposition, options: InteractiveCompileOptions) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd())
  const outputDirectory = safeOutput(projectRoot, options.outputDirectory)
  const validated = validateComposition(composition)
  try {
    await stat(outputDirectory)
    throw new Error(`Output directory already exists; refusing to overwrite it: ${outputDirectory}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const tempDirectory = await mkdtemp(path.join(path.dirname(outputDirectory), ".coenx-export-"))
  const mediaDirectory = path.join(tempDirectory, "media")
  const assetsDirectory = path.join(tempDirectory, "assets")
  await Promise.all([mkdir(mediaDirectory, { recursive: true }), mkdir(assetsDirectory, { recursive: true })])
  const mediaMap = new Map<string, string>()
  let assetNumber = 0

  async function copyMedia(source: string) {
    const verified = await ensureSourceFile(projectRoot, source)
    const existing = mediaMap.get(verified)
    if (existing) return existing
    const extension = path.extname(verified).toLowerCase()
    const fileName = `asset-${String(assetNumber++).padStart(4, "0")}${extension}`
    const relative = `media/${fileName}`
    await copyFile(verified, path.join(tempDirectory, relative))
    mediaMap.set(verified, relative)
    return relative
  }

  try {
    const next: VideoComposition = structuredClone(composition)
    const aliases = new Map<string, string>()
    for (const [id, source] of Object.entries(composition.assets ?? {})) aliases.set(id, await copyMedia(source))
    for (const scene of next.scenes) {
      for (const node of scene.nodes) {
        if (node.kind !== "image" && node.kind !== "video") continue
        const source = composition.assets?.[node.asset] ?? node.asset
        aliases.set(node.asset, await copyMedia(source))
      }
    }
    next.assets = Object.fromEntries(aliases)
    for (const track of next.audio ?? []) track.source = await copyMedia(track.source)

    // Custom fonts: copy the font files next to the media assets and rewrite
    // their sources, then generate @font-face rules so the player honors the
    // declared families without any network access.
    const fontFaces: string[] = []
    const declaredFonts: CustomFontSpec[] = []
    for (const font of composition.fonts ?? []) {
      const source = composition.assets?.[font.src] ?? font.src
      if (/^data:font\//i.test(source)) {
        // Embedded fonts stay embedded: the player already handles data URIs.
        declaredFonts.push(font)
        fontFaces.push(
          `@font-face{font-family:"${font.family}";src:url("${font.src}")${font.weight ? `;font-weight:${font.weight}` : ""}${font.style ? `;font-style:${font.style}` : ""}}`,
        )
        continue
      }
      const relative = await copyMedia(source)
      declaredFonts.push({ ...font, src: `./${relative}` })
      const format = path.extname(relative).toLowerCase().replace(".", "")
      fontFaces.push(
        `@font-face{font-family:"${font.family}";src:url("./${relative}") format("${format === "ttf" ? "truetype" : format === "otf" ? "opentype" : format}")${font.weight ? `;font-weight:${font.weight}` : ""}${font.style ? `;font-style:${font.style}` : ""}}`,
      )
    }
    if (declaredFonts.length) next.fonts = declaredFonts
    await writeFile(path.join(tempDirectory, "composition.json"), JSON.stringify(next, null, 2))

    const runtimeEntry = path.join(packageRoot, "src", "runtime", "browser-entry.ts")
    const result = await Bun.build({
      entrypoints: [runtimeEntry],
      outdir: assetsDirectory,
      target: "browser",
      format: "esm",
      minify: true,
      splitting: false,
      sourcemap: "none",
    })
    if (!result.success)
      throw new Error(result.logs.map((log) => log.message).join("\n") || "Failed to build the interactive runtime")
    const runtimeFile = result.outputs.find((output) => output.path.endsWith(".js"))
    if (!runtimeFile) throw new Error("Browser runtime build produced no JavaScript output")
    const runtimeName = path.basename(runtimeFile.path)
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(next.title)}</title>
<style>
${FONT_FACE_CSS}
${fontFaces.join("\n")}
:root{color-scheme:dark;font-family:"Geist",system-ui,sans-serif;background:#090d15;color:#eef2f8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:min(100%,1280px)}h1{font-size:clamp(18px,3vw,28px);font-weight:600;margin:0 0 16px}
.player{overflow:hidden;border-radius:16px;border:1px solid #263245;box-shadow:0 24px 80px #0008;background:#10131b}
[data-coenx-player]{width:100%;aspect-ratio:${next.stage.width}/${next.stage.height};position:relative}
.controls{display:flex;gap:8px;padding:12px;background:#0d1420}
.controls button{border:1px solid #344257;border-radius:9px;background:#172338;color:#f5f7fb;padding:8px 14px;font:inherit;cursor:pointer}
[data-coenx-player][role=alert]{padding:24px;color:#ffb4b4}
</style>
</head>
<body><main><h1>${escapeHtml(next.title)}</h1><section class="player">
<div data-coenx-player data-renderer="${options.renderer ?? "canvas"}" data-composition="./composition.json" aria-label="${escapeHtml(next.title)}"></div>
<div class="controls"><button type="button" data-coenx-play>Play</button><button type="button" data-coenx-pause>Pause</button></div>
</section></main><script type="module" src="./assets/${runtimeName}"></script></body></html>`
    await writeFile(path.join(tempDirectory, "index.html"), html)
    await writeFile(
      path.join(tempDirectory, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          format: "coenx-interactive",
          title: next.title,
          compositionId: next.id,
          stage: next.stage,
          totalFrames: validated.totalFrames,
          durationSeconds: validated.totalFrames / next.stage.fps,
          assetsCopied: mediaMap.size,
          runtime: `assets/${runtimeName}`,
        },
        null,
        2,
      ),
    )
    await rename(tempDirectory, outputDirectory)
    return {
      outputDirectory,
      compositionFile: path.join(outputDirectory, "composition.json"),
      runtimeFile: path.join(outputDirectory, "assets", runtimeName),
      assetsCopied: mediaMap.size,
      totalFrames: validated.totalFrames,
    } satisfies InteractiveCompileResult
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true })
    throw error
  }
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
