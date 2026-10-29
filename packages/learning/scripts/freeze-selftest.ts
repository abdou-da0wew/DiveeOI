// Freeze the reference embeddings used by the Targeted Learning golden self-test.
// Run only after the pinned int8 model has been installed by Setup:
//   bun run tl:selftest:freeze

import { Effect } from "effect"
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Global } from "@diveeoi/db/global"
import { ensureEmbedder } from "../src/embed/ensure"
import * as Pipeline from "../src/embed/pipeline"
import { modelDirFor, setRuntime } from "../src/runtime"
import { PINNED_MANIFEST } from "../src/manifest/pinned"
import { vectorToB64 } from "../src/self-test"
import type { BooksStoreInterface } from "../src/store"

const dataDir = process.env.DIVEEOI_TL_DATA_DIR ?? join(Global.Path.data, "targeted-learning")
const modelDir = modelDirFor(dataDir)
const fixturePath = fileURLToPath(new URL("../src/self-test/golden.json", import.meta.url))
const tempPath = `${fixturePath}.tmp`
const store: BooksStoreInterface = {
  db: null,
  available: false,
  unavailabilityReason: "golden-vector generation does not need books.db",
}

interface FixtureCase {
  id: string
  text: string
  language: "ar" | "en"
  referenceVectorB64: string
  closerTo?: string
  furtherFrom?: string
}

const run = async () => {
  const current = JSON.parse(readFileSync(fixturePath, "utf8")) as { schemaVersion: number; cases: FixtureCase[] }
  if (current.schemaVersion !== 1 || !Array.isArray(current.cases) || current.cases.length === 0) {
    throw new Error("Invalid golden fixture; refusing to freeze vectors")
  }

  setRuntime({ dataDir, modelDir, booksStore: store, manifest: PINNED_MANIFEST })
  await Effect.runPromise(ensureEmbedder({ embedding: { dtype: "int8", device: "cpu" } }))
  try {
    const cases: FixtureCase[] = []
    for (const item of current.cases) {
      const vector = await Effect.runPromise(Pipeline.embed(item.text))
      if (vector.length !== 1024) {
        throw new Error(`Expected a 1024-dimensional vector for ${item.id}, received ${vector.length}`)
      }
      cases.push({ ...item, referenceVectorB64: vectorToB64(vector) })
      console.log(`Frozen ${item.id}`)
    }

    const output = {
      schemaVersion: 1,
      model: {
        repo: PINNED_MANIFEST.repo,
        revision: PINNED_MANIFEST.revision,
        dtype: "int8",
        pooling: "cls",
        normalize: true,
      },
      cases,
    }
    writeFileSync(tempPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    renameSync(tempPath, fixturePath)
    console.log(`Updated ${fixturePath} for ${PINNED_MANIFEST.repo}@${PINNED_MANIFEST.revision}`)
  } finally {
    await Effect.runPromise(Pipeline.unload())
  }
}

run().catch((error) => {
  console.error("Could not freeze golden vectors:", error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
