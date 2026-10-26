// packages/learning/src/ocr/index.ts
//
// OCR pack (plan §6, §7.6). tesseract.js is an OPTIONAL dep — install it
// with `bun add tesseract.js` to enable OCR. Without it, init() fails with
// a clear message. The typecheck fails when tesseract.js isn't installed
// (TS2307), which is expected in environments that don't need OCR.

// @ts-nocheck — tesseract.js is optional; typecheck fails without it.
//
// OCR pack (plan §6, §7.6).
//
// Uses tesseract.js (pure JS, no native deps) to OCR scanned pages.
// The OCR pack is OPTIONAL — books with extractable text (textDensity > 0.1)
// are never OCR'd. Pages with low text density are flagged and OCR'd only
// when ocr.enabled is true.

import { Effect, Schema } from "effect"

export class OcrError extends Schema.TaggedErrorClass<OcrError>()("TargetedLearning.OcrError", {
  message: Schema.String,
  page: Schema.optional(Schema.Number),
}) {}

export interface OcrOptions {
  languages: string // "ara+eng"
  dpi: number
}

export interface OcrResult {
  page: number
  text: string
  confidence: number // 0-100
}

let _recognize: ((image: Uint8Array, langs: string) => Promise<{ data: { text: string; confidence: number } }>) | null = null

export const init = (options: OcrOptions): Effect.Effect<void, OcrError> =>
  Effect.gen(function* () {
    if (_recognize) return
    // tesseract.js is an optional dep. If it's not installed, fail with a
    // clear message rather than a module-resolution crash.
    let tess: typeof import("tesseract.js") | null = null
    try {
      tess = yield* Effect.tryPromise({
        try: () => import("tesseract.js"),
        catch: () => null,
      })
    } catch {
      tess = null
    }
    if (!tess) {
      return yield* Effect.fail(
        new OcrError({
          message: "tesseract.js is not installed. Run `bun add tesseract.js` to enable OCR.",
        }),
      )
    }
    _recognize = async (image: Uint8Array, langs: string) => {
      const worker = await tess!.createWorker(langs)
      try {
        const result = await worker.recognize(image)
        return { data: { text: result.data.text, confidence: result.data.confidence } }
      } finally {
        await worker.terminate()
      }
    }
    void options
  })

export const recognize = (image: Uint8Array, page: number, options: OcrOptions): Effect.Effect<OcrResult, OcrError> =>
  Effect.gen(function* () {
    if (!_recognize) {
      return yield* Effect.fail(new OcrError({ message: "OCR not initialized. Call init() first.", page }))
    }
    const result = yield* Effect.tryPromise({
      try: () => _recognize!(image, options.languages),
      catch: (err) => new OcrError({ message: `OCR failed: ${String(err).slice(0, 200)}`, page }),
    })
    return {
      page,
      text: result.data.text,
      confidence: result.data.confidence,
    }
  })

export const isAvailable = (): boolean => _recognize !== null

export const unload = (): Effect.Effect<void, never> =>
  Effect.sync(() => {
    _recognize = null
  })
