// packages/learning/src/download/index.ts
//
// Plain-HTTPS downloader with:
//   - `.part` files with Range-based resume
//   - stall timeout
//   - exponential backoff + jitter for network errors, 429 and 5xx
//   - sha256 verification
//   - atomic rename on success
//   - proxy environment honored (via fetch's default agent)
//   - configurable endpoint (mirror support)
//   - "Use a local folder" import for offline machines, verified against the
//     same manifest
//
// No git, no `curl | sh`, no pip (plan §5.3).
//
// Implementation note: this uses Node's `fetch` (Bun provides it) wrapped in
// `Effect.tryPromise`. We deliberately do NOT depend on @effect/platform's
// HttpClient here, because (a) the downloader runs outside any Effect context
// (the manifest CLI uses it standalone), and (b) the streaming + resume logic
// is more naturally expressed against the Web Streams API.

import { createHash } from "node:crypto"
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  promises as fsp,
} from "node:fs"
import { dirname, join } from "node:path"
import { Effect, Schema, Duration } from "effect"
import type { Manifest, ManifestFile } from "../manifest/types"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DownloadError extends Schema.TaggedErrorClass<DownloadError>()(
  "TargetedLearning.DownloadError",
  {
    file: Schema.String,
    message: Schema.String,
    attempt: Schema.Number,
    retryable: Schema.Boolean,
  },
) {}

export class HashMismatchError extends Schema.TaggedErrorClass<HashMismatchError>()(
  "TargetedLearning.HashMismatchError",
  {
    file: Schema.String,
    expected: Schema.String,
    actual: Schema.String,
  },
) {}

export class LocalImportError extends Schema.TaggedErrorClass<LocalImportError>()(
  "TargetedLearning.LocalImportError",
  {
    file: Schema.String,
    message: Schema.String,
  },
) {}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DownloadOptions {
  retries: number
  stallTimeoutSec: number
  destDir: string
  endpoint?: string
  maxConcurrent?: number
  onProgress?: (file: ManifestFile, receivedBytes: number, totalBytes: number) => void
}

export interface DownloadManifestOptions extends DownloadOptions {
  dtype?: "int8" | "q4f16" | "fp16" | "fp32"
}

// ---------------------------------------------------------------------------
// sha256 verification
// ---------------------------------------------------------------------------

export const hashFile = (path: string): Effect.Effect<string, never> =>
  Effect.sync(() => {
    const { createReadStream } = require("node:fs") as typeof import("node:fs")
    // Synchronous hash — for the file sizes we deal with (≤2 GB), reading
    // the whole file is fine and avoids stream lifecycle complexity.
    const hash = createHash("sha256")
    try {
      const buf = require("node:fs").readFileSync(path) as Buffer
      hash.update(buf)
      return hash.digest("hex")
    } catch {
      return ""
    }
  })

// ---------------------------------------------------------------------------
// Single-file download with resume + retries
// ---------------------------------------------------------------------------

const sleep = (ms: number) => Effect.sleep(Duration.millis(ms))

interface AttemptResult {
  kind: "success"
  receivedBytes: number
}

const downloadAttempt = async (
  file: ManifestFile,
  destPath: string,
  endpoint: string,
  manifest: Manifest,
  stallTimeoutSec: number,
  onProgress?: DownloadOptions["onProgress"],
): Promise<AttemptResult> => {
  const partPath = `${destPath}.part`
  const resumeFrom = existsSync(partPath) ? statSync(partPath).size : 0

  const headers: Record<string, string> = {}
  if (resumeFrom > 0) headers["range"] = `bytes=${resumeFrom}-`

  const url = `${endpoint}/${manifest.repo}/resolve/${manifest.revision}/${file.path}`

  // Use AbortController for the stall timeout.
  const controller = new AbortController()
  let lastByteTime = Date.now()
  const watchdog = setInterval(() => {
    if (Date.now() - lastByteTime > stallTimeoutSec * 1000) {
      controller.abort()
      clearInterval(watchdog)
    }
  }, 1000)

  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    if (!response.ok && response.status !== 206 && response.status !== 416) {
      const retryable = response.status === 429 || (response.status >= 500 && response.status < 600)
      throw new DownloadError({
        file: file.path,
        message: `HTTP ${response.status}`,
        attempt: 0,
        retryable,
      })
    }
    if (response.status === 416) {
      // Range not satisfiable — already fully downloaded.
      return { kind: "success", receivedBytes: resumeFrom }
    }

    mkdirSync(dirname(partPath), { recursive: true })
    const out = createWriteStream(partPath, { flags: resumeFrom > 0 ? "a" : "w" })

    const totalHeader = response.headers.get("content-length")
    const total = totalHeader ? parseInt(totalHeader, 10) : file.size

    if (!response.body) {
      throw new DownloadError({
        file: file.path,
        message: "no response body",
        attempt: 0,
        retryable: true,
      })
    }

    const reader = response.body.getReader()
    let received = resumeFrom
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.write(value)
      received += value.byteLength
      lastByteTime = Date.now()
      if (onProgress) onProgress(file, received, resumeFrom + total)
    }
    out.end()
    await new Promise<void>((resolve) => out.on("close", resolve))
    return { kind: "success", receivedBytes: received }
  } finally {
    clearInterval(watchdog)
  }
}

const downloadFile = (
  file: ManifestFile,
  destDir: string,
  manifest: Manifest,
  options: DownloadOptions,
): Effect.Effect<void, DownloadError | HashMismatchError> =>
  Effect.gen(function* () {
    const destPath = join(destDir, file.path)
    const endpoint = options.endpoint ?? manifest.endpoint

    // Skip if already present and verified.
    if (existsSync(destPath) && statSync(destPath).size === file.size) {
      const actual = yield* hashFile(destPath)
      if (actual === file.sha256) return
      unlinkSync(destPath)
    }

    let attempt = 0
    while (attempt <= options.retries) {
      const result = yield* Effect.tryPromise({
        try: () => downloadAttempt(file, destPath, endpoint, manifest, options.stallTimeoutSec, options.onProgress),
        catch: (err) =>
          err instanceof DownloadError
            ? err
            : new DownloadError({
                file: file.path,
                message: `network error: ${String(err).slice(0, 200)}`,
                attempt,
                retryable: true,
              }),
      }).pipe(
        Effect.matchEffect({
          onFailure: (err) =>
            Effect.succeed({ _tag: "Left" as const, left: err }) as Effect.Effect<
              { _tag: "Left"; left: DownloadError | HashMismatchError } | { _tag: "Right"; right: AttemptResult }
            >,
          onSuccess: (value) => Effect.succeed({ _tag: "Right" as const, right: value }),
        }),
      )

      if (result._tag === "Right") {
        // Verify size + hash, then atomic rename.
        const partPath = `${destPath}.part`
        if (!existsSync(partPath)) {
          yield* Effect.fail(
            new DownloadError({
              file: file.path,
              message: "part file missing after download",
              attempt,
              retryable: false,
            }),
          )
        }
        const actualSize = statSync(partPath).size
        if (actualSize !== file.size) {
          unlinkSync(partPath)
          if (attempt >= options.retries) {
            yield* Effect.fail(
              new DownloadError({
                file: file.path,
                message: `size mismatch: expected ${file.size}, got ${actualSize}`,
                attempt,
                retryable: false,
              }),
            )
          }
          attempt++
          continue
        }
        const actual = yield* hashFile(partPath)
        if (actual !== file.sha256) {
          // Hash mismatch — retry once, then fail hard (plan §5.5).
          unlinkSync(partPath)
          if (attempt >= options.retries) {
            yield* Effect.fail(
              new HashMismatchError({ file: file.path, expected: file.sha256, actual }),
            )
          }
          attempt++
          continue
        }
        // Atomic rename.
        mkdirSync(dirname(destPath), { recursive: true })
        renameSync(partPath, destPath)
        return
      }

      // Left case — retryable error
      const err = result.left
      if (err instanceof HashMismatchError) {
        yield* Effect.fail(err)
      }
      if (err instanceof DownloadError && !err.retryable) {
        yield* Effect.fail(err)
      }
      // Exponential backoff with jitter.
      const baseMs = Math.min(2 ** attempt * 500, 30_000)
      const jitter = Math.floor(Math.random() * 500)
      yield* sleep(baseMs + jitter)
      attempt++
    }
  })

// ---------------------------------------------------------------------------
// Public: download every file in a manifest, optionally filtered by dtype
// ---------------------------------------------------------------------------

export const downloadManifest = (
  manifest: Manifest,
  options: DownloadManifestOptions,
): Effect.Effect<void, DownloadError | HashMismatchError> =>
  Effect.gen(function* () {
    const dtype = options.dtype ?? "int8"
    const files = manifest.files.filter((f) => f.required || f.dtype === dtype)
    for (const file of files) {
      yield* downloadFile(file, options.destDir, manifest, options)
    }
  })

// ---------------------------------------------------------------------------
// Local folder import (offline machines, plan §5.3 last paragraph)
// ---------------------------------------------------------------------------

export const importFromLocalFolder = (
  manifest: Manifest,
  sourceDir: string,
  destDir: string,
): Effect.Effect<void, LocalImportError> =>
  Effect.gen(function* () {
    for (const file of manifest.files) {
      if (!file.required && file.dtype !== "int8") continue
      const src = join(sourceDir, file.path)
      const dest = join(destDir, file.path)
      if (!existsSync(src)) {
        return yield* Effect.fail(
          new LocalImportError({ file: file.path, message: "missing in local folder" }),
        )
      }
      const stat = statSync(src)
      if (stat.size !== file.size) {
        return yield* Effect.fail(
          new LocalImportError({
            file: file.path,
            message: `size mismatch: expected ${file.size}, got ${stat.size}`,
          }),
        )
      }
      const actual = yield* hashFile(src)
      if (actual !== file.sha256) {
        return yield* Effect.fail(
          new LocalImportError({
            file: file.path,
            message: `sha256 mismatch: expected ${file.sha256}, got ${actual}`,
          }),
        )
      }
      mkdirSync(dirname(dest), { recursive: true })
      yield* Effect.tryPromise({
        try: () => fsp.copyFile(src, dest),
        catch: (err) =>
          new LocalImportError({
            file: file.path,
            message: `copy failed: ${String(err).slice(0, 200)}`,
          }),
      })
    }
  })
