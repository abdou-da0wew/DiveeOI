import { mkdir, open, readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import type { VideoComposition } from "../model/types"
import { resolveImageMagickRuntime } from "./rasterizer"
import { runBuffer } from "./process"
import { resolveMediaSource } from "./media-frames"

const MAX_DECODED_PIXELS = 16_777_216
const MAX_OUTPUT_BYTES = 96 * 1024 * 1024
const MAX_IMAGE_EDGE = 8192
const IMAGE_FORMATS: Record<string, string> = {
  ".png": "PNG",
  ".apng": "PNG",
  ".jpg": "JPEG",
  ".jpeg": "JPEG",
  ".jpe": "JPEG",
  ".webp": "WEBP",
  ".jxl": "JXL",
  ".gif": "GIF",
  ".svg": "SVG",
  ".tif": "TIFF",
  ".tiff": "TIFF",
  ".avif": "AVIF",
  ".heic": "HEIC",
  ".bmp": "BMP",
  ".ico": "ICO",
}

interface ImageSource {
  identity: string
  path: string
  extension: string
}

async function imageSource(
  asset: string,
  configured: string | undefined,
  projectRoot: string,
  tempRoot: string,
  sourceFiles: Map<string, string>,
): Promise<ImageSource> {
  // Shared media source rules: data URIs, tmp: files, absolute paths inside
  // the project root or the OS temp directory, and project-relative files.
  const resolved = await resolveMediaSource(asset, configured, projectRoot, tempRoot, sourceFiles)
  return { identity: resolved.identity, path: resolved.path, extension: resolved.extension }
}

async function isBoundedPng(file: string) {
  const handle = await open(file, "r")
  try {
    const header = Buffer.alloc(24)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead !== header.length || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return false
    }
    const width = header.readUInt32BE(16)
    const height = header.readUInt32BE(20)
    return (
      width > 0 &&
      height > 0 &&
      width <= MAX_IMAGE_EDGE &&
      height <= MAX_IMAGE_EDGE &&
      width * height <= MAX_DECODED_PIXELS
    )
  } finally {
    await handle.close()
  }
}

async function validateSvgAsset(source: ImageSource) {
  if (source.extension !== ".svg") return
  const markup = await readFile(source.path, "utf8")
  const normalized = markup.toLowerCase()
  if (
    normalized.includes("<!doctype") ||
    normalized.includes("<!entity") ||
    normalized.includes("@import") ||
    normalized.includes("<script") ||
    normalized.includes("<foreignobject") ||
    normalized.includes("xml-stylesheet")
  ) {
    throw new Error(`SVG media contains unsupported active or external content: ${source.path}`)
  }
  for (const match of markup.matchAll(/\b(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi)) {
    const reference = match[2].trim()
    if (!reference.startsWith("#")) {
      throw new Error(`SVG media cannot reference external assets: ${reference}`)
    }
  }
  for (const match of markup.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    const reference = match[2].trim()
    if (reference && !reference.startsWith("#")) {
      throw new Error(`SVG media cannot load external resources: ${reference}`)
    }
  }
}

async function decodeWithImageMagick(source: ImageSource, output: string, signal?: AbortSignal) {
  await validateSvgAsset(source)
  const runtime = await resolveImageMagickRuntime()
  const format = IMAGE_FORMATS[source.extension]
  if (!format) throw new Error(`Unsupported native image file format: ${source.extension}`)
  await runBuffer(
    runtime.binary,
    [
      "-limit",
      "memory",
      "256MiB",
      "-limit",
      "map",
      "512MiB",
      "-limit",
      "disk",
      "512MiB",
      "-limit",
      "thread",
      "1",
      "-define",
      "jpeg:size=4096x4096",
      `${format}:${source.path}[0]`,
      "-auto-orient",
      "-strip",
      "-resize",
      "4096x4096>",
      "-depth",
      "8",
      "-define",
      "png:compression-level=1",
      `PNG32:${output}`,
    ],
    { maxOutputBytes: 1024 * 1024, signal, env: runtime.env },
  )
  const result = await stat(output)
  if (result.size <= 0 || result.size > MAX_OUTPUT_BYTES) {
    throw new Error(`Decoded native image exceeds the 96 MB output limit: ${source.path}`)
  }
}

export async function prepareNativeImageAssets(
  composition: VideoComposition,
  projectRoot: string,
  tempRoot: string,
  signal?: AbortSignal,
) {
  const root = await realpath(projectRoot)
  const outputRoot = path.join(tempRoot, "native-assets")
  await mkdir(outputRoot, { recursive: true })
  const decoded = new Map<string, string>()
  const sourceFiles = new Map<string, string>()
  const result = new Map<string, Record<string, string>>()

  for (const scene of composition.scenes) {
    const sceneAssets: Record<string, string> = {}
    for (const node of scene.nodes) {
      if (node.kind !== "image") continue
      if (signal?.aborted) throw new Error("Native image preparation was cancelled")
      const source = await imageSource(node.asset, composition.assets?.[node.asset], root, tempRoot, sourceFiles)
      let output = decoded.get(source.identity)
      if (!output) {
        if (source.extension === ".png" && (await isBoundedPng(source.path))) {
          output = source.path
        } else {
          output = path.join(outputRoot, `${source.identity}.png`)
          await decodeWithImageMagick(source, output, signal)
        }
        decoded.set(source.identity, output)
      }
      sceneAssets[node.id] = output
    }
    if (Object.keys(sceneAssets).length) result.set(scene.id, sceneAssets)
  }
  return result
}
