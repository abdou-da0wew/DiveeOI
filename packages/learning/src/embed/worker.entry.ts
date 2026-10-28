// packages/learning/src/embed/worker.entry.ts
//
// Bun Worker entry (plan §7.7). Spawned by ingest/embed-pool.ts. The worker only embeds; it never
// touches SQLite (the main thread is the single writer).
//
//   Main → Worker: { kind: "init", modelDir, signature, options } | { kind: "embed", batchId, texts } | { kind: "close" }
//   Worker → Main: { kind: "ready" } | { kind: "embedded", batchId, vectors } | { kind: "error", batchId?, message }

import { Effect } from "effect"
import * as Pipeline from "./pipeline"

const scope: any = globalThis

const fail = (message: string, batchId?: number) => scope.postMessage({ kind: "error", batchId, message })

scope.onmessage = async (event: { data: any }) => {
  const msg = event.data
  try {
    if (msg.kind === "init") {
      await Effect.runPromise(Pipeline.init(msg.modelDir, msg.signature, msg.options))
      scope.postMessage({ kind: "ready" })
    } else if (msg.kind === "embed") {
      const vectors: Float32Array[] = await Effect.runPromise(Pipeline.embedBatch(msg.texts))
      scope.postMessage({ kind: "embedded", batchId: msg.batchId, vectors }, vectors.map((v) => v.buffer))
    } else if (msg.kind === "close") {
      await Effect.runPromise(Pipeline.unload())
      scope.postMessage({ kind: "closed" })
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), msg.batchId)
  }
}
