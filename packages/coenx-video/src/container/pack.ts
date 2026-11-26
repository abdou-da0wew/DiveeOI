import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { validateComposition, VideoValidationError, totalFrames } from "../model/validate"
import type { VideoComposition } from "../model/types"
import { resolveMediaSource } from "../render/media-frames"
import { createZip, readZip } from "./zip"

const MAX_CONTAINER_BYTES = 512 * 1024 * 1024
const MAX_SOURCE_BYTES = 64 * 1024 * 1024
export const CONTAINER_FORMAT = "coenx"
export const CONTAINER_VERSION = 4

const EXTENSION_MIME: Record<string, string> = {
  ".png": "image/png",
  ".apng": "image/apng",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

export interface CoenxManifest {
  format: "coenx"
  version: 4
  title: string
  compositionId: string
  stage: VideoComposition["stage"]
  totalFrames: number
  durationSeconds: number
  created: string
  generator: string
  renderer: "canvas" | "svg"
  media: string[]
  fonts: Array<{ family: string; file?: string }>
}

export interface CoenxPackOptions {
  composition: VideoComposition
  projectRoot: string
  outputPath: string
  renderer?: "canvas" | "svg"
  meta?: Record<string, string>
}

function mimeType(file: string) {
  return EXTENSION_MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream"
}

function isDataUri(value: string) {
  return /^data:[a-z]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+$/i.test(value)
}

/** Collects every referenced media source (assets, video/image nodes, audio, fonts). */
function referencedSources(composition: VideoComposition): Array<{ key: string; source: string; kind: "media" | "audio" | "font" }> {
  const sources: Array<{ key: string; source: string; kind: "media" | "audio" | "font" }> = []
  const seen = new Set<string>()
  const push = (key: string, source: string, kind: "media" | "audio" | "font") => {
    if (!source || seen.has(source)) return
    seen.add(source)
    sources.push({ key, source, kind })
  }
  for (const [id, source] of Object.entries(composition.assets ?? {})) push(id, source, "media")
  for (const scene of composition.scenes) {
    for (const node of scene.nodes) {
      if (node.kind === "image" || node.kind === "video") {
        push(node.asset, composition.assets?.[node.asset] ?? node.asset, "media")
      }
    }
  }
  for (const track of composition.audio ?? []) push(track.id, composition.assets?.[track.source] ?? track.source, "audio")
  for (const font of composition.fonts ?? []) push(`font:${font.family}`, composition.assets?.[font.src] ?? font.src, "font")
  return sources
}

/**
 * Builds the .coenx4 zip container: an embedded composition (all media as
 * data URIs), a self-contained standalone player.html, the raw media files
 * for unpacking, and a machine-readable manifest.
 */
export async function packCoenx(options: CoenxPackOptions): Promise<{ outputPath: string; manifest: CoenxManifest; bytes: number }> {
  const projectRoot = await realpath(path.resolve(options.projectRoot))
  const validated = validateComposition(options.composition)
  const outputPath = path.resolve(options.outputPath)
  if (path.extname(outputPath).toLowerCase() !== ".coenx4") {
    throw new Error("Coenx containers must use the .coenx4 extension")
  }
  const renderer = options.renderer ?? "canvas"

  // Resolve every referenced source into bytes + a data URI.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-pack-"))
  try {
    const mediaEntries: Array<{ name: string; data: Buffer; compress?: boolean }> = []
    const dataUris = new Map<string, string>()
    const fontFiles: Array<{ family: string; file?: string }> = []
    const sourceFiles = new Map<string, string>()
    let mediaIndex = 0
    for (const reference of referencedSources(options.composition)) {
      if (isDataUri(reference.source)) {
        const mime = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(reference.source)![1]!.toLowerCase()
        const bytes = Buffer.from(reference.source.replace(/^data:[a-z]+\/[a-z0-9.+-]+;base64,/i, ""), "base64")
        if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error(`Embedded asset exceeds 64 MB: ${reference.key}`)
        dataUris.set(reference.source, reference.source)
        if (reference.kind === "font") {
          fontFiles.push({ family: reference.key.slice(5) })
        } else {
          const extension = Object.entries(EXTENSION_MIME).find(([, value]) => value === mime)?.[0] ?? ".bin"
          mediaEntries.push({ name: `media/embedded-${String(mediaIndex++).padStart(4, "0")}${extension}`, data: bytes })
        }
        continue
      }
      const resolved = await resolveMediaSource(reference.key, reference.source, projectRoot, tempRoot, sourceFiles)
      const bytes = await readFile(resolved.path)
      const mime = resolved.mime === "application/octet-stream" ? mimeType(resolved.path) : resolved.mime
      const dataUri = `data:${mime};base64,${bytes.toString("base64")}`
      dataUris.set(reference.source, dataUri)
      const name = `media/${String(mediaIndex++).padStart(4, "0")}-${path.basename(resolved.path).replace(/^[0-9a-f]{8}-/, "")}`
      mediaEntries.push({ name, data: bytes, compress: false })
      if (reference.kind === "font") fontFiles.push({ family: reference.key.slice(5), file: name })
    }

    // Embed: rewrite the composition to fully self-contained data URIs.
    const embedded: VideoComposition = structuredClone(options.composition)
    for (const [key, value] of Object.entries(embedded.assets ?? {})) {
      embedded.assets![key] = dataUris.get(value) ?? value
    }
    for (const scene of embedded.scenes) {
      for (const node of scene.nodes) {
        if (node.kind === "image" || node.kind === "video") {
          const original = options.composition.assets?.[node.asset] ?? node.asset
          const uri = dataUris.get(original)
          if (uri) embedded.assets![node.asset] = uri
        }
      }
    }
    for (const track of embedded.audio ?? []) {
      const original = options.composition.assets?.[track.source] ?? track.source
      track.source = dataUris.get(original) ?? track.source
    }
    for (const font of embedded.fonts ?? []) {
      const original = options.composition.assets?.[font.src] ?? font.src
      const uri = dataUris.get(original)
      if (uri) font.src = uri
    }

    const fontCss = (embedded.fonts ?? [])
      .filter((font) => font.src.startsWith("data:"))
      .map(
        (font) =>
          `@font-face{font-family:"${font.family}";src:url("${font.src}")${font.weight ? `;font-weight:${font.weight}` : ""}${font.style ? `;font-style:${font.style}` : ""}}`,
      )
      .join("\n")

    const runtime = await Bun.build({
      entrypoints: [path.resolve(import.meta.dir, "standalone-entry.ts")],
      target: "browser",
      format: "esm",
      minify: true,
      splitting: false,
      sourcemap: "none",
    })
    if (!runtime.success) throw new Error(runtime.logs.map((log) => log.message).join("\n") || "Failed to build the standalone player")
    const runtimeText = await runtime.outputs[0]!.text()
    const safeJson = JSON.stringify(embedded).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")
    const playerHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(embedded.title)} - Coenx interactive video</title>
<style>
${fontCss}
:root{color-scheme:dark;font-family:"Geist",system-ui,sans-serif;background:#090d15;color:#eef2f8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:min(100%,1280px)}h1{font-size:clamp(18px,3vw,28px);font-weight:600;margin:0 0 16px}
.player{overflow:hidden;border-radius:16px;border:1px solid #263245;box-shadow:0 24px 80px #0008;background:#10131b}
[data-coenx-player]{width:100%;aspect-ratio:${embedded.stage.width}/${embedded.stage.height};position:relative}
.controls{display:flex;gap:8px;padding:12px;background:#0d1420}
.controls button{border:1px solid #344257;border-radius:9px;background:#172338;color:#f5f7fb;padding:8px 14px;font:inherit;cursor:pointer}
[data-coenx-player][role=alert]{padding:24px;color:#ffb4b4}
</style>
</head>
<body><main><h1>${escapeHtml(embedded.title)}</h1><section class="player">
<div data-coenx-player data-renderer="${renderer}" aria-label="${escapeHtml(embedded.title)}"></div>
<div class="controls"><button type="button" data-coenx-play>Play</button><button type="button" data-coenx-pause>Pause</button></div>
</section></main>
<script>window.__COENX_COMPOSITION__=${safeJson};</script>
<script type="module">${runtimeText.replaceAll("</script", "<\\/script")}</script>
</body></html>`

    const manifest: CoenxManifest = {
      format: CONTAINER_FORMAT,
      version: CONTAINER_VERSION,
      title: embedded.title,
      compositionId: embedded.id,
      stage: embedded.stage,
      totalFrames: validated.totalFrames,
      durationSeconds: validated.totalFrames / embedded.stage.fps,
      created: new Date().toISOString(),
      generator: "coenx-video pack",
      renderer,
      media: mediaEntries.map((entry) => entry.name),
      fonts: fontFiles,
      ...(options.meta ? { meta: options.meta } : {}),
    } as CoenxManifest & { meta?: Record<string, string> }

    const zip = createZip([
      { name: "coenx.json", data: JSON.stringify(manifest, null, 2) },
      { name: "player.html", data: playerHtml },
      { name: "composition.json", data: JSON.stringify(embedded, null, 2) },
      ...mediaEntries,
    ])
    if (zip.length > MAX_CONTAINER_BYTES) throw new Error(`Container exceeds the ${MAX_CONTAINER_BYTES / 1024 / 1024} MB limit`)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, zip)
    return { outputPath, manifest, bytes: zip.length }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function safeEntryName(name: string) {
  if (name.includes("..") || path.isAbsolute(name) || name.endsWith("/")) {
    throw new Error(`Refusing to unpack unsafe container entry: ${name}`)
  }
  return name
}

/** Unpacks a .coenx4 container into a directory (composition.json + media + player). */
export async function unpackCoenx(inputPath: string, outputDirectory: string) {
  const bytes = await readFile(inputPath)
  if (bytes.length > MAX_CONTAINER_BYTES) throw new Error(`Container exceeds the ${MAX_CONTAINER_BYTES / 1024 / 1024} MB limit`)
  const entries = readZip(bytes)
  await mkdir(outputDirectory, { recursive: true })
  for (const [name, data] of entries) {
    const target = path.join(outputDirectory, safeEntryName(name))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, data)
  }
  const manifest = JSON.parse((entries.get("coenx.json") ?? Buffer.from("{}")).toString("utf8")) as CoenxManifest
  return { outputDirectory, manifest, files: entries.size }
}

export interface CoenxValidation {
  ok: boolean
  issues: string[]
  manifest?: CoenxManifest
}

/** Validates a .coenx4 container: manifest, embedded composition, interactivity targets. */
export async function validateCoenx(inputPath: string): Promise<CoenxValidation> {
  const issues: string[] = []
  let manifest: CoenxManifest | undefined
  try {
    const bytes = await readFile(inputPath)
    const entries = readZip(bytes)
    if (!entries.has("coenx.json")) issues.push("container is missing coenx.json")
    if (!entries.has("player.html")) issues.push("container is missing player.html")
    const compositionRaw = entries.get("composition.json")
    const embedded = entries.get("player.html")
    if (embedded) {
      if (!embedded.toString("utf8").includes("__COENX_COMPOSITION__")) issues.push("player.html does not embed the composition")
    }
    if (entries.has("coenx.json")) {
      manifest = JSON.parse(entries.get("coenx.json")!.toString("utf8")) as CoenxManifest
      if (manifest.format !== CONTAINER_FORMAT) issues.push(`unexpected container format: ${manifest.format}`)
      if (manifest.version !== CONTAINER_VERSION) issues.push(`unexpected container version: ${manifest.version}`)
      if (!manifest.stage?.width || !manifest.stage?.height || !manifest.stage?.fps) issues.push("manifest stage is incomplete")
      if (!(manifest.totalFrames > 0)) issues.push("manifest totalFrames must be positive")
      for (const media of manifest.media ?? []) {
        if (!entries.has(media)) issues.push(`manifest references missing media file: ${media}`)
      }
    }
    if (compositionRaw) {
      const composition = JSON.parse(compositionRaw.toString("utf8")) as VideoComposition
      try {
        validateComposition(composition)
      } catch (error) {
        if (error instanceof VideoValidationError) issues.push(...error.issues.slice(0, 25).map((issue) => `composition: ${issue}`))
        else issues.push(`composition validation failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      // Interactive targets must resolve even after container-scene jumps.
      for (const scene of composition.scenes) {
        for (const interaction of scene.interactions ?? []) {
          for (const action of interaction.actions) {
            if (action.type === "goto" && !composition.scenes.some((target) => target.id === action.sceneId)) {
              issues.push(`interaction ${interaction.id} jumps to missing scene ${action.sceneId}`)
            }
            if (action.type === "playAudio" && !(composition.audio ?? []).some((track) => track.id === action.trackId)) {
              issues.push(`interaction ${interaction.id} plays missing audio track ${action.trackId}`)
            }
          }
        }
      }
    } else {
      // The standalone player embeds the composition inline; verify it parses.
      if (embedded) {
        const match = /window\.__COENX_COMPOSITION__=([\s\S]*?);<\/script>/.exec(embedded.toString("utf8"))
        if (!match) issues.push("player.html composition payload is missing or malformed")
        else {
          try {
            const composition = JSON.parse(match[1]!.replaceAll("\\u003c", "<")) as VideoComposition
            try {
              validateComposition(composition)
            } catch (error) {
              if (error instanceof VideoValidationError) issues.push(...error.issues.slice(0, 25).map((issue) => `composition: ${issue}`))
            }
          } catch {
            issues.push("embedded composition is not valid JSON")
          }
        }
      }
    }
    return { ok: issues.length === 0, issues, manifest }
  } catch (error) {
    return { ok: false, issues: [error instanceof Error ? error.message : String(error)] }
  }
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

export { totalFrames }
