// packages/learning/src/manifest/generator.ts
//
// `bun run tl:manifest` calls this. It fetches the Hugging Face tree API
// for the pinned revision, walks every file, records path + size + sha256,
// classifies dtype, and writes manifest.json next to this package.
//
// We never download from `main` (plan §5.2). The PINNED_REVISION in types.ts
// is the source of the SHA; bumping it and re-running this script is the
// only supported way to change model versions.
//
// Implementation note: this uses Node's `fetch` directly wrapped in
// `Effect.tryPromise`. The manifest generator is a CLI-only tool, so we
// deliberately avoid depending on @effect/platform's HttpClient.

import { Effect } from "effect"
import { Manifest, type ManifestFile, EMBEDDING_REPO, PINNED_REVISION } from "./types"

// Model file classification — which dtype group does each ONNX file belong to.
const DTYPE_BY_FILENAME: Record<string, ManifestFile["dtype"]> = {
  "onnx/model_int8.onnx": "int8",
  "onnx/model_q4f16.onnx": "q4f16",
  "onnx/model_fp16.onnx": "fp16",
  "onnx/model.onnx": "fp32",
  "onnx/model.onnx_data": "fp32",
}

// Files that are required for every install regardless of dtype.
const REQUIRED_PATTERNS = [
  /^tokenizer\.json$/,
  /^tokenizer_config\.json$/,
  /^config\.json$/,
  /^special_tokens_map\.json$/,
  /^vocab\.txt$/,
  /^spm\.model$/,
  /^tokenizer\.js$/,
  /^onnx\/model_int8\.onnx$/, // int8 is the default dtype
]

const isRequired = (path: string, dtype: ManifestFile["dtype"]): boolean =>
  dtype === "int8" || REQUIRED_PATTERNS.some((re) => re.test(path))

interface HfTreeEntry {
  path: string
  size: number
  lfs?: { sha256: string }
  blobId?: string
  type?: string
}

interface HfSiblingsResponse {
  siblings?: { rfilename: string; size: number; blobId: string }[]
}

/**
 * Fetch the file tree for a pinned revision using the HF tree API.
 * GET https://huggingface.co/api/{repo}/tree/{sha}?recursive=true
 */
const fetchTree = (repo: string, sha: string, endpoint: string): Effect.Effect<ManifestFile[], unknown> =>
  Effect.gen(function* () {
    const url = `${endpoint}/api/${repo}/tree/${sha}?recursive=true`
    const response = yield* Effect.tryPromise({
      try: () => fetch(url),
      catch: (err) => new Error(`tree API fetch failed: ${String(err).slice(0, 200)}`),
    })
    if (!response.ok) {
      return yield* Effect.die(`HF tree API ${response.status}`)
    }
    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<HfTreeEntry[]>,
      catch: (err) => new Error(`tree API json parse failed: ${String(err).slice(0, 200)}`),
    })
    return data
      .filter((entry) => entry.type !== "directory" && entry.path && entry.size !== undefined)
      .map((entry) => {
        const dtype = DTYPE_BY_FILENAME[entry.path]
        const sha256 = entry.lfs?.sha256 ?? entry.blobId ?? ""
        return {
          path: entry.path,
          size: entry.size,
          sha256,
          dtype,
          required: isRequired(entry.path, dtype),
        } satisfies ManifestFile
      })
  })

/**
 * Fallback path: if the tree API does not return blob IDs, fall back to the
 * siblings API. Slower; used as a safety net.
 */
const fetchFromSiblings = (repo: string, sha: string, endpoint: string): Effect.Effect<ManifestFile[], unknown> =>
  Effect.gen(function* () {
    const url = `${endpoint}/api/${repo}/revision/${sha}`
    const response = yield* Effect.tryPromise({
      try: () => fetch(url),
      catch: (err) => new Error(`siblings API fetch failed: ${String(err).slice(0, 200)}`),
    })
    if (!response.ok) return yield* Effect.die(`HF siblings API ${response.status}`)
    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<HfSiblingsResponse>,
      catch: (err) => new Error(`siblings API json parse failed: ${String(err).slice(0, 200)}`),
    })
    return (data.siblings ?? []).map((sibling) => {
      const dtype = DTYPE_BY_FILENAME[sibling.rfilename]
      return {
        path: sibling.rfilename,
        size: sibling.size,
        sha256: sibling.blobId,
        dtype,
        required: isRequired(sibling.rfilename, dtype),
      } satisfies ManifestFile
    })
  })

/**
 * Build the manifest. Tries the tree API first, falls back to siblings.
 */
export const buildManifest = (opts?: {
  repo?: string
  revision?: string
  endpoint?: string
}): Effect.Effect<Manifest, unknown> =>
  Effect.gen(function* () {
    const repo = opts?.repo ?? EMBEDDING_REPO
    const revision = opts?.revision ?? PINNED_REVISION
    const endpoint = opts?.endpoint ?? "https://huggingface.co"

    let files: ManifestFile[] = []
    const treeResult = yield* fetchTree(repo, revision, endpoint).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.succeed([] as ManifestFile[]),
        onSuccess: (value) => Effect.succeed(value),
      }),
    )
    files = treeResult
    if (files.length === 0) {
      files = yield* fetchFromSiblings(repo, revision, endpoint).pipe(
        Effect.orElseSucceed(() => [] as ManifestFile[]),
      )
    }

    if (files.length === 0) {
      return yield* Effect.die(`Manifest for ${repo}@${revision} is empty — check the SHA and network`)
    }

    return Manifest.make({
      repo,
      revision,
      endpoint,
      generatedAt: new Date().toISOString(),
      generatorVersion: "1.0.0",
      files,
    })
  })
