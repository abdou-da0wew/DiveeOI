import { createHash } from "node:crypto"
import { copyFile, mkdir, open, readFile, realpath, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { VideoComposition } from "../model/types"
import { resolveImageMagickRuntime } from "./rasterizer"
import { runBuffer } from "./process"

const MAX_SOURCE_BYTES = 64 * 1024 * 1024
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

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function extensionForMime(mime: string) {
  const extensions: Record<string, string> = {
    "image/png": ".png",
    "image/apng": ".apng",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/jxl": ".jxl",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/tiff": ".tiff",
    "image/avif": ".avif",
    "image/heic": ".heic",
    "image/bmp": ".bmp",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
  }
  const extension = extensions[mime.toLowerCase()]
  if (!extension) throw new Error(`Unsupported native image MIME type: ${mime}`)
  return extension
}

async function imageSource(
  asset: string,
  configured: string | undefined,
  projectRoot: string,
  tempRoot: string,
  sourceFiles: Map<string, string>,
): Promise<ImageSource> {
  const value = configured ?? asset
  const data = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(value)
  if (data) {
    const mime = data[1].toLowerCase()
    const extension = extensionForMime(mime)
    const bytes = Buffer.from(data[2].replaceAll(/\s/g, ""), "base64")
    if (!bytes.length || bytes.byteLength > MAX_SOURCE_BYTES) {
      throw new Error(`Native image asset ${asset} exceeds the 64 MB source limit`)
    }
    const identity = createHash("sha256").update(mime).update(bytes).digest("hex")
    let sourcePath = sourceFiles.get(identity)
    if (!sourcePath) {
      sourcePath = path.join(tempRoot, `source-${identity}${extension}`)
      await writeFile(sourcePath, bytes)
      sourceFiles.set(identity, sourcePath)
    }
    return { identity, path: sourcePath, extension }
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || path.isAbsolute(value)) {
    throw new Error(`Native image assets must be local project files: ${asset}`)
  }
  const candidate = path.resolve(projectRoot, value)
  const resolved = await realpath(candidate)
  if (!inside(projectRoot, resolved)) {
    throw new Error(`Native image asset escapes the project root: ${asset}`)
  }
  const extension = path.extname(resolved).toLowerCase()
  if (!IMAGE_FORMATS[extension]) throw new Error(`Unsupported native image file format: ${extension || "unknown"}`)
  const info = await stat(resolved)
  if (!info.isFile()) throw new Error(`Native image asset is not a file: ${asset}`)
  if (info.size <= 0 || info.size > MAX_SOURCE_BYTES) {
    throw new Error(`Native image asset must be between 1 byte and 64 MB: ${asset}`)
  }
  const identity = createHash("sha256").update(`${resolved}: ${info.size}: ${info.mtimeMs}`).digest("hex")
  let sourcePath = sourceFiles.get(identity)
  if (!sourcePath) {
    sourcePath = path.join(tempRoot, `source-${identity}${extension}`)
    await copyFile(resolved, sourcePath)
    sourceFiles.set(identity, sourcePath)
  }
  return { identity, path: sourcePath, extension }
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
