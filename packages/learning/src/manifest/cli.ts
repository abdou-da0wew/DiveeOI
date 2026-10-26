#!/usr/bin/env bun
// packages/learning/src/manifest/cli.ts
//
// `bun run tl:manifest` — generate manifest.json for the pinned revision.
// Run this whenever PINNED_REVISION in ./types.ts changes. Commit the
// regenerated manifest.json alongside the SHA bump.

import { Effect } from "effect"
import { buildManifest } from "./generator"
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(here, "../../manifest.json")

const program = Effect.gen(function* () {
  const manifest = yield* buildManifest()
  const json = JSON.stringify(manifest, null, 2) + "\n"
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, json)
  console.log(`✓ Wrote ${outPath}`)
  console.log(`  repo:      ${manifest.repo}`)
  console.log(`  revision:  ${manifest.revision}`)
  console.log(`  files:     ${manifest.files.length}`)
  console.log(`  required:  ${manifest.files.filter((f) => f.required).length}`)
})

Effect.runFork(program)
