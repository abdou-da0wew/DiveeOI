// packages/learning/src/runtime.ts
//
// Process-wide handle to the live Targeted Learning runtime. The Effect layer
// registers itself here so code that runs outside the layer graph (the session
// prompt loop, the background ingest queue) can reach the books store and the
// model directory without adding a service requirement to SessionPrompt.

import path from "node:path"
import type { BooksStoreInterface } from "./store"
import type { Manifest } from "./manifest/types"

export interface TlRuntime {
  dataDir: string
  /** Transformers.js localModelPath. Model files live in <modelDir>/<repo>/. */
  modelDir: string
  booksStore: BooksStoreInterface
  manifest: Manifest
}

// Package subpath imports (for example "@diveeoi/learning/runtime") and relative
// imports can be emitted as separate chunks by the compiled Bun server. A module-local
// singleton then splits: the HTTP service registers one copy while session/turn reads
// another and incorrectly concludes Targeted Learning is not running. Keep this tiny
// registry on globalThis so every resolved copy in this process shares the same state.
const RUNTIME_GLOBAL_KEY = "__diveeoi_targeted_learning_runtime_v1__" as const

interface RuntimeRegistry {
  runtime: TlRuntime | null
  userSettings: Record<string, unknown> | undefined
}

type RuntimeGlobal = typeof globalThis & {
  [RUNTIME_GLOBAL_KEY]?: RuntimeRegistry
}

const root = globalThis as RuntimeGlobal
const registry =
  root[RUNTIME_GLOBAL_KEY] ??
  (root[RUNTIME_GLOBAL_KEY] = {
    runtime: null,
    userSettings: undefined,
  })

export const setRuntime = (runtime: TlRuntime | null) => {
  registry.runtime = runtime
}
export const getRuntime = (): TlRuntime | null => root[RUNTIME_GLOBAL_KEY]?.runtime ?? null

export const modelDirFor = (dataDir: string) => path.join(dataDir, "models")
/** Directory holding config.json, tokenizer.json and onnx/ for the pinned repo. */
export const modelFilesDir = (r: Pick<TlRuntime, "modelDir" | "manifest">) => path.join(r.modelDir, r.manifest.repo)

/** File name Transformers.js loads for a dtype. */
export const onnxFileFor = (dtype: string) => (dtype === "fp32" ? "model.onnx" : `model_${dtype}.onnx`)

/** The user's `targetedLearning` config, refreshed each turn by the session loop so tools see current settings. */
export const setUserSettings = (s: Record<string, unknown> | undefined) => {
  registry.userSettings = s
}
export const getUserSettings = () => root[RUNTIME_GLOBAL_KEY]?.userSettings
