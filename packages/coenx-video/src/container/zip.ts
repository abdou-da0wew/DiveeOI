import { deflateRawSync, inflateRawSync } from "node:zlib"

/**
 * Minimal, dependency-free ZIP container used by the .coenx4 packer.
 * Writes classic PK-ZIP archives (deflate or store) with a central
 * directory, and reads them back. Bounded for container use: no ZIP64,
 * UTF-8 names, no encryption, no multi-disk.
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

export function crc32(buffer: Uint8Array): number {
  let value = 0xffffffff
  for (let index = 0; index < buffer.length; index++) value = CRC_TABLE[(value ^ buffer[index]!) & 0xff]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

export interface ZipEntryInput {
  name: string
  data: Uint8Array | string
  /** Deflate by default; `compress: false` keeps raw bytes (media payloads). */
  compress?: boolean
}

const MAX_NAME_BYTES = 512
const MAX_ENTRIES = 2_000

export function createZip(entries: ZipEntryInput[]): Buffer {
  if (entries.length > MAX_ENTRIES) throw new Error(`Zip containers are limited to ${MAX_ENTRIES} entries`)
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const encoder = new TextEncoder()
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    if (!nameBytes.length || nameBytes.length > MAX_NAME_BYTES) throw new Error(`Invalid zip entry name: ${entry.name}`)
    if (entry.name.endsWith("/")) throw new Error("Directory entries are not needed in coenx containers")
    const data = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : Buffer.from(entry.data)
    const crc = crc32(data)
    let payload = data
    const deflated = deflateRawSync(data, { level: 9 })
    const useDeflate = entry.compress === false ? false : deflated.length < data.length
    if (useDeflate) payload = deflated
    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(useDeflate ? 8 : 0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.forEach((byte, index) => {
      local[30 + index] = byte
    })
    chunks.push(local, payload)
    const dir = Buffer.alloc(46 + nameBytes.length)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(useDeflate ? 8 : 0, 10)
    dir.writeUInt16LE(0, 12)
    dir.writeUInt16LE(0x21, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(payload.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBytes.length, 28)
    dir.writeUInt16LE(0, 30)
    dir.writeUInt16LE(0, 32)
    dir.writeUInt16LE(0, 34)
    dir.writeUInt16LE(0, 36)
    dir.writeUInt32LE(0, 38)
    dir.writeUInt32LE(offset, 42)
    nameBytes.forEach((byte, index) => {
      dir[46 + index] = byte
    })
    central.push(dir)
    offset += local.length + payload.length
  }
  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, centralBuffer, end])
}

export interface ZipEntryOutput {
  name: string
  data: Buffer
}

function locateEndRecord(buffer: Buffer) {
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 22 - 65_560); index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return index
  }
  throw new Error("Container is not a zip archive (missing end record)")
}

export function readZip(buffer: Buffer): Map<string, Buffer> {
  const eocdOffset = locateEndRecord(buffer)
  const count = buffer.readUInt16LE(eocdOffset + 10)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  const result = new Map<string, Buffer>()
  let cursor = centralOffset
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Container central directory is corrupted")
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8")
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Container entry is corrupted: ${name}`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw)
    if (crc32(data) !== buffer.readUInt32LE(cursor + 16)) {
      throw new Error(`Container entry failed the CRC check: ${name}`)
    }
    result.set(name, data)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return result
}
