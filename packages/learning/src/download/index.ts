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
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  lstatSync,
  realpathSync,
  promises as fsp,
} from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { Effect, Schema, Duration } from "effect"
import type { Manifest, ManifestFile } from "../manifest/types"
import { diagnosticsEnabled, logDiagnostic, withDiagnosticEffect, type DiagnosticOperation } from "../diagnostics"

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
  signal?: AbortSignal
  onProgress?: (file: ManifestFile, receivedBytes: number, totalBytes: number) => void
}

export interface DownloadManifestOptions extends DownloadOptions {
  dtype?: "int8" | "q4f16" | "fp16" | "fp32"
}

// ---------------------------------------------------------------------------
// sha256 verification
// ---------------------------------------------------------------------------

export const hashFile = (path: string): Effect.Effect<string, never> =>
  Effect.promise(
    () =>
      new Promise<string>((resolve) => {
        const hash = createHash("sha256")
        const stream = createReadStream(path)
        stream.on("data", (chunk) => hash.update(chunk))
        stream.on("end", () => resolve(hash.digest("hex")))
        stream.on("error", () => resolve(""))
      }),
  )

/** A manifest entry with size 0 / empty sha256 is pinned by the commit SHA only. */
const hasSize = (f: ManifestFile) => f.size > 0
const hasHash = (f: ManifestFile) => f.sha256 !== ""
const withScheme = (endpoint: string) => (/^https?:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`).replace(/\/+$/, "")

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
  signal?: AbortSignal,
  onDiagnosticProgress?: (receivedBytes: number, totalBytes: number) => void,
): Promise<AttemptResult> => {
  const partPath = `${destPath}.part`
  const resumeFrom = existsSync(partPath) ? statSync(partPath).size : 0

  const headers: Record<string, string> = {}
  if (resumeFrom > 0) headers["range"] = `bytes=${resumeFrom}-`

  const url = file.url ?? `${withScheme(endpoint)}/${manifest.repo}/resolve/${manifest.revision}/${file.path}`

  // Use AbortController for the stall timeout.
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(signal?.reason)
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener("abort", abortFromCaller, { once: true })
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
    // A 200 in reply to a Range request means the server ignored the range and is sending the
    // whole file: truncate and start over instead of appending (would corrupt the file).
    const baseline = resumeFrom > 0 && response.status === 206 ? resumeFrom : 0
    const out = createWriteStream(partPath, { flags: baseline > 0 ? "a" : "w" })

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
    let received = baseline
    let lastDiagnosticProgressAt = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", resolve))
        received += value.byteLength
        lastByteTime = Date.now()
        const now = Date.now()
        onProgress?.(file, received, baseline + total)
        if (
          (now - lastDiagnosticProgressAt >= 1_000 || received >= baseline + total) &&
          diagnosticsEnabled("download")
        ) {
          lastDiagnosticProgressAt = now
          const totalBytes = baseline + total
          const percent = totalBytes > 0 ? Math.floor((received / totalBytes) * 100) : undefined
          logDiagnostic(
            "download",
            "file.progress",
            { file: file.path, receivedBytes: received, totalBytes, percent },
            "trace",
          )
          onDiagnosticProgress?.(received, totalBytes)
        }
      }
    } catch (err) {
      out.destroy()
      throw err
    }
    out.end()
    await new Promise<void>((resolve) => out.on("close", resolve))
    return { kind: "success", receivedBytes: received }
  } finally {
    clearInterval(watchdog)
    signal?.removeEventListener("abort", abortFromCaller)
  }
}

const downloadFile = (
  file: ManifestFile,
  destDir: string,
  manifest: Manifest,
  options: DownloadOptions,
): Effect.Effect<void, DownloadError | HashMismatchError> => {
  let diagnostic: DiagnosticOperation | undefined
  const effect = Effect.gen(function* () {
    const destPath = join(destDir, file.path)
    const endpoint = options.endpoint ?? manifest.endpoint

    // Skip if already present and verified.
    if (existsSync(destPath) && statSync(destPath).size > 0 && (!hasSize(file) || statSync(destPath).size === file.size)) {
      const existingSize = statSync(destPath).size
      if (!hasHash(file)) {
        yield* Effect.sync(() =>
          logDiagnostic(
            "download",
            "file.skipped",
            { file: file.path, reason: "present-without-hash", sizeBytes: existingSize },
            "info",
          ),
        )
        return
      }
      const actual = yield* hashFile(destPath)
      if (actual === file.sha256) {
        yield* Effect.sync(() =>
          logDiagnostic(
            "download",
            "file.skipped",
            { file: file.path, reason: "already-verified", sizeBytes: existingSize },
            "info",
          ),
        )
        return
      }
      yield* Effect.sync(() =>
        logDiagnostic(
          "download",
          "file.hash-mismatch",
          { file: file.path, expected: file.sha256, actual, source: "existing-file" },
          "warn",
        ),
      )
      unlinkSync(destPath)
    }

    let attempt = 0
    while (attempt <= options.retries) {
      yield* Effect.sync(() =>
        logDiagnostic("download", "attempt.start", { file: file.path, attempt }, "info"),
      )
      const result = yield* Effect.tryPromise({
        try: () =>
          downloadAttempt(
            file,
            destPath,
            endpoint,
            manifest,
            options.stallTimeoutSec,
            options.onProgress,
            options.signal,
            (receivedBytes, totalBytes) =>
              diagnostic?.progress("file.transfer", { file: file.path, receivedBytes, totalBytes }),
          ),
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
        if (actualSize === 0 || (hasSize(file) && actualSize !== file.size)) {
          yield* Effect.sync(() =>
            logDiagnostic(
              "download",
              "file.size-mismatch",
              { file: file.path, expectedBytes: file.size, actualBytes: actualSize, attempt },
              "warn",
            ),
          )
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
        if (hasHash(file)) {
          yield* Effect.sync(() =>
            logDiagnostic("download", "file.hash-verification", { file: file.path, sizeBytes: actualSize }, "trace"),
          )
        }
        const actual = hasHash(file) ? yield* hashFile(partPath) : ""
        if (hasHash(file) && actual !== file.sha256) {
          // Hash mismatch — retry once, then fail hard (plan §5.5).
          yield* Effect.sync(() =>
            logDiagnostic(
              "download",
              "file.hash-mismatch",
              { file: file.path, expected: file.sha256, actual, attempt },
              "warn",
            ),
          )
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
        yield* Effect.sync(() =>
          logDiagnostic("download", "file.verified", { file: file.path, sizeBytes: actualSize }, "info"),
        )
        return
      }

      // Left case — retryable error
      const err = result.left
      yield* Effect.sync(() =>
        logDiagnostic(
          "download",
          "attempt.error",
          { file: file.path, attempt, error: err },
          err instanceof DownloadError && !err.retryable ? "error" : "warn",
        ),
      )
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
  return withDiagnosticEffect(
    "download",
    `file.${file.path}`,
    { file: file.path, sizeBytes: file.size },
    effect,
    (operation) => {
      diagnostic = operation
    },
  )
}

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

const withinRoot = (root: string, candidate: string) => {
  const rel = relative(root, candidate)
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

const containedPath = (root: string, candidate: string) => candidate !== root && withinRoot(root, candidate)

const safeManifestPath = (value: string) =>
  value.length > 0 &&
  !isAbsolute(value) &&
  !/^[a-zA-Z]:/.test(value) &&
  !value.split(/[\\/]/).some((segment) => segment === "" || segment === "." || segment === "..")

export const importFromLocalFolder = (
  manifest: Manifest,
  sourceDir: string,
  destDir: string,
  dtype?: "int8" | "q4f16" | "fp16" | "fp32",
): Effect.Effect<void, LocalImportError> =>
  Effect.gen(function* () {
    let sourceRoot: string
    let destRoot: string
    try {
      sourceRoot = realpathSync(sourceDir)
      mkdirSync(destDir, { recursive: true })
      destRoot = realpathSync(destDir)
    } catch (error) {
      return yield* Effect.fail(
        new LocalImportError({ file: "", message: `source or destination folder is unavailable: ${String(error).slice(0, 200)}` }),
      )
    }

    for (const file of manifest.files) {
      if (!file.required && file.dtype !== (dtype ?? "int8")) continue
      if (!safeManifestPath(file.path)) {
        return yield* Effect.fail(new LocalImportError({ file: file.path, message: "unsafe path in model manifest" }))
      }

      const srcCandidate = resolve(sourceRoot, file.path)
      const destCandidate = resolve(destRoot, file.path)
      if (!containedPath(sourceRoot, srcCandidate) || !containedPath(destRoot, destCandidate)) {
        return yield* Effect.fail(new LocalImportError({ file: file.path, message: "path escapes the import directory" }))
      }

      let src: string
      try {
        src = realpathSync(srcCandidate)
      } catch {
        return yield* Effect.fail(new LocalImportError({ file: file.path, message: "missing in local folder" }))
      }
      if (!containedPath(sourceRoot, src)) {
        return yield* Effect.fail(new LocalImportError({ file: file.path, message: "source symlink escapes the selected folder" }))
      }
      const stat = statSync(src)
      if (!stat.isFile()) {
        return yield* Effect.fail(new LocalImportError({ file: file.path, message: "source is not a regular file" }))
      }
      if (hasSize(file) && stat.size !== file.size) {
        return yield* Effect.fail(
          new LocalImportError({
            file: file.path,
            message: `size mismatch: expected ${file.size}, got ${stat.size}`,
          }),
        )
      }
      const actual = hasHash(file) ? yield* hashFile(src) : ""
      if (hasHash(file) && actual !== file.sha256) {
        return yield* Effect.fail(
          new LocalImportError({
            file: file.path,
            message: `sha256 mismatch: expected ${file.sha256}, got ${actual}`,
          }),
        )
      }

      let dest: string
      try {
        mkdirSync(dirname(destCandidate), { recursive: true })
        const parent = realpathSync(dirname(destCandidate))
        if (!withinRoot(destRoot, parent)) {
          return yield* Effect.fail(new LocalImportError({ file: file.path, message: "destination symlink escapes the model directory" }))
        }
        dest = join(parent, basename(destCandidate))
        if (!containedPath(destRoot, dest)) {
          return yield* Effect.fail(new LocalImportError({ file: file.path, message: "destination path escapes the model directory" }))
        }
        try {
          const existing = lstatSync(dest)
          if (existing.isSymbolicLink() || !existing.isFile()) {
            return yield* Effect.fail(new LocalImportError({ file: file.path, message: "destination is not a regular file" }))
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
      } catch (error) {
        return yield* Effect.fail(
          new LocalImportError({ file: file.path, message: `destination is unavailable: ${String(error).slice(0, 200)}` }),
        )
      }

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

// ---------------------------------------------------------------------------
// Verify (setup step 4): every needed file exists, has the pinned size and sha256.
// ---------------------------------------------------------------------------

export const verifyManifestFiles = (
  manifest: Manifest,
  destDir: string,
  dtype: "int8" | "q4f16" | "fp16" | "fp32" = "int8",
  mode: "size" | "hash" = "hash",
): Effect.Effect<{ checked: number; problems: string[] }, never> =>
  Effect.gen(function* () {
    const problems: string[] = []
    let checked = 0
    for (const file of manifest.files) {
      if (!file.required && file.dtype !== dtype) continue
      checked++
      const p = join(destDir, file.path)
      if (!existsSync(p)) {
        problems.push(`${file.path}: missing`)
        continue
      }
      const size = statSync(p).size
      if (size === 0 || (hasSize(file) && size !== file.size)) {
        problems.push(`${file.path}: size ${size}${hasSize(file) ? ` (expected ${file.size})` : ""}`)
        continue
      }
      if (mode === "hash" && hasHash(file)) {
        const actual = yield* hashFile(p)
        if (actual !== file.sha256) problems.push(`${file.path}: sha256 mismatch`)
      }
    }
    return { checked, problems }
  })
