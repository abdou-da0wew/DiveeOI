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

let current: TlRuntime | null = null

export const setRuntime = (runtime: TlRuntime | null) => {
  current = runtime
}
export const getRuntime = (): TlRuntime | null => current

export const modelDirFor = (dataDir: string) => path.join(dataDir, "models")
/** Directory holding config.json, tokenizer.json and onnx/ for the pinned repo. */
export const modelFilesDir = (r: Pick<TlRuntime, "modelDir" | "manifest">) => path.join(r.modelDir, r.manifest.repo)

/** File name Transformers.js loads for a dtype. */
export const onnxFileFor = (dtype: string) => (dtype === "fp32" ? "model.onnx" : `model_${dtype}.onnx`)
