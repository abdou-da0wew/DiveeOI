// packages/learning/src/manifest/types.ts
//
// The manifest is the single source of truth for what to download. It pins
// the Hugging Face repo, the commit SHA, and every file's path, size and
// sha256. The downloader never downloads from `main` — only from a pinned
// SHA (plan §5.2).

import { Schema } from "effect"

export const DType = Schema.Literals(["int8", "q4f16", "fp16", "fp32"])
export type DType = Schema.Schema.Type<typeof DType>

export const ManifestFile = Schema.Struct({
  path: Schema.String.annotate({ description: "Path inside the HF repo" }),
  size: Schema.Number.annotate({ description: "File size in bytes. 0 = unknown (file is pinned by the commit SHA in the URL only)." }),
  sha256: Schema.String.annotate({ description: "Lowercase hex sha256 (LFS hash for LFS files). Empty = unknown." }),
  dtype: Schema.optional(DType).annotate({
    description: "Quantization group this file belongs to (only for model files).",
  }),
  required: Schema.Boolean.annotate({
    description: "If true, downloaded for every install. If false, only when the user picks that dtype.",
  }),
  url: Schema.optional(Schema.String).annotate({
    description: "Absolute download URL (used by non-HF packs such as the OCR language data).",
  }),
})
export type ManifestFile = Schema.Schema.Type<typeof ManifestFile>

export const Manifest = Schema.Struct({
  repo: Schema.String.annotate({ description: "HF repo id, e.g. Xenova/bge-m3" }),
  revision: Schema.String.annotate({
    description: "Pinned commit SHA. NEVER 'main' or a branch name.",
  }),
  endpoint: Schema.String.annotate({ description: "HF endpoint, e.g. https://huggingface.co" }),
  generatedAt: Schema.String.annotate({ description: "ISO timestamp when this manifest was generated" }),
  generatorVersion: Schema.String.annotate({ description: "Manifest generator version (semver)" }),
  files: Schema.Array(ManifestFile),
})
export type Manifest = Schema.Schema.Type<typeof Manifest>

/**
 * The currently pinned revision. Bumped manually after review.
 * When you change this, run `bun run tl:manifest` and commit the regenerated
 * manifest.json alongside the change.
 */
export const PINNED_REVISION = "4de13258303883538bd53b696b452bf8099f0858" // Xenova/bge-m3 main @ 2026-10-27

/** The repo we download the embedding model from. */
export const EMBEDDING_REPO = "Xenova/bge-m3"
