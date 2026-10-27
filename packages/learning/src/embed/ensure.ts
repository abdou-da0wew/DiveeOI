// packages/learning/src/embed/ensure.ts
//
// Lazily brings up the embedder from the registered runtime and the user's
// settings. Fails with a clear message when Setup has not downloaded the model.

import { existsSync } from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { getRuntime, modelFilesDir, onnxFileFor } from "../runtime"
import { withDefaults } from "../settings/defaults"
import { setTokenizer } from "../chunk"
import { EmbedError, init, type EmbedOptions } from "./pipeline"

type Tree = Record<string, unknown>

export const embedOptionsFrom = (userSettings?: Tree): EmbedOptions => {
  const emb = (withDefaults(userSettings).embedding ?? {}) as Tree
  return {
    dtype: (emb.dtype as EmbedOptions["dtype"]) ?? "int8",
    device: (emb.device as EmbedOptions["device"]) ?? "auto",
    maxLength: Number(emb.maxLength ?? 512),
    batchSize: Number(emb.batchSize ?? 16),
    intraOpThreads: (emb.intraOpThreads as EmbedOptions["intraOpThreads"]) ?? "auto",
    interOpThreads: Number(emb.interOpThreads ?? 1),
  } as EmbedOptions
}

let tokenizerTried = false
const tryTokenizer = async (repo: string) => {
  if (tokenizerTried) return
  tokenizerTried = true
  try {
    const t = await import("@huggingface/transformers")
    const tok: any = await t.AutoTokenizer.from_pretrained(repo)
    setTokenizer({ encode: (text: string) => ({ length: (tok.encode(text) as number[]).length }) })
  } catch {
    // chunk sizing falls back to the character estimate
  }
}

export const ensureEmbedder = (userSettings?: Tree): Effect.Effect<EmbedOptions, EmbedError> =>
  Effect.gen(function* () {
    const runtime = getRuntime()
    if (!runtime) return yield* Effect.fail(new EmbedError({ message: "Targeted Learning is not running." }))
    const options = embedOptionsFrom(userSettings)
    const onnx = path.join(modelFilesDir(runtime), "onnx", onnxFileFor(options.dtype))
    if (!existsSync(onnx)) {
      return yield* Effect.fail(
        new EmbedError({ message: `Embedding model (${options.dtype}) is not downloaded. Run Start Setup first.` }),
      )
    }
    yield* init(
      runtime.modelDir,
      { repo: runtime.manifest.repo, revision: runtime.manifest.revision, dtype: options.dtype, maxLength: options.maxLength },
      options,
    )
    yield* Effect.promise(() => tryTokenizer(runtime.manifest.repo))
    return options
  })
