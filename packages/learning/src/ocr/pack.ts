// packages/learning/src/ocr/pack.ts
//
// The OCR pack (plan §6, §7.6): Tesseract language data, pinned by commit + size + sha256 and
// fetched with the same resumable, verified downloader as the model. Downloaded on demand the
// first time a scanned book is indexed with ocr.enabled, never at install time.

import path from "node:path"
import { Effect } from "effect"
import { downloadManifest } from "../download"
import type { Manifest } from "../manifest/types"

const REVISION = "87416418657359cb625c412a48b6e1d6d41c29bd" // tesseract-ocr/tessdata_fast

const PACK: Record<string, { size: number; sha256: string }> = {
  ara: { size: 1432056, sha256: "e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729" },
  eng: { size: 4113088, sha256: "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2" },
}

export const ocrDir = (dataDir: string) => path.join(dataDir, "ocr")
export const SUPPORTED_OCR_LANGUAGES = Object.keys(PACK)

export const ocrPackManifest = (languages: string[]): Manifest => ({
  repo: "tesseract-ocr/tessdata_fast",
  revision: REVISION,
  endpoint: "https://raw.githubusercontent.com",
  generatedAt: "2026-10-28T00:00:00.000Z",
  generatorVersion: "pinned-1",
  files: languages.map((lang) => ({
    path: `${lang}.traineddata`,
    size: PACK[lang]!.size,
    sha256: PACK[lang]!.sha256,
    required: true,
    url: `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${REVISION}/${lang}.traineddata`,
  })),
})

/** "ara+eng" → ["ara","eng"]; rejects languages we have no pinned data for. */
export const parseLanguages = (spec: string): string[] => {
  const langs = spec.split("+").map((l) => l.trim()).filter(Boolean)
  const unknown = langs.filter((l) => !PACK[l])
  if (langs.length === 0 || unknown.length > 0) {
    throw new Error(`OCR language(s) not supported: ${unknown.join(", ") || spec}. Supported: ${SUPPORTED_OCR_LANGUAGES.join(", ")}.`)
  }
  return langs
}

export const ensureOcrPack = (dataDir: string, languages: string[], retries = 6, stallTimeoutSec = 30) =>
  downloadManifest(ocrPackManifest(languages), { destDir: ocrDir(dataDir), retries, stallTimeoutSec })
