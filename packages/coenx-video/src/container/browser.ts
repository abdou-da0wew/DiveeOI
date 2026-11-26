import type { VideoComposition } from "../model/types"

/**
 * Browser-side .coenx4 reader: parses the PK-ZIP central directory and
 * inflates entries with the standard DecompressionStream API — no node
 * dependencies, so the app can unpack containers straight from base64 file
 * responses. Container layout contract mirrors container/pack.ts.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer: Uint8Array): number {
  let value = 0xffffffff
  for (let index = 0; index < buffer.length; index++) {
    value = CRC_TABLE[(value ^ buffer[index]!) & 0xff]! ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function readUInt16(data: Uint8Array, offset: number) {
  return data[offset]! | (data[offset + 1]! << 8)
}

function readUInt32(data: Uint8Array, offset: number) {
  return (
    (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0
  )
}

function locateEndRecord(data: Uint8Array) {
  for (let index = data.length - 22; index >= Math.max(0, data.length - 22 - 65_560); index--) {
    if (readUInt32(data, index) === 0x06054b50) return index
  }
  throw new Error("Container is not a zip archive (missing end record)")
}

async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot unpack interactive containers (DecompressionStream missing)")
  }
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  const output = new Uint8Array(await new Response(stream).arrayBuffer())
  return output
}

export interface CoenxBrowserEntry {
  name: string
  data: Uint8Array
}

/** Reads every zip entry into memory (bounded by the container contract). */
export async function readZipBrowser(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  const eocdOffset = locateEndRecord(data)
  const count = readUInt16(data, eocdOffset + 10)
  const centralOffset = readUInt32(data, eocdOffset + 16)
  const result = new Map<string, Uint8Array>()
  let cursor = centralOffset
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > data.length || readUInt32(data, cursor) !== 0x02014b50) {
      throw new Error("Container central directory is corrupted")
    }
    const method = readUInt16(data, cursor + 10)
    const compressedSize = readUInt32(data, cursor + 20)
    const nameLength = readUInt16(data, cursor + 28)
    const extraLength = readUInt16(data, cursor + 30)
    const commentLength = readUInt16(data, cursor + 32)
    const localOffset = readUInt32(data, cursor + 42)
    const nameBytes = data.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = new TextDecoder().decode(nameBytes)
    if (readUInt32(data, localOffset) !== 0x04034b50) throw new Error(`Container entry is corrupted: ${name}`)
    const localNameLength = readUInt16(data, localOffset + 26)
    const localExtraLength = readUInt16(data, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = data.subarray(dataStart, dataStart + compressedSize)
    const payload = method === 8 ? await inflateRaw(raw) : raw.slice()
    if (crc32(payload) !== readUInt32(data, cursor + 16)) {
      throw new Error(`Container entry failed the CRC check: ${name}`)
    }
    result.set(name, payload)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return result
}

export interface CoenxContainer {
  manifest: {
    format: string
    version: number
    title: string
    renderer?: string
    media: string[]
    fonts?: Array<{ family: string; file?: string }>
    [key: string]: unknown
  }
  composition: VideoComposition
  assets: Map<string, Uint8Array>
}

export const COMPOSITION_ENTRY = "composition.json"
export const MANIFEST_ENTRY = "coenx.json"

/** Unpacks a .coenx4 container and validates the embedded composition version. */
export async function readCoenxBrowser(data: Uint8Array): Promise<CoenxContainer> {
  const entries = await readZipBrowser(data)
  const compositionEntry = entries.get(COMPOSITION_ENTRY)
  if (!compositionEntry) throw new Error("Container has no embedded composition")
  const manifestEntry = entries.get(MANIFEST_ENTRY)
  const composition = JSON.parse(new TextDecoder().decode(compositionEntry)) as VideoComposition
  if (composition.version !== 1) throw new Error("Unsupported interactive video version")
  const manifest = manifestEntry
    ? (JSON.parse(new TextDecoder().decode(manifestEntry)) as CoenxContainer["manifest"])
    : { format: "coenx", version: 4, title: composition.title, media: [] }
  const assets = new Map<string, Uint8Array>()
  for (const [name, payload] of entries) {
    if (name === COMPOSITION_ENTRY || name === MANIFEST_ENTRY || name.startsWith("player")) continue
    assets.set(name, payload)
  }
  return { manifest, composition, assets }
}
