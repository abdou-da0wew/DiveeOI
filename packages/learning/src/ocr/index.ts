// packages/learning/src/ocr/index.ts
//
// OCR for scanned PDF pages (plan §6, §7.6): pdf.js hands over the page image, Tesseract
// (WASM, tesseract.js) reads it with LOCAL language data from the OCR pack, so nothing is fetched
// from a CDN at run time. tesseract.js and @napi-rs/canvas are optional dependencies; without them
// the call fails with a clear message and the book is marked failed, not silently empty.

import { existsSync } from "node:fs"
import { deflateSync } from "node:zlib"
import path from "node:path"
import { ocrDir, parseLanguages } from "./pack"

export interface OcrOptions {
  languages: string // "ara+eng"
  dpi: number
  dataDir: string
}

export interface OcrPageResult {
  page: number
  text: string
  confidence: number // 0-100
}

/** Pages whose extracted text is shorter than this are treated as scanned (no text layer). */
export const SCANNED_PAGE_MIN_CHARS = 25

// --- PNG encoding (8-bit grayscale) without any native dependency -------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf: Uint8Array) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Uint8Array) => {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, "ascii")
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
export const encodeGrayPng = (gray: Uint8Array, width: number, height: number): Uint8Array => {
  const raw = Buffer.alloc((width + 1) * height) // each row starts with filter byte 0
  for (let y = 0; y < height; y++) Buffer.from(gray.buffer, gray.byteOffset + y * width, width).copy(raw, y * (width + 1) + 1)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]),
  )
}

interface PdfImage {
  width: number
  height: number
  kind: number // 1 = 1bpp gray, 2 = RGB 24bpp, 3 = RGBA 32bpp (pdf.js ImageKind)
  data: Uint8Array | Uint8ClampedArray
}

const toGray = (img: PdfImage): Uint8Array => {
  const { width, height, kind, data } = img
  const out = new Uint8Array(width * height)
  if (kind === 2 || kind === 3) {
    const step = kind === 2 ? 3 : 4
    for (let i = 0, p = 0; i < out.length; i++, p += step) out[i] = (data[p]! * 299 + data[p + 1]! * 587 + data[p + 2]! * 114) / 1000
  } else {
    const rowBytes = Math.ceil(width / 8)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) out[y * width + x] = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0
    }
  }
  return out
}

/**
 * The page image of a scanned PDF page, as PNG. Scanned books store each page as one big image, so
 * we read that image straight out of the PDF instead of rendering the page (rendering needs a
 * native canvas, which crashes Bun in some setups). Returns null for a page without an image.
 */
export const extractPageImagePng = async (pdfjs: any, doc: any, pageNumber: number): Promise<Uint8Array | null> => {
  const page = await doc.getPage(pageNumber)
  try {
    const ops = await page.getOperatorList()
    const { OPS } = pdfjs
    let best: PdfImage | null = null
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      let img: PdfImage | undefined
      if (fn === OPS.paintImageXObject) {
        const name = ops.argsArray[i][0] as string
        img = await new Promise<PdfImage | undefined>((resolve) => {
          const t = setTimeout(() => resolve(undefined), 10_000)
          page.objs.get(name, (o: PdfImage) => {
            clearTimeout(t)
            resolve(o)
          })
        })
      } else if (fn === OPS.paintInlineImageXObject) {
        img = ops.argsArray[i][0] as PdfImage
      }
      if (img?.data && img.width * img.height > (best ? best.width * best.height : 0)) best = img
    }
    if (!best) return null
    return encodeGrayPng(toGray(best), best.width, best.height)
  } finally {
    page.cleanup?.()
  }
}

/**
 * OCR the given 1-based pages of a PDF. One Tesseract worker is reused for every page.
 * `onProgress(done, total)` lets the caller report progress.
 */
export const ocrPdfPages = async (
  pdf: Uint8Array,
  pages: number[],
  options: OcrOptions,
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<OcrPageResult[]> => {
  if (pages.length === 0) return []
  const langs = parseLanguages(options.languages)
  const langPath = ocrDir(options.dataDir)
  for (const lang of langs) {
    if (!existsSync(path.join(langPath, `${lang}.traineddata`))) {
      throw new Error(`OCR language data for "${lang}" is not downloaded.`)
    }
  }

  let tess: typeof import("tesseract.js")
  let pdfjs: typeof import("pdfjs-dist")
  try {
    tess = await import("tesseract.js")
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string)
  } catch {
    throw new Error("OCR needs the optional packages tesseract.js and pdfjs-dist. Install them to enable OCR.")
  }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, isEvalSupported: false }).promise
  const worker = await tess.createWorker(langs.join("+"), 1, {
    langPath,
    gzip: false,
    cacheMethod: "none",
  } as any)
  const results: OcrPageResult[] = []
  try {
    for (let i = 0; i < pages.length; i++) {
      const png = await extractPageImagePng(pdfjs, doc, pages[i]!)
      if (png) {
        const { data } = await worker.recognize(Buffer.from(png))
        results.push({ page: pages[i]!, text: data.text, confidence: data.confidence })
      } else {
        results.push({ page: pages[i]!, text: "", confidence: 0 })
      }
      await onProgress?.(i + 1, pages.length)
    }
  } finally {
    await worker.terminate()
    await doc.destroy?.()
  }
  return results
}
