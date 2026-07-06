#!/usr/bin/env bun
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import { Server } from "../src/server/server"

const spec = await Server.openapi()
const json = JSON.stringify(spec, null, 2)

const outputPath = process.argv[2]
if (outputPath) {
  await Bun.write(outputPath, json)
} else {
  process.stdout.write(json)
}
